// Thin client for ByteDance's public campus-recruiting API at jobs.bytedance.com.
//
// All endpoints are unauthenticated; the server enforces portal-channel /
// portal-platform / website-path headers to discourage cross-site embedding.
//
// Endpoint inventory (probed 2024-05, filter semantics verified 2026-05):
//
//   POST https://jobs.bytedance.com/api/v1/search/job/posts
//        Payload: { keyword, limit, offset, portal_type:3, portal_entrance:1, language:"zh",
//                   recruitment_id_list:["201"] }
//        Response: { code:0, data:{ job_post_list:[...], count:<int> }, message:"ok" }
//
// Filter semantics (from JS bundle S={1:"1",2:"201",3:"202,301"} mapping):
//   URL ?type=2  → recruitment_id_list:["201"]   → 正式 (campus / new-grad)  ~2057 posts
//   URL ?type=3  → recruitment_id_list:["202"]   → 实习 (intern)              ~5767 posts
//   No filter   → all listings                                                  ~7824 posts
//
// The campus page (jobs.bytedance.com/campus/position) defaults to the 校园招聘 tab (type=2,
// 正式/new-grad only).  Without recruitment_id_list the API returns all 7824 listings
// (campus + intern combined), which does NOT match the default tab view.
// The correct default filter is recruitment_id_list:["201"].
//
// No separate detail / dictionaries / notices endpoints are publicly reachable
// (all return 404).  fetchPositionDetail is implemented by paginating the search
// endpoint and filtering by id.
//
// ---- PositionSummary field mapping (ByteDance → canonical) ----
//   post_id       ← item.id  (stringified)
//   title         ← item.title
//   project       ← item.job_category.name  (closest equiv to Tencent's projectName)
//   recruit_label ← item.recruit_type.name  (e.g. "日常实习" / "暑期实习" / "正式")
//   bgs           ← ""  (ByteDance does not expose BG/事业群 in public search)
//   work_cities   ← item.city_info.name + city_list joined with " / " for multi-city posts
//   apply_url     ← https://jobs.bytedance.com/campus/position/${id}/detail

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { extractResumeSignals, scoreOverlap, checkResume };

const API_ROOT = "https://jobs.bytedance.com/api/v1";
const CAMPUS_PAGE = "https://jobs.bytedance.com/campus/position";
const DETAIL_PAGE = (id: string) =>
  `https://jobs.bytedance.com/campus/position/${encodeURIComponent(id)}/detail`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "portal-channel": "campus",
  "portal-platform": "pc",
  "website-path": "campus",
  Referer: CAMPUS_PAGE,
};

// ---------- low-level call helper ----------

