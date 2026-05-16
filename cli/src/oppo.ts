// OPPO careers adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (probed 2026-05-15)
//
// careers.oppo.com is a Vite SPA whose campus job listing is rendered by the
// dynamically-loaded chunk /assets/js/job-edfe7d6e.js. The chunk exposes two
// candidate routes:
//
//   POST /ats-candidate-api/open-api/position/queryPositionList  → HTTP 404
//   POST /openapi/position/pageNew                                → HTTP 200 ✓
//
// The working route is `/openapi/position/pageNew`. It returns a paginated
// list of all currently-open positions across the OPPO recruiting site without
// any token or signed header — only standard browser headers are required.
// Both campus (校招/应届生) and intern (实习生) postings live on this endpoint;
// the `recruitmentType` field on each record distinguishes them.
//
// Endpoint inventory (all anon, all on careers.oppo.com):
//   POST /openapi/position/pageNew                       → paginated job list
//   GET  /openapi/position/detail?idRecruitPosition=<id> → single posting
//   GET  /openapi/position/project/list                  → recruitment projects
//   GET  /openapi/position/relatedPosition?...           → related jobs
//   GET  /openapi/sec/getRiskReport                      → WAF risk probe
//   GET  /openapi/system/dictionary/queryList            → filter taxonomy
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "careers.oppo.com";
const API_ROOT = "https://careers.oppo.com";
const SITE_ROOT = "https://careers.oppo.com/";
const DETAIL_PAGE = (id: string) =>
  `https://careers.oppo.com/#/campus/talent/positionDetail/${encodeURIComponent(id)}`;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: SITE_ROOT,
  Origin: "https://careers.oppo.com",
};

interface ApiEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {}
): Promise<{ ok: boolean; data?: T; message: string }> {
  let url = `${API_ROOT}${path}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (path.includes("?") ? "&" : "?") + qs;
  }

  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json;charset=UTF-8";
  }

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }
  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  return {
    ok: payload.code === 0,
    data: payload.data,
    message: payload.msg || (payload.code === 0 ? "ok" : "upstream error"),
  };
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
  /** "campus" → 应届生 ; "intern" → 实习生 ; omit for both */
  recruitType?: "campus" | "intern";
  /** city code, e.g. "440300" = 深圳市 */
  cityCode?: string;
}

interface RawPositionEntry {
  idRecruitPosition?: number | string;
  idProjPosition?: number | string;
  projectPositionId?: number | string;
  positionName?: string;
  projectPositionName?: string;
  projectName?: string;
  positionTypeName?: string;
  recruitmentType?: string;
  recruitmentTypeName?: string;
  workCityName?: string;
  workCityCode?: string;
}

function summarize(item: RawPositionEntry): PositionSummary {
  const id = String(item.idRecruitPosition ?? item.idProjPosition ?? item.projectPositionId ?? "");
  return {
    post_id: id,
    title: (item.positionName ?? item.projectPositionName ?? "").trim(),
    project: (item.projectName ?? "").trim(),
    recruit_label: (item.recruitmentTypeName ?? item.recruitmentType ?? "").trim(),
    bgs: (item.positionTypeName ?? "").trim(),
    work_cities: (item.workCityName ?? "").trim(),
    apply_url: id ? DETAIL_PAGE(id) : SITE_ROOT,
  };
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const body: Record<string, unknown> = {
    pageNum: page,
    pageSize,
  };
  if (opts.keyword) body.keyword = opts.keyword.trim().slice(0, 60);
  if (opts.recruitType === "campus") body.recruitmentType = "Campus";
  else if (opts.recruitType === "intern") body.recruitmentType = "Intern";
  if (opts.cityCode) body.workCityCode = opts.cityCode;

  const r = await call<{ records?: RawPositionEntry[]; total?: number; pages?: number }>(
    "POST",
    "/openapi/position/pageNew",
    { body }
  );
  if (!r.ok || !r.data) {
    return {
      ok: false as const,
      source: SOURCE,
      message: r.message,
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = r.data.records ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    query: body,
    page,
    page_size: pageSize,
    total: r.data.total ?? rows.length,
    positions: rows.map(summarize),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number; recruitType?: "campus" | "intern" } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 50));
  const maxPages = Math.max(1, opts.maxPages ?? 40);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const r = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
      recruitType: opts.recruitType,
    });
    if (!r.ok) {
      return { ok: false as const, source: SOURCE, message: r.message, total: 0, fetched: bucket.length, positions: bucket };
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

interface RawDetail extends RawPositionEntry {
  positionDesc?: string;
  positionRequire?: string;
  projectPositionDesc?: string;
  projectPositionRequire?: string;
  releaseTime?: string;
  positionNum?: number;
  workCityVOList?: unknown;
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required", post_id: id };
  // The endpoint expects `id`, not `idRecruitPosition` — passing
  // `idRecruitPosition` returns the puzzling "id不能为空" error even when the
  // value is present. The response body still keys the id back as
  // `idRecruitPosition`, which is what tripped this in the first place.
  const r = await call<RawDetail>("GET", "/openapi/position/detail", {
    query: { id },
  });
  if (!r.ok || !r.data) {
    return { ok: false as const, source: SOURCE, message: r.message || "no detail returned", post_id: id };
  }
  const raw = r.data;
  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(raw.idRecruitPosition ?? id),
    title: raw.positionName ?? raw.projectPositionName ?? "",
    project: raw.projectName ?? "",
    recruit_label: raw.recruitmentTypeName ?? raw.recruitmentType ?? "",
    position_type: raw.positionTypeName ?? "",
    description: (raw.positionDesc ?? raw.projectPositionDesc ?? "").trim(),
    requirements: (raw.positionRequire ?? raw.projectPositionRequire ?? "").trim(),
    work_city: raw.workCityName ?? "",
    work_city_code: raw.workCityCode ?? "",
    head_count: raw.positionNum,
    release_time: raw.releaseTime ?? "",
    apply_url: DETAIL_PAGE(id),
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  const r = await call<unknown>("GET", "/openapi/system/dictionary/queryList");
  if (!r.ok) return { ok: false as const, source: SOURCE, message: r.message };
  return {
    ok: true as const,
    source: SOURCE,
    api_host: API_ROOT,
    verified_at: new Date().toISOString(),
    dictionaries: r.data,
  };
}

// ---------- notices (not exposed publicly) ----------

const NO_NOTICES = "OPPO careers does not expose a public notices/announcements endpoint.";

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

import type { ApplyFormSchema as _ApplyFormSchema_oppo } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_oppo } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_oppo } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "careers.oppo.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://careers.oppo.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "careers.oppo.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_oppo({
      source: "careers.oppo.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://careers.oppo.com/api/delivery/saveDelivery",
      submitKind: "multipart-session",
      endpointVerified: true,
      submitNotes:
        "OPPO — POST /api/delivery/saveDelivery with session cookie. Endpoint anon-probed → HTTP 500 + Spring \"Internal Server Error\" (real Spring controller; the /api/delivery/* sub-tree was discovered by reading the SPA's resume-787081aa.js chunk which references /api/delivery/getDeliveryInfo etc, then probing siblings — all 7 candidates returned 500 = real routes). The original /openapi/position/apply returned structured 404 from a different Spring service. Body shape still needs validation.",
    }),
  };
}
