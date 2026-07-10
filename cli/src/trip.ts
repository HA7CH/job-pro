// Thin client for Trip.com / Ctrip (携程) public recruiting API.
//
// Both portals are backed by the same API server:
//   careers.ctrip.com  — Chinese domestic portal (携程招聘)
//   careers.trip.com   — International portal (Trip.com Group Careers)
//
// This adapter targets careers.ctrip.com since it hosts the authoritative
// Chinese job feed.  All JSON endpoints are unauthenticated; the server
// validates the presence of a mandatory `condition` wrapper in the POST body.
//
// ============================================================
// Endpoint inventory (re-probed 2026-07-11 with curl; original probe 2026-05):
//
//   POST https://careers.ctrip.com/api/hrrecruit/getJobAd
//        Payload (all fields inside a "condition" key):
//          { condition: {
//              pageIndex: <int>,        // ACCEPTED BUT IGNORED — see quirks
//              pageSize:  <int>,        // ACCEPTED BUT IGNORED — see quirks
//              category:  "1"|"2",      // "2"=校招/campus, "1"=社招/social — HONORED
//              searchText: <string>,    // ACCEPTED BUT IGNORED — see quirks
//              city:      ["CO0009"],   // MUST be a JSON array — HONORED
//              jobFamilyGroupCode: n/a  // rejected with 202 — do not send
//            } }
//        Response: { retCode:"201", retMessage:"调用成功",
//                    retValue:{ total:<int>, recruitJobAdList:[...] } }
//        retCode "201" = success (not HTTP 201).
//        retCode "501" = validation error (missing `condition`).
//        retCode "202" = data-validation error (bad field value / bad type).
//
//   POST https://careers.ctrip.com/api/hrrecruit/getJobCount
//        Payload: { source:"ctrip" }
//        Response: retValue: [{categoryCode:"Categroy_1",total:32}, ...]
//        Breakdown by job-family category; statistics only.
//
// IMPORTANT QUIRKS (all verified with raw curl on 2026-07-11):
//   1. The server IGNORES `pageIndex`, `pageSize` AND `searchText` in EVERY
//      mode and always returns the COMPLETE result set for the category:
//        - category:"1", pageSize:5, pageIndex:1 → total 539, 539 rows
//        - category:"1", pageSize:5, pageIndex:2 → identical 539 rows
//        - searchText:"前端" (with or without category) → all 539 rows
//      A 2026-05 probe believed searchText worked without category; the
//      2026-07 re-probe disproved that (audit finding).  Consequence:
//      keyword filtering AND pagination are done client-side in this adapter,
//      on the full (bounded, currently ~539-row) feed returned by one call.
//   2. `category` IS honored server-side: "1"=社招 total 539 (2026-07-11),
//      "2"=校招 total 0 (2027 届秋招尚未开启), omitted = all feeds.
//   3. `city` must be a JSON ARRAY of city codes; a bare string is rejected
//      with retCode 202 ("Cannot deserialize instance of ArrayList out of
//      VALUE_STRING").  city:["CO0001"] → total 21, all Beijing (verified).
//   4. `keyword` (inside condition) crashes the server with a
//      NullPointerException — never send it; not that we need it anyway.
//   5. Every list row carries the FULL `requirements` JD HTML, so `detail`
//      is served from the list feed without a separate endpoint.
//   6. Numeric `id` values ROTATE between feed snapshots (audit ids 28866xxx
//      became 28868xxx a month later).  The stable identifiers are `fromId`
//      (MJ-code, e.g. "MJ035946") and `jobId` (UUID).  fetchPositionDetail
//      therefore matches on id OR fromId OR jobId.
//   7. There is no intern-only category.  As of 2026-07 ALL intern openings
//      live in the social feed (category "1"), flagged by kind:"3" (29 rows)
//      and/or a 实习/Intern title (a handful of intern-titled rows carry
//      kind:"1").  `--scope intern` fetches ALL feeds and filters client-side
//      on kind + title.
//
// ============================================================
// Field mapping (API response → PositionSummary)
//   post_id       ← item.id          (numeric string; ROTATES between snapshots)
//   title         ← item.jobTitle    (may include code suffix "(MJ034955)")
//   project       ← item.jobFamilyGroupName  (e.g. "Software development")
//   recruit_label ← item.kindName, falling back to kind/category-derived label
//   bgs           ← item.buName      (BU = Business Unit)
//   work_cities   ← item.cityName
//   apply_url     ← https://careers.ctrip.com/campus#/experienced/job-detail/<fromId>
//
// ============================================================
// Live totals probed 2026-07-11:
//   category "1" = 社招 (social/experienced) 539 positions (34 intern-titled)
//   category "2" = 校招 (campus)               0 positions (2027 秋招未开)
//   No category (omit field) = all listings  539 positions
//
// City codes (from item.city in responses):
//   CO0009 = Shanghai     CO0001 = Beijing    CO0013 = Xiamen
//   CO0004 = Shenzhen     CO0006 = Chengdu    (+ many others not enumerated)
//
// ============================================================
// Workday dead-end investigation:
//   trip.wd1.myworkdayjobs.com — resolves and is behind Cloudflare but
//   all POST attempts to /wday/cxs/trip/<slug>/jobs return HTTP 422 (no slug
//   identifiable without an active UI page).  The Workday tenant appears to be
//   a legacy artifact from Trip.com's international hiring pre-2024.
//   Not used in this adapter.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Trip / Ctrip supports social + campus + intern + all.
 *
 * Scope translation to upstream `category` (1.2.x, audited 2026-07):
 *   social    → "1"        (社招, 539 posts as of 2026-07-11)
 *   campus    → "2"        (校招, 0 posts — 2027 秋招未开)
 *   intern    → no category + client-side intern filter (kind:"3" / 实习 title)
 *   all       → no category (all feeds)
 *   undefined → no category (DEFAULT = all feeds).  The historical default
 *               was campus, but the campus channel is empty while 500+ open
 *               positions sit in social — defaulting to campus made the main
 *               CLI verbs return a misleading 0 (audit critical finding).
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

