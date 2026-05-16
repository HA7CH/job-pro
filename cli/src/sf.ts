// 顺丰 (SF Express) campus-recruiting adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (probed 2026-05-15)
//
// campus.sf-express.com is a Vue SPA built with Webpack. The campus-recruiting
// flow was originally believed to be GeeTest-gated (POST /api/zp/jobList → 401),
// but the SPA's actual position-listing chunk (cr/static/js/25.aa149bcb...js)
// calls a different, fully anonymous route:
//
//   GET /api/web/position/query?pageNum=&pageSize=&keyword=…
//
// Required headers: a normal browser UA plus the `cr-service` header that the
// SPA's axios interceptor adds to every request. The interceptor sets
//   cr-service: <url-encoded current location>
// and the gateway uses it instead of a JWT to scope the response. With both
// in place the endpoint returns paginated JSON without any captcha or login.
//
// Endpoint inventory (anonymous GET unless noted):
//   GET /api/web/position/query        → paginated positions (campus + intern + mgmt)
//   GET /api/web/position/findById/<id>→ single posting (via /api/position/findById/<id>)
//
// `positionType` filter values seen in the wild:
//   "consulting"     管理咨询生
//   "managetraniee"  管培生类
//   "" (omitted)     全部
//
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "campus.sf-express.com";
const API_ROOT = "https://campus.sf-express.com";
const SITE_ROOT = "https://campus.sf-express.com/";
const DETAIL_PAGE = (id: string) =>
  `https://campus.sf-express.com/#/postDetail/${encodeURIComponent(id)}`;
const CR_SERVICE = "https%3A%2F%2Fcampus.sf-express.com%2F";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: SITE_ROOT,
  Origin: API_ROOT,
  "cr-service": CR_SERVICE,
};

async function call<T>(
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<{ ok: boolean; data?: T; total?: number; message: string }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  const url = `${API_ROOT}${path}${qs ? `?${qs}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }
  // SF returns the payload object directly (PageHelper shape: {list, total, …})
  let payload: { list?: T; total?: number; [k: string]: unknown };
  try {
    payload = (await response.json()) as { list?: T; total?: number };
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  return { ok: true, data: payload.list, total: payload.total, message: "ok" };
}

// ---------- types ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** "consulting" | "managetraniee" (sic) | "" for all */
  positionType?: string;
  /** "1" = 校招, "2" = 实习, "3" = 管培 (see seasonType in API) */
  seasonType?: string;
}

interface RawPosition {
  id?: number | string;
  positionName?: string;
  positionType?: string;
  positionTypeName?: string;
  seasonType?: string;
  recruitCity?: string;
  demandCity?: string;
  orgSource?: string;
  orgSourceName?: string;
  postDuty?: string;
  jobRequirement?: string;
  education?: string;
  educationName?: string;
  internType?: string;
  internTypeName?: string;
  createDate?: string;
}

