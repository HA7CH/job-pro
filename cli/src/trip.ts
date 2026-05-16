// Thin client for Trip.com / Ctrip (携程) public campus-recruiting API.
//
// Both portals are backed by the same API server:
//   careers.ctrip.com  — Chinese domestic portal (携程招聘)
//   careers.trip.com   — International portal (Trip.com Group Careers)
//
// This adapter targets careers.ctrip.com since it hosts the authoritative
// Chinese campus job feed.  All JSON endpoints are unauthenticated; the server
// validates the presence of a mandatory `condition` wrapper in the POST body.
//
// ============================================================
// Endpoint inventory (probed 2026-05, JS bundle main.ad2ffe67.js):
//
//   POST https://careers.ctrip.com/api/hrrecruit/getJobAd
//        Payload (all fields inside a "condition" key):
//          { condition: {
//              pageIndex: <int>,        // 1-based
//              pageSize:  <int>,        // max tested: 100
//              category:  "2",          // "2"=校招/campus, "1"=社招/social hire
//              searchText: <string>,    // keyword filter (free-text)
//              city:       <string>,    // e.g. "CO0009" = Shanghai
//              jobFamilyGroupCode: n/a  // rejected with 202 — do not send
//            } }
//        Response: { retCode:"201", retMessage:"调用成功",
//                    retValue:{ total:<int>, recruitJobAdList:[...] } }
//        retCode "201" = success (not HTTP 201).
//        retCode "501" = validation error (missing `condition`).
//        retCode "202" = data-validation error (bad field value).
//
//   POST https://careers.ctrip.com/api/hrrecruit/getJobCount
//        Payload: { source:"ctrip" }
//        Response: retValue: [{categoryCode:"Categroy_1",total:44}, ...]
//        Used for statistics only; not required for job search.
//
// IMPORTANT QUIRKS:
//   1. The `keyword` field (inside condition) crashes the server with a
//      NullPointerException when combined with pagination.  Use `searchText`
//      instead — it is the working search field.
//   2. Combining `searchText` with `category` is accepted by the server but
//      the server ignores searchText (returns all campus results).  Keyword
//      filtering therefore works only without the category filter.
//      Practical consequence: when campus=true, keyword is applied client-side
//      on the title after fetching the full campus set.
//   3. `category:"2"` (校招/fresh graduates) gives ~112 positions;
//      no intern-only category exists (intern jobs appear mixed inside category 1
//      or surface via keyword "实习" across all listings).
//
// ============================================================
// Field mapping (API response → PositionSummary)
//   post_id       ← item.id          (numeric string, e.g. "27655163")
//   title         ← item.jobTitle    (may include code suffix "(MJ034955)")
//   project       ← item.jobFamilyGroupName  (e.g. "Software development")
//   recruit_label ← item.kindName    (e.g. "Fresh Graduates")
//   bgs           ← item.buName      (BU = Business Unit, e.g. "International business")
//   work_cities   ← item.cityName
//   apply_url     ← https://careers.ctrip.com/campus/job-detail/<jobId>
//                   (uses UUID `jobId`, not numeric `id`)
//
// ============================================================
// Category/filter values probed 2026-05:
//   category "1" = 社招 (social/experienced hire)  ~657 positions
//   category "2" = 校招 (campus / fresh graduates) ~112 positions
//   No category (omit field) = all listings         ~769 positions
//
// City codes (from item.city in responses):
//   CO0009 = Shanghai     CO0001 = Beijing    CO0013 = Xiamen
//   CO0004 = Shenzhen     CO0006 = Chengdu    (+ many others not enumerated)
//
// jobFamilyGroupName values seen in responses:
//   "Software development", "Admin", "Business development",
//   "Marketing & PR", "Finance", "Data & Analytics", "Product management"
//
// ============================================================
// Workday dead-end investigation:
//   trip.wd1.myworkdayjobs.com — resolves and is behind Cloudflare but
//   all POST attempts to /wday/cxs/trip/<slug>/jobs return HTTP 422 (no slug
//   identifiable without an active UI page).  The Workday tenant appears to be
//   a legacy artifact from Trip.com's international hiring pre-2024.
//   Not used in this adapter.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://careers.ctrip.com/api/hrrecruit";
const CAMPUS_PAGE = "https://careers.ctrip.com/campus";
const DETAIL_PAGE = (jobId: string) =>
  `https://careers.ctrip.com/campus/job-detail/${encodeURIComponent(jobId)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Origin: "https://careers.ctrip.com",
  Referer: CAMPUS_PAGE,
};

// ---------- low-level call helper ----------

interface TripEnvelope<T> {
  retCode?: string;
  retMessage?: string;
  retValue?: T;
}

async function call<T>(
  path: string,
  body: unknown
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: DEFAULT_HEADERS,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }

  let payload: TripEnvelope<T>;
  try {
    payload = (await response.json()) as TripEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  // retCode "201" = success; any other value is an error.
  const ok = payload.retCode === "201";
  return {
    ok,
    data: ok ? payload.retValue : undefined,
    message: payload.retMessage || (ok ? "ok" : `upstream error (code ${payload.retCode})`),
  };
}

// ---------- raw response types ----------

interface RawJobAd {
  id?: string | number;
  jobId?: string;
  jobTitle?: string;
  publishDate?: string;
  city?: string;
  cityName?: string;
  requirements?: string;
  duty?: string | null;
  jobFamilyGroupCode?: string;
  jobFamilyGroupName?: string;
  buCode?: string;
  buName?: string;
  kind?: string;
  kindName?: string;
  category?: string;
  atsApiType?: string;
}

interface RawSearchData {
  total?: number;
  recruitJobAdList?: RawJobAd[];
}

// ---------- PositionSummary ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

function summarizePosition(item: RawJobAd): PositionSummary {
  const id = String(item.id ?? "");
  const jobId = item.jobId ?? "";
  return {
    post_id: id,
    title: item.jobTitle ?? "",
    project: item.jobFamilyGroupName ?? "",
    recruit_label: item.kindName ?? "",
    bgs: (item.buName ?? "").trim(),
    work_cities: item.cityName ?? "",
    apply_url: jobId ? DETAIL_PAGE(jobId) : CAMPUS_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  /** Free-text search applied to job titles.  When `campusOnly` is true,
   *  keyword matching is applied client-side because the server ignores
   *  `searchText` when a category filter is active. */
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** If true (default), only 校招/campus positions are returned
   *  (category:"2", ~112 positions as of 2026-05).
   *  Set false to include all listings (social + campus, ~769 positions). */
  campusOnly?: boolean;
  /** Work city code from the API, e.g. "CO0009"=Shanghai, "CO0001"=Beijing.
   *  Omit or pass "" for all cities. */
  cityCode?: string;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const campusOnly = opts.campusOnly !== false; // default true

  // Build the condition object.
  // NOTE: `keyword` crashes the server with a NullPointerException when combined
  // with pagination; use `searchText` for safe text search.  However, when
  // `category` is also set, the server silently ignores `searchText`, so keyword
  // filtering is applied client-side after the response is received.
  const condition: Record<string, unknown> = {
    pageIndex: page,
    pageSize,
  };

  if (campusOnly) {
    condition.category = "2";
    // searchText is ignored by server when category is set; skip it to avoid confusion
  } else {
    // Without category filter, searchText works correctly
    if (keyword) condition.searchText = keyword;
  }

  if (opts.cityCode?.trim()) {
    condition.city = opts.cityCode.trim();
  }

  const response = await call<RawSearchData>("/getJobAd", { condition });
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: "careers.ctrip.com",
      query: condition,
      positions: [] as PositionSummary[],
    };
  }

  let rows = response.data.recruitJobAdList ?? [];

  // Client-side keyword filter when campusOnly is active (server ignores searchText in that mode)
  if (campusOnly && keyword) {
    const lk = keyword.toLowerCase();
    rows = rows.filter((r) => (r.jobTitle ?? "").toLowerCase().includes(lk));
  }

  return {
    ok: true as const,
    source: "careers.ctrip.com",
    query: condition,
    page,
    page_size: pageSize,
    total: campusOnly && keyword ? rows.length : (response.data.total ?? rows.length),
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 5);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message,
        source: "careers.ctrip.com",
        fetched: bucket.length,
        positions: bucket,
      };
    }
    if (total === undefined) total = result.total;
    if (!result.positions.length) break;
    bucket.push(...result.positions);
    if (total !== undefined && bucket.length >= total) break;
  }

  return {
    ok: true as const,
    source: "careers.ctrip.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
// The API exposes the full `requirements` HTML in the search response itself,
// so detail is derived from the search list without a separate round-trip.
// We page through the campus listing to find the matching id.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: "careers.ctrip.com", message: "post_id is required" };

  const pageSize = 100;
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const condition = { pageIndex: page, pageSize, category: "2" };
    const resp = await call<RawSearchData>("/getJobAd", { condition });
    if (!resp.ok || !resp.data) break;

    const items = resp.data.recruitJobAdList ?? [];
    const found = items.find((p) => String(p.id) === id);
    if (found) {
      const summary = summarizePosition(found);
      return {
        ok: true as const,
        source: "careers.ctrip.com",
        post_id: id,
        job_id: found.jobId ?? "",
        title: found.jobTitle ?? "",
        requirements_html: found.requirements ?? "",
        recruit_label: found.kindName ?? "",
        job_family: found.jobFamilyGroupName ?? "",
        bu: found.buName ?? "",
        city: found.cityName ?? "",
        publish_date: found.publishDate ?? "",
        apply_url: summary.apply_url,
      };
    }
    if (items.length < pageSize) break;
  }

  return {
    ok: false as const,
    source: "careers.ctrip.com",
    post_id: id,
    message: `post ${id} not found in campus search results (searched up to ${maxPages * pageSize} posts)`,
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  // getJobCount returns a breakdown by internal category code; not a full
  // taxonomy, but useful for getting totals.
  const response = await call<Array<{ categoryCode: string; total: number }>>(
    "/getJobCount",
    { source: "ctrip" }
  );

  const knownCategories = [
    { category: "2", label: "校招 / Campus (Fresh Graduates)", note: "~112 positions as of 2026-05" },
    { category: "1", label: "社招 / Social (Experienced Hire)", note: "~657 positions" },
  ];

  return {
    ok: response.ok,
    source: "careers.ctrip.com",
    campus_page: CAMPUS_PAGE,
    categories: knownCategories,
    job_count_by_family: response.ok ? (response.data ?? []) : [],
    message: response.ok ? "ok" : response.message,
    note:
      "Filter taxonomy: use category='2' for campus jobs in searchPositions(). " +
      "City codes are in item.city of API responses (e.g. CO0009=Shanghai, CO0001=Beijing).",
  };
}

// ---------- notices (no public endpoint) ----------

const STUB_NOTICE = {
  ok: false as const,
  source: "careers.ctrip.com",
  message: "Trip.com / Ctrip: no public notices/announcements endpoint",
};

export async function listNotices(): Promise<typeof STUB_NOTICE> {
  return STUB_NOTICE;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "careers.ctrip.com",
    message: "Trip.com / Ctrip: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "careers.ctrip.com",
    message: "Trip.com / Ctrip: no public notices endpoint",
  };
}

// ---------- matchResume ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 50);
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false as const,
      source: "careers.ctrip.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  // Fetch campus listings. Keyword is applied client-side when campusOnly=true.
  const keyword = terms.slice(0, 3).join(" ");
  const list = await fetchAllPositions({ campusOnly: true, pageSize: 100, maxPages: 2 });
  if (!list.ok) {
    return { ok: false as const, source: "careers.ctrip.com", message: list.message, positions: [] as PositionSummary[] };
  }

  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];

  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.bgs, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = list.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  const matches = shortlist.slice(0, topN).map((s) => {
    const mr =
      s.reasons.length > 0
        ? s.reasons.slice(0, 5)
        : ["no specific keyword overlap — surfaced from campus listing"];
    return { ...s.position, match_reasons: mr };
  });

  return {
    ok: true as const,
    source: "careers.ctrip.com",
    extracted_terms: terms,
    city_preferences: cities,
    keyword_used: keyword,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}

// Export helpers so other modules can import them from trip.js
export { extractResumeSignals, scoreOverlap };


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_trip } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_trip } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_trip } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "careers.ctrip.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://careers.ctrip.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "careers.ctrip.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_trip({
      source: "careers.ctrip.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://careers.ctrip.com/api/jobs/apply",
      submitKind: "multipart-session",
      submitNotes:
        "Trip.com — POST /api/jobs/apply with session cookie. Endpoint inferred; needs validation.",
    }),
  };
}