const API_ROOT = "https://careers.ctrip.com/api/hrrecruit";
const CAMPUS_PAGE = "https://careers.ctrip.com/campus";
const SOURCE = "careers.ctrip.com";
// SPA uses hash routing under /campus. The actual detail route is
// `#/experienced/job-detail/<MJ-code>` where the MJ-code is the raw API's
// `fromId` field (e.g. "MJ034732"). The previous `/campus/job-detail/<UUID>`
// path was not a registered route — server gave a generic 200, SPA hash-router
// landed on the homepage carousel. Verified via headless browser.
const DETAIL_PAGE = (mjCode: string) =>
  `https://careers.ctrip.com/campus#/experienced/job-detail/${encodeURIComponent(mjCode)}`;

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T>(
  path: string,
  body: unknown
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  // Transient upstream hiccups (WAF 405s, 5xx, network resets) get a couple
  // of backed-off retries instead of hammering the endpoint.
  const attempts = 3;
  let lastMessage = "unknown error";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: DEFAULT_HEADERS,
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastMessage = `network error: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt < attempts) await sleep(500 * attempt);
      continue;
    }

    if (!response.ok) {
      lastMessage = `HTTP ${response.status}: ${response.statusText}`;
      const retriable = response.status === 405 || response.status === 429 || response.status >= 500;
      if (retriable && attempt < attempts) {
        await sleep(500 * attempt);
        continue;
      }
      return { ok: false, message: lastMessage };
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

  return { ok: false, message: lastMessage };
}

// ---------- raw response types ----------

interface RawJobAd {
  id?: string | number;
  jobId?: string;
  /** Human-facing MJ-code (e.g. "MJ034732"). The SPA's detail route keys on
   * this, not on jobId — the public job listings on careers.ctrip.com link
   * out as `#/experienced/job-detail/<fromId>`. Stable across feed snapshots
   * (unlike the numeric `id`). */
  fromId?: string;
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
  /** "1" = regular hire, "3" = intern (probed 2026-07-11: all 29 kind:"3"
   * rows are 实习/assistant roles). kindName is empty in current responses. */
  kind?: string;
  kindName?: string;
  category?: string;
  atsApiType?: string;
}