interface BdEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
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

  let payload: BdEnvelope<T>;
  try {
    payload = (await response.json()) as BdEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  return {
    ok: payload.code === 0,
    data: payload.data,
    message: payload.message || (payload.code === 0 ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface RawCityInfo {
  code?: string;
  name?: string;
  en_name?: string;
}

interface RawJobCategory {
  id?: string;
  name?: string;
  en_name?: string;
}

interface RawRecruitType {
  id?: string;
  name?: string;
  en_name?: string;
}

interface RawJobSubject {
  id?: string;
  name?: { zh_cn?: string; en_us?: string; i18n?: string };
  limit_count?: number;
}

interface RawJobPost {
  id?: string | number;
  title?: string;
  sub_title?: string | null;
  description?: string;
  requirement?: string;
  job_category?: RawJobCategory;
  city_info?: RawCityInfo;
  city_list?: RawCityInfo[];
  recruit_type?: RawRecruitType;
  publish_time?: number;
  code?: string;
  job_subject?: RawJobSubject;
  job_post_info?: unknown;
}

interface RawSearchData {
  job_post_list?: RawJobPost[];
  count?: number;
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

function summarizePosition(item: RawJobPost): PositionSummary {
  const id = String(item.id ?? "");
  // Build work_cities: prefer city_list for multi-city; fall back to city_info
  const cityList = item.city_list ?? [];
  let work_cities: string;
  if (cityList.length > 1) {
    work_cities = cityList.map((c) => c.name ?? "").filter(Boolean).join(" / ");
  } else {
    work_cities = item.city_info?.name ?? (cityList[0]?.name ?? "");
  }
  return {
    post_id: id,
    title: item.title ?? "",
    project: item.job_category?.name ?? "",
    recruit_label: item.recruit_type?.name ?? "",
    bgs: "",
    work_cities,
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// ---------- searchPositions ----------

export async function searchPositions(
  opts: { keyword?: string; page?: number; pageSize?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * pageSize;
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const payload = {
    keyword,
    limit: pageSize,
    offset,
    portal_type: 3,
    portal_entrance: 1,
    language: "zh",
    // "201" = 正式 (campus / new-grad) — matches the default 校园招聘 tab on the website.
    // Without this filter the API returns ~7824 (campus + intern combined).
    recruitment_id_list: ["201"],
  };

  const response = await call<RawSearchData>("/search/job/posts", payload);
  if (!response.ok || !response.data) {
    return {
      ok: false,
      message: response.message,
      source: "jobs.bytedance.com",
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.job_post_list ?? [];
  return {
    ok: true,
    source: "jobs.bytedance.com",
    query: payload,
    page,
    page_size: pageSize,
    total: response.data.count ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 5); // cap at 5 pages (500 posts)

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
    });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        source: "jobs.bytedance.com",
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
    ok: true,
    source: "jobs.bytedance.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
// ByteDance has no public per-post detail endpoint.
// We paginate the search at offset 0,100,200,... (up to 5 pages of 100)
// and filter by id to reconstruct a detail-like object.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "jobs.bytedance.com", message: "post_id is required" };

  const pageSize = 100;
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const offset = (page - 1) * pageSize;
    const payload = {
      keyword: "",
      limit: pageSize,
      offset,
      portal_type: 3,
      portal_entrance: 1,
      language: "zh",
      recruitment_id_list: ["201"],
    };
    const response = await call<RawSearchData>("/search/job/posts", payload);
    if (!response.ok || !response.data) break;

    const posts = response.data.job_post_list ?? [];
    const found = posts.find((p) => String(p.id) === id);
    if (found) {
      const summary = summarizePosition(found);
      return {
        ok: true,
        source: "jobs.bytedance.com",
        post_id: id,
        title: found.title ?? "",
        direction: found.sub_title ?? "",
        description: found.description ?? "",
        requirements: found.requirement ?? "",
        work_cities: found.city_list ?? (found.city_info ? [found.city_info] : []),
        recruit_cities: found.city_list ?? (found.city_info ? [found.city_info] : []),
        apply_url: summary.apply_url,
      };
    }
    // If this page returned fewer than pageSize, no more pages exist
    if (posts.length < pageSize) break;
  }

  return {
    ok: false,
    source: "jobs.bytedance.com",
    post_id: id,
    message: `post ${id} not found in public search results (searched up to ${maxPages * pageSize} posts)`,
  };
}

// ---------- stub endpoints ----------

const STUB_DICTS = {
  ok: false as const,
  source: "jobs.bytedance.com",
  message: "ByteDance: no public dictionaries endpoint",
};

const STUB_NOTICES = {
  ok: false as const,
  source: "jobs.bytedance.com",
  message: "ByteDance: no public notices endpoint",
};

export async function fetchDictionaries(): Promise<typeof STUB_DICTS> {
  return STUB_DICTS;
}

export async function listNotices(): Promise<typeof STUB_NOTICES> {
  return STUB_NOTICES;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bytedance.com",
    message: "ByteDance: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bytedance.com",
    message: "ByteDance: no public notices endpoint",
  };
}

// ---------- matchResume ----------
// Mirror tencent's algorithm:
// 1. Extract signals from resume text.
// 2. Search with top-3 terms as keyword (description is already in search results).
// 3. Score each post against title + description + requirement + city + recruit_type blob.
// 4. Return top N matches with reasons.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 20);
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false,
      source: "jobs.bytedance.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
  if (!list.ok) {
    return { ok: false, source: "jobs.bytedance.com", message: list.message, positions: [] };
  }

  // Re-fetch raw posts to access description + requirement fields
  const payload = {
    keyword,
    limit: 100,
    offset: 0,
    portal_type: 3,
    portal_entrance: 1,
    language: "zh",
    recruitment_id_list: ["201"],
  };
  const raw = await call<RawSearchData>("/search/job/posts", payload);
  const rawPosts: RawJobPost[] = raw.ok ? (raw.data?.job_post_list ?? []) : [];

  // Build a lookup from id → raw post for blob scoring
  const rawById = new Map<string, RawJobPost>();
  for (const p of rawPosts) {
    rawById.set(String(p.id ?? ""), p);
  }

  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
    requirements?: string;
  };
  const scored: Scored[] = [];

  for (const p of list.positions) {
    const rp = rawById.get(p.post_id);
    const blob = [
      p.title,
      p.project,
      p.recruit_label,
      p.work_cities,
      rp?.description ?? "",
      rp?.requirement ?? "",
    ].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({
        score,
        position: p,
        reasons,
        description: rp?.description,
        requirements: rp?.requirement,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    // Fall back: return first N positions with score 0
    shortlist = list.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
      description: rawById.get(position.post_id)?.description,
      requirements: rawById.get(position.post_id)?.requirement,
    }));
  }

  const matches = shortlist.slice(0, topN).map((s) => {
    const mr =
      s.reasons.length > 0
        ? s.reasons.slice(0, 5)
        : ["no specific keyword overlap — surfaced from initial keyword search"];
    return {
      ...s.position,
      description: s.description,
      requirements: s.requirements,
      match_reasons: mr,
    };
  });

  return {
    ok: true,
    source: "jobs.bytedance.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