function summarize(item: RawPosition): PositionSummary {
  const id = String(item.id ?? "");
  const city = (item.demandCity ?? item.recruitCity ?? "").toString().trim();
  return {
    post_id: id,
    title: (item.positionName ?? "").trim(),
    project: (item.orgSourceName ?? item.orgSource ?? "").trim(),
    recruit_label:
      item.seasonType === "1"
        ? "校招"
        : item.seasonType === "2"
        ? "实习"
        : item.seasonType === "3"
        ? "管培"
        : "",
    bgs: (item.positionTypeName ?? "").trim(),
    work_cities: city,
    apply_url: id ? DETAIL_PAGE(id) : SITE_ROOT,
  };
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const query: Record<string, string | number | undefined> = {
    pageNum: page,
    pageSize,
  };
  if (opts.keyword) query.positionName = opts.keyword.trim().slice(0, 60);
  if (opts.positionType) query.positionType = opts.positionType;
  if (opts.seasonType) query.seasonType = opts.seasonType;

  const r = await call<RawPosition[]>("/api/web/position/query", query);
  if (!r.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: r.message,
      query,
      positions: [] as PositionSummary[],
    };
  }
  const rows = r.data ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    query,
    page,
    page_size: pageSize,
    total: r.total ?? rows.length,
    positions: rows.map(summarize),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 50));
  const maxPages = Math.max(1, opts.maxPages ?? 20);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const r = await searchPositions({ keyword: opts.keyword, page, pageSize });
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        message: r.message,
        total: 0,
        fetched: bucket.length,
        positions: bucket,
      };
    }
    if (total === undefined) total = r.total;
    if (!r.positions.length) break;
    bucket.push(...r.positions);
    if (total !== undefined && bucket.length >= total) break;
  }

  return {
    ok: true as const,
    source: SOURCE,
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required", post_id: id };

  // Some SF builds expose details via /api/position/findById/<id>, others via the
  // SPA's "findById" route — both share the same backend. We always hit /api/...
  const url = `${API_ROOT}/api/position/findById/${encodeURIComponent(id)}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
      post_id: id,
    };
  }
  if (!response.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `HTTP ${response.status}: ${response.statusText}`,
      post_id: id,
    };
  }
  let raw: RawPosition & Record<string, unknown>;
  try {
    raw = (await response.json()) as RawPosition & Record<string, unknown>;
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `bad JSON: ${err instanceof Error ? err.message : err}`,
      post_id: id,
    };
  }

  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(raw.id ?? id),
    title: raw.positionName ?? "",
    project: raw.orgSourceName ?? raw.orgSource ?? "",
    position_type: raw.positionTypeName ?? "",
    description: (raw.postDuty ?? "").toString().trim(),
    requirements: (raw.jobRequirement ?? "").toString().trim(),
    work_city: raw.demandCity ?? "",
    interview_city: raw.recruitCity ?? "",
    education: raw.educationName ?? raw.education ?? "",
    intern_type: raw.internTypeName ?? raw.internType ?? "",
    create_date: raw.createDate ?? "",
    apply_url: DETAIL_PAGE(id),
  };
}

// ---------- fetchDictionaries (no public dict endpoint) ----------

export async function fetchDictionaries() {
  return {
    ok: false as const,
    source: SOURCE,
    message:
      "SF Express does not expose a public filter taxonomy endpoint; positions API accepts " +
      "positionName / positionType / seasonType query params directly.",
    api_host: API_ROOT,
    known_filters: {
      positionType: ["consulting", "managetraniee"],
      seasonType: { "1": "校招", "2": "实习", "3": "管培" },
    },
  };
}

// ---------- notices (no public notices endpoint) ----------

const NO_NOTICES = "SF Express campus does not expose a public notices/announcements endpoint.";

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: NO_NOTICES, notices: [] as never[] };
}
export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: NO_NOTICES, notice_id: noticeId };
}
export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return { ok: false as const, source: SOURCE, question, message: NO_NOTICES, matches: [] as never[] };
}

// ---------- matchResume ----------

export async function matchResume(text: string, opts: { topN?: number; candidates?: number } = {}) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 200);

  const all = await fetchAllPositions({ pageSize: 50, maxPages: Math.ceil(candidates / 50) });
  if (!all.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: all.message,
      extracted_terms: terms,
      city_preferences: cities,
      matches: [] as PositionSummary[],
    };
  }

  type Scored = { score: number; position: PositionSummary };
  const scored: Scored[] = [];
  for (const p of all.positions) {
    const haystack = `${p.title} ${p.project} ${p.bgs} ${p.work_cities}`;
    const score = scoreOverlap(haystack, terms, cities).score;
    if (score > 0) scored.push({ score, position: p });
  }
  scored.sort((a, b) => b.score - a.score);

  return {
    ok: true as const,
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    candidate_pool: all.positions.length,
    matches: scored.slice(0, topN).map((s) => s.position),
  };
}

export { extractResumeSignals, scoreOverlap };


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_sf } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_sf } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_sf } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "campus.sf-express.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://campus.sf-express.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "campus.sf-express.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_sf({
      source: "campus.sf-express.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://campus.sf-express.com/api/web/position/apply",
      submitKind: "multipart-session",
      submitNotes:
        "SF Express — POST /api/web/position/apply with cr-service header + GeeTest captcha + session cookie. Endpoint inferred; needs validation.",
    }),
  };
}