interface RawSearchData {
  total?: number;
  recruitJobAdList?: RawJobAd[];
}

// ---------- feed fetch (single call returns the ENTIRE category set) ----------

// The server ignores pageIndex/pageSize/searchText (quirk #1), so one POST
// returns the complete bounded inventory for the chosen category (~539 rows
// as of 2026-07-11).  All keyword filtering and pagination happen client-side
// on this set.  A short-lived in-process cache avoids re-downloading the same
// multi-hundred-row feed when one CLI invocation needs it more than once
// (e.g. matchResume → fetchAllPositions).
const FEED_CACHE_TTL_MS = 120_000;
const feedCache = new Map<string, { at: number; total: number; rows: RawJobAd[] }>();

async function fetchFeed(opts: {
  category?: string;
  cityCode?: string;
}): Promise<
  | { ok: true; rows: RawJobAd[]; total: number; condition: Record<string, unknown> }
  | { ok: false; message: string; condition: Record<string, unknown> }
> {
  const condition: Record<string, unknown> = { pageIndex: 1, pageSize: 100 };
  if (opts.category !== undefined) condition.category = opts.category;
  // `city` must be an ARRAY — a bare string is rejected with retCode 202
  // (verified 2026-07-11: city:"CO0009" → 202, city:["CO0009"] → 201).
  const city = opts.cityCode?.trim();
  if (city) condition.city = [city];

  const key = `${opts.category ?? "*"}|${city ?? ""}`;
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.at < FEED_CACHE_TTL_MS) {
    return { ok: true, rows: cached.rows, total: cached.total, condition };
  }

  const response = await call<RawSearchData>("/getJobAd", { condition });
  if (!response.ok || !response.data) {
    return { ok: false, message: response.message, condition };
  }

  // Dedupe by id defensively (feed is one page today, but keep the contract).
  const seen = new Set<string>();
  const rows: RawJobAd[] = [];
  for (const r of response.data.recruitJobAdList ?? []) {
    const id = String(r.id ?? r.fromId ?? "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    rows.push(r);
  }

  const total = response.data.total ?? rows.length;
  feedCache.set(key, { at: Date.now(), total, rows });
  return { ok: true, rows, total, condition };
}

// ---------- scope resolution + client-side filters ----------

/** Effective category for a scope. `undefined` = omit category = all feeds. */
function resolveCategory(opts: SearchOptions): {
  category?: string;
  internFilter: boolean;
  effectiveScope: string;
} {
  if (opts.campusOnly === true) return { category: "2", internFilter: false, effectiveScope: "campus" };
  if (opts.campusOnly === false) return { category: undefined, internFilter: false, effectiveScope: "all" };
  switch (opts.scope) {
    case "social":
      return { category: "1", internFilter: false, effectiveScope: "social" };
    case "campus":
      return { category: "2", internFilter: false, effectiveScope: "campus" };
    case "intern":
      // No intern category exists upstream; intern openings currently all sit
      // in the social feed (kind:"3" or 实习-titled). Fetch every feed and
      // filter client-side (audit minor finding).
      return { category: undefined, internFilter: true, effectiveScope: "intern" };
    case "all":
      return { category: undefined, internFilter: false, effectiveScope: "all" };
    default:
      // DEFAULT = all feeds. The historical campus default returned a
      // misleading 0 while 500+ positions were open in social (audit
      // critical finding, 2026-07).
      return { category: undefined, internFilter: false, effectiveScope: "all" };
  }
}

/** Intern detector: kind:"3" (upstream intern flag) OR an intern-ish title.
 *  `\bintern(s|ship)?\b` deliberately does NOT match "International…" titles
 *  (no word boundary inside the word). Probed 2026-07-11: 33 of 539 rows. */
function isInternRow(r: RawJobAd): boolean {
  if (r.kind === "3") return true;
  const title = r.jobTitle ?? "";
  return /实习/.test(title) || /\bintern(s|ship)?\b/i.test(title);
}

function keywordFilter(rows: RawJobAd[], keyword: string): RawJobAd[] {
  // Server-side searchText is ignored in every mode (quirk #1), so keyword
  // matching is client-side over the full bounded feed. Title-only keeps
  // precision (e.g. "工程师" → 76/539, "前端" → 15/539 on 2026-07-11).
  const lk = keyword.toLowerCase();
  return rows.filter((r) => (r.jobTitle ?? "").toLowerCase().includes(lk));
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

function recruitLabelFor(item: RawJobAd): string {
  if (item.kindName?.trim()) return item.kindName.trim();
  if (item.kind === "3") return "实习 Intern";
  if (item.category === "2") return "校招 Campus";
  if (item.category === "1") return "社招 Social";
  return "";
}

function summarizePosition(item: RawJobAd): PositionSummary {
  const id = String(item.id ?? "");
  const mjCode = item.fromId ?? "";
  return {
    post_id: id,
    title: item.jobTitle ?? "",
    project: item.jobFamilyGroupName ?? "",
    recruit_label: recruitLabelFor(item),
    bgs: (item.buName ?? "").trim(),
    work_cities: item.cityName ?? "",
    apply_url: mjCode ? DETAIL_PAGE(mjCode) : CAMPUS_PAGE,
  };
}

// ---------- html → text (for detail description) ----------

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  /** Free-text search applied client-side to job titles — the server ignores
   *  `searchText` in every mode (verified 2026-07-11), so filtering always
   *  happens on the full feed returned by one call. */
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Legacy pre-scope flag. true → campus only (category "2"); false → all
   *  feeds. Takes precedence over `scope` when set. */
  campusOnly?: boolean;
  /** CLI `--scope` (1.1.0+): social/campus/intern/all. Omitted = all feeds
   *  (1.2.x default — the old campus default returned a misleading 0 while
   *  the campus channel is empty). */
  scope?: PositionScope;
  /** Work city code from the API, e.g. "CO0009"=Shanghai, "CO0001"=Beijing.
   *  Sent upstream as `city: [code]` (array — string form is rejected).
   *  Omit or pass "" for all cities. */
  cityCode?: string;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const { category, internFilter, effectiveScope } = resolveCategory(opts);

  const feed = await fetchFeed({ category, cityCode: opts.cityCode });
  const queryEcho = {
    ...feed.condition,
    scope: effectiveScope,
    ...(keyword ? { keyword } : {}),
    note: "server ignores searchText/pageIndex/pageSize — keyword filter and pagination are client-side over the full feed",
  };
  if (!feed.ok) {
    return {
      ok: false as const,
      message: feed.message,
      source: SOURCE,
      query: queryEcho,
      positions: [] as PositionSummary[],
    };
  }

  let rows = feed.rows;
  if (internFilter) rows = rows.filter(isInternRow);
  if (keyword) rows = keywordFilter(rows, keyword);

  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    ok: true as const,
    source: SOURCE,
    query: queryEcho,
    page,
    page_size: pageSize,
    // True total AFTER scope/keyword filtering — never the page length.
    total: rows.length,
    positions: pageRows.map(summarizePosition),
    ...(effectiveScope === "campus" && rows.length === 0
      ? {
          note:
            "campus channel is currently empty upstream (2027 届秋招未开). " +
            "Try --scope social or --scope all — the social feed has 500+ open positions.",
        }
      : {}),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  // The upstream returns the COMPLETE inventory in a single response (quirk
  // #1), so one HTTP call always exhausts `total` — maxPages caps HTTP
  // round-trips and we only ever need one; results are never truncated.
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const { category, internFilter, effectiveScope } = resolveCategory(opts);

  const feed = await fetchFeed({ category, cityCode: opts.cityCode });
  if (!feed.ok) {
    return {
      ok: false as const,
      message: feed.message,
      source: SOURCE,
      fetched: 0,
      positions: [] as PositionSummary[],
    };
  }

  let rows = feed.rows;
  if (internFilter) rows = rows.filter(isInternRow);
  if (keyword) rows = keywordFilter(rows, keyword);

  return {
    ok: true as const,
    source: SOURCE,
    scope: effectiveScope,
    total: rows.length,
    fetched: rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetchPositionDetail ----------
// The list API exposes the full `requirements` JD HTML on every row, so
// detail is served from the feed without a separate endpoint. The feed is
// fetched with NO category filter so ids from ANY scope resolve (the old
// implementation hard-coded the campus category, which is currently empty —
// detail was broken for all 500+ open positions; audit major finding).
//
// Accepts the numeric `id`, the MJ-code (`fromId`, stable across snapshots)
// or the `jobId` UUID — numeric ids ROTATE between feed snapshots.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };

  const feed = await fetchFeed({}); // no category → all feeds
  if (!feed.ok) {
    return { ok: false as const, source: SOURCE, post_id: id, message: feed.message };
  }

  const idLower = id.toLowerCase();
  const found = feed.rows.find(
    (p) =>
      String(p.id ?? "") === id ||
      (p.fromId ?? "").toLowerCase() === idLower ||
      (p.jobId ?? "").toLowerCase() === idLower
  );

  if (!found) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message:
        `post ${id} not found among ${feed.rows.length} open positions (all categories). ` +
        "Note: numeric ids rotate between feed snapshots — re-run search for a fresh id, " +
        "or pass the stable MJ-code (e.g. MJ035946) from apply_url.",
    };
  }

  const summary = summarizePosition(found);
  const requirementsHtml = found.requirements ?? "";
  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(found.id ?? id),
    job_id: found.jobId ?? "",
    mj_code: found.fromId ?? "",
    title: found.jobTitle ?? "",
    description: htmlToText([requirementsHtml, found.duty ?? ""].filter(Boolean).join("\n")),
    requirements_html: requirementsHtml,
    recruit_label: summary.recruit_label,
    job_family: found.jobFamilyGroupName ?? "",
    bu: found.buName ?? "",
    city: found.cityName ?? "",
    publish_date: found.publishDate ?? "",
    apply_url: summary.apply_url,
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
    { category: "1", label: "社招 / Social (Experienced Hire)", note: "539 positions as of 2026-07-11 — includes all current intern openings" },
    { category: "2", label: "校招 / Campus (Fresh Graduates)", note: "0 positions as of 2026-07-11 (2027 届秋招未开)" },
  ];

  return {
    ok: response.ok,
    source: SOURCE,
    campus_page: CAMPUS_PAGE,
    categories: knownCategories,
    job_count_by_family: response.ok ? (response.data ?? []) : [],
    message: response.ok ? "ok" : response.message,
    note:
      "Default scope is `all` (no category filter). The server ignores searchText/pageSize/pageIndex, " +
      "so keyword search and pagination are client-side. City filter works server-side as an array " +
      "(city codes appear in item.city of responses, e.g. CO0009=Shanghai, CO0001=Beijing).",
  };
}

// ---------- notices (no public endpoint) ----------

const STUB_NOTICE = {
  ok: false as const,
  source: SOURCE,
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
    source: SOURCE,
    message: "Trip.com / Ctrip: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
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
      source: SOURCE,
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  // Score against the FULL feed (all categories). The old implementation
  // matched against the campus feed only, which is currently empty upstream.
  const keyword = terms.slice(0, 3).join(" ");
  const list = await fetchAllPositions({ scope: "all" });
  if (!list.ok) {
    return { ok: false as const, source: SOURCE, message: list.message, positions: [] as PositionSummary[] };
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
        : ["no specific keyword overlap — surfaced from the open-positions feed"];
    return { ...s.position, match_reasons: mr };
  });

  return {
    ok: true as const,
    source: SOURCE,
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
