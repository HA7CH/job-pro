// Thin client for Xiaomi's public campus-recruiting API.
//
// Xiaomi does NOT use jobs.bytedance.com or xiaomi.jobs.feishu.cn.
// It self-hosts the ByteDance ATSX (飞书招聘) platform at:
//
//   https://xiaomi.jobs.f.mioffice.cn/   (mioffice.cn = Xiaomi's Feishu fork)
//
// The API shape is IDENTICAL to jobs.bytedance.com:
//   POST /api/v1/search/job/posts
//   GET  /api/v1/config/job/filters/{path}
//
// The key difference: Xiaomi requires three portal-scoping headers to switch
// between campus (校招) and internship (实习) pools:
//   portal-channel:  "campus" | "internship"
//   portal-platform: "pc"
//   website-path:    "campus" | "internship"
//
// Without those headers the API defaults to 社招 (experienced/social hire).
//
// ============================================================
// Endpoint inventory (probed 2026-05, API identical to ByteDance ATSX):
//
//   POST https://xiaomi.jobs.f.mioffice.cn/api/v1/search/job/posts
//        Payload: { keyword, limit, offset, portal_type:3, portal_entrance:1,
//                   language:"zh", recruitment_id_list?, job_function_id_list?,
//                   location_code_list?, subject_id_list? }
//        Response: { code:0, data:{ job_post_list:[...], count:<int> }, message:"ok" }
//
//   GET  https://xiaomi.jobs.f.mioffice.cn/api/v1/config/job/filters/campus
//        Returns: { job_function_list, city_list, recruitment_type_list,
//                   job_subject_list, ... }
//
// ============================================================
// Portal pools (controlled by headers, confirmed 2026-05):
//
//   portal-channel: "campus"     → 357 posts  (正式 / new-grad, 招聘类型=校招)
//   portal-channel: "internship" → 729 posts  (实习 / intern,   招聘类型=校招)
//   no channel header            → 2681 posts (社招 / experienced, NOT campus)
//
// ============================================================
// Filter taxonomy (from GET /api/v1/config/job/filters/campus, portal-channel: campus):
//
// DIMENSION 1 — job_function_id_list (职能类别)
//   7178759516879405165 = 软件研发类 / Software R&D
//   7178830559051874412 = 硬件研发类 / Hardware R&D
//   7467761476330340460 = 算法类 / Algorithm
//   7542849286137479277 = 芯片类 / Chip
//   7467761529010634860 = 测试类 / Testing
//   7467761246949179500 = 运维类 / Maintenance
//   7178035552473448557 = 产品类 / Product
//   7178035552473464941 = 设计类 / Design
//   7178830559051858028 = 外语外派类 / Global Expatriate
//   7178759516879388781 = 服务类 / Service
//   7178035552473481325 = 运营类 / Operation
//   7178035552473497709 = 市场类 / Marketing
//   7178035552473514093 = 职能类 / Corporate Function
//   7178035552473530477 = 供应链类 / Supply Chain
//   7493065498218479788 = 汽车工程类 / Automotive Engineering
//   7493065498218496172 = 汽车销售类 / Automotive Sales
//   7493065498218512556 = 汽车服务类 / Automotive Service
//   7493065498218528940 = 数据类 / Data
//
// DIMENSION 2 — location_code_list (工作地点, city codes — 56 cities total)
//   CT_11=北京 CT_125=上海 CT_128=深圳 CT_154=武汉 CT_107=南京 CT_155=西安
//   CT_163=新加坡 CT_199=苏州 CT_66=济南 CT_25=大连 (+46 more)
//
// DIMENSION 3 — recruitment_id_list (campus pool filters)
//   "201" = 正式 (new-grad, matches default campus tab)
//   "202" = 实习 (intern — use portal-channel: internship for this pool)
//
// DIMENSION 4 — job_subject_list (special programs, campus pool, 2 active 2026-05)
//   "7532449299457327213" = 2026届境外校招计划  (overseas campus)
//   "7603687083995121983" = 2026届春季校招计划  (spring campus)
//
// ============================================================
// Detail page URLs (both return HTTP 200):
//   campus:     https://xiaomi.jobs.f.mioffice.cn/campus/position/${id}/detail
//   internship: https://xiaomi.jobs.f.mioffice.cn/internship/position/${id}/detail
//
// ============================================================
// Feishu/ATSX platform note:
//   Xiaomi uses its own Feishu fork (mioffice.cn) running ByteDance's ATSX
//   recruiting backend. The API is STRUCTURALLY IDENTICAL to jobs.bytedance.com —
//   same POST body shape, same response envelope (code/data/message), same field
//   names, same city codes (CT_xx). The ONLY differences are:
//     1. Domain: *.f.mioffice.cn instead of jobs.bytedance.com
//     2. Portal scoping via portal-channel / website-path headers
//   Any future company on Feishu Recruiting (feishu.cn/jobs.*.feishu.cn or
//   *.jobs.f.mioffice.cn) can be adapted from this file with ~10 lines of change.
//
// ============================================================
// ---- PositionSummary field mapping (Xiaomi → canonical) ----
//   post_id       ← item.id  (stringified)
//   title         ← item.title
//   project       ← item.job_function.name  (职能类别; job_category is null in campus)
//   recruit_label ← item.recruit_type.name  (e.g. "正式" / "实习")
//   bgs           ← ""  (not exposed in public search)
//   work_cities   ← item.city_info.name + city_list joined with " / " for multi-city
//   apply_url     ← https://xiaomi.jobs.f.mioffice.cn/campus/position/${id}/detail

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://xiaomi.jobs.f.mioffice.cn/api/v1";
const CAMPUS_PAGE = "https://xiaomi.jobs.f.mioffice.cn/campus/";
const INTERN_PAGE = "https://xiaomi.jobs.f.mioffice.cn/internship/";

const CAMPUS_DETAIL = (id: string) =>
  `https://xiaomi.jobs.f.mioffice.cn/campus/position/${encodeURIComponent(id)}/detail`;
const INTERN_DETAIL = (id: string) =>
  `https://xiaomi.jobs.f.mioffice.cn/internship/position/${encodeURIComponent(id)}/detail`;

function makeHeaders(channel: "campus" | "internship"): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "portal-channel": channel,
    "portal-platform": "pc",
    "website-path": channel,
    Referer: channel === "campus" ? CAMPUS_PAGE : INTERN_PAGE,
  };
}

// ---------- low-level call helper ----------

interface XmEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
  error?: unknown;
}

async function call<T>(
  path: string,
  body: unknown,
  channel: "campus" | "internship" = "campus"
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: makeHeaders(channel),
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

  let payload: XmEnvelope<T>;
  try {
    payload = (await response.json()) as XmEnvelope<T>;
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

interface RawJobFunction {
  id?: string;
  name?: string;
  en_name?: string;
}

interface RawRecruitType {
  id?: string;
  name?: string;
  en_name?: string;
  parent?: { id?: string; name?: string } | null;
}

interface RawJobPost {
  id?: string | number;
  title?: string;
  sub_title?: string | null;
  description?: string;
  requirement?: string;
  job_category?: { id?: string; name?: string } | null;
  job_function?: RawJobFunction | null;
  city_info?: RawCityInfo;
  city_list?: RawCityInfo[];
  recruit_type?: RawRecruitType;
  publish_time?: number;
  code?: string;
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

function summarizePosition(
  item: RawJobPost,
  channel: "campus" | "internship"
): PositionSummary {
  const id = String(item.id ?? "");
  const cityList = item.city_list ?? [];
  let work_cities: string;
  if (cityList.length > 1) {
    work_cities = cityList
      .map((c) => c.name ?? "")
      .filter(Boolean)
      .join(" / ");
  } else {
    work_cities = item.city_info?.name ?? (cityList[0]?.name ?? "");
  }
  // Xiaomi's campus API returns job_category as null; job_function carries the category name
  const project =
    item.job_function?.name ?? item.job_category?.name ?? "";
  const detailFn = channel === "internship" ? INTERN_DETAIL : CAMPUS_DETAIL;
  return {
    post_id: id,
    title: item.title ?? "",
    project,
    recruit_label: item.recruit_type?.name ?? "",
    bgs: "",
    work_cities,
    apply_url: id ? detailFn(id) : (channel === "internship" ? INTERN_PAGE : CAMPUS_PAGE),
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /**
   * Which portal pool to query.
   *   "campus"     → 正式 new-grad positions (~357 posts, default)
   *   "internship" → 实习 intern positions   (~729 posts)
   * Default: "campus".
   */
  channel?: "campus" | "internship";
  /**
   * Filter by recruitment_id_list.
   * In the campus channel the only meaningful value is "201" (正式).
   * In the internship channel "202" (实习) is the default.
   * Pass [] to omit the filter and get all types in the selected channel.
   */
  recruitmentIdList?: string[];
  /**
   * Filter by job_function IDs from /config/job/filters/campus → job_function_list.
   * e.g. ["7178759516879405165"] = 软件研发类 only.
   * See header comment for full taxonomy.
   */
  jobFunctionIdList?: string[];
  /**
   * Filter by city location codes (共56城市).
   * e.g. ["CT_11"] = 北京 only, ["CT_125","CT_128"] = 上海+深圳.
   */
  cityIdList?: string[];
  /**
   * Filter by special program/subject IDs.
   * Active (2026-05):
   *   "7532449299457327213" = 2026届境外校招计划
   *   "7603687083995121983" = 2026届春季校招计划
   */
  subjectIdList?: string[];
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * pageSize;
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const channel = opts.channel ?? "campus";

  const asStringList = (v: unknown): string[] | undefined => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.map(String);
  };

  // Default filter: 201=正式 in campus channel, 202=实习 in internship channel
  const defaultRecruitId = channel === "internship" ? "202" : "201";
  const recruitmentIdList =
    asStringList(opts.recruitmentIdList) ?? [defaultRecruitId];

  const payload: Record<string, unknown> = {
    keyword,
    limit: pageSize,
    offset,
    portal_type: 3,
    portal_entrance: 1,
    language: "zh",
    recruitment_id_list: recruitmentIdList,
  };

  const jobFunctionIdList = asStringList(opts.jobFunctionIdList);
  if (jobFunctionIdList?.length) {
    payload.job_function_id_list = jobFunctionIdList;
  }
  const cityIdList = asStringList(opts.cityIdList);
  if (cityIdList?.length) {
    payload.location_code_list = cityIdList;
  }
  const subjectIdList = asStringList(opts.subjectIdList);
  if (subjectIdList?.length) {
    payload.subject_id_list = subjectIdList;
  }

  const response = await call<RawSearchData>("/search/job/posts", payload, channel);
  if (!response.ok || !response.data) {
    return {
      ok: false,
      message: response.message,
      source: "xiaomi.jobs.f.mioffice.cn",
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.job_post_list ?? [];
  return {
    ok: true,
    source: "xiaomi.jobs.f.mioffice.cn",
    query: payload,
    channel,
    page,
    page_size: pageSize,
    total: response.data.count ?? rows.length,
    positions: rows.map((r) => summarizePosition(r, channel)),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 5);
  const channel = opts.channel ?? "campus";

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize, channel });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        source: "xiaomi.jobs.f.mioffice.cn",
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
    source: "xiaomi.jobs.f.mioffice.cn",
    channel,
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
// Xiaomi has no public per-post detail REST endpoint.
// We paginate the search and filter by id (same strategy as bytedance.ts).

export async function fetchPositionDetail(
  postId: string,
  opts: { channel?: "campus" | "internship" } = {}
) {
  const id = (postId ?? "").trim();
  const channel = opts.channel ?? "campus";
  if (!id) {
    return { ok: false, source: "xiaomi.jobs.f.mioffice.cn", message: "post_id is required" };
  }

  const pageSize = 100;
  const maxPages = 5;
  const defaultRecruitId = channel === "internship" ? "202" : "201";

  for (let page = 1; page <= maxPages; page++) {
    const offset = (page - 1) * pageSize;
    const payload = {
      keyword: "",
      limit: pageSize,
      offset,
      portal_type: 3,
      portal_entrance: 1,
      language: "zh",
      recruitment_id_list: [defaultRecruitId],
    };
    const response = await call<RawSearchData>("/search/job/posts", payload, channel);
    if (!response.ok || !response.data) break;

    const posts = response.data.job_post_list ?? [];
    const found = posts.find((p) => String(p.id) === id);
    if (found) {
      const summary = summarizePosition(found, channel);
      return {
        ok: true,
        source: "xiaomi.jobs.f.mioffice.cn",
        post_id: id,
        title: found.title ?? "",
        direction: found.sub_title ?? "",
        description: found.description ?? "",
        requirements: found.requirement ?? "",
        work_cities: found.city_list ?? (found.city_info ? [found.city_info] : []),
        apply_url: summary.apply_url,
      };
    }
    if (posts.length < pageSize) break;
  }

  return {
    ok: false,
    source: "xiaomi.jobs.f.mioffice.cn",
    post_id: id,
    message: `post ${id} not found in ${channel} pool (searched up to ${maxPages * pageSize} posts)`,
  };
}

// ---------- fetchDictionaries ----------

interface RawFilterCity {
  code?: string;
  name?: string;
  en_name?: string;
}

interface RawFilterFunction {
  id?: string;
  name?: string;
  en_name?: string;
  active_status?: number;
}

interface RawFilterSubject {
  id?: string;
  name?: { zh_cn?: string; en_us?: string | null; i18n?: string };
  limit_count?: number | null;
  active_status?: number;
}

interface RawFilterData {
  job_function_list?: RawFilterFunction[];
  city_list?: RawFilterCity[];
  recruitment_type_list?: Array<{ id?: string; name?: string; en_name?: string }> | null;
  job_subject_list?: RawFilterSubject[];
}

let _filterCache:
  | {
      ok: true;
      source: string;
      jobFunctions: Array<{ id: string; name: string; en_name: string }>;
      cities: Array<{ code: string; name: string; en_name: string }>;
      subjects: Array<{ id: string; name: string }>;
      recruitmentTypes: Array<{ id: string; name: string; note: string }>;
    }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_filterCache !== null) return _filterCache;

  const url = `${API_ROOT}/config/job/filters/campus`;
  let response: Response;
  try {
    response = await fetch(url, { headers: makeHeaders("campus") });
  } catch (err) {
    const r = {
      ok: false as const,
      source: "xiaomi.jobs.f.mioffice.cn",
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
    _filterCache = r;
    return r;
  }

  if (!response.ok) {
    const r = {
      ok: false as const,
      source: "xiaomi.jobs.f.mioffice.cn",
      message: `HTTP ${response.status}`,
    };
    _filterCache = r;
    return r;
  }

  let payload: { code?: number; data?: RawFilterData; message?: string };
  try {
    payload = await response.json();
  } catch (err) {
    const r = {
      ok: false as const,
      source: "xiaomi.jobs.f.mioffice.cn",
      message: `bad JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
    _filterCache = r;
    return r;
  }

  if (payload.code !== 0 || !payload.data) {
    const r = {
      ok: false as const,
      source: "xiaomi.jobs.f.mioffice.cn",
      message: payload.message ?? "upstream error",
    };
    _filterCache = r;
    return r;
  }

  const d = payload.data;

  const jobFunctions = (d.job_function_list ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    en_name: f.en_name ?? "",
  }));

  const cities = (d.city_list ?? []).map((c) => ({
    code: c.code ?? "",
    name: c.name ?? "",
    en_name: c.en_name ?? "",
  }));

  const subjects = (d.job_subject_list ?? []).map((s) => ({
    id: s.id ?? "",
    name: s.name?.zh_cn ?? s.name?.i18n ?? "",
  }));

  // Recruitment type list only exposes "校招" (id=2) as the parent.
  // The children 201=正式, 202=实习 are inferred from actual recruit_type fields.
  const recruitmentTypes = [
    { id: "201", name: "正式", note: "campus new-grad (portal-channel: campus, ~357 posts)" },
    { id: "202", name: "实习", note: "intern (portal-channel: internship, ~729 posts)" },
  ];

  const result = {
    ok: true as const,
    source: "xiaomi.jobs.f.mioffice.cn",
    jobFunctions,
    cities,
    subjects,
    recruitmentTypes,
  };
  _filterCache = result;
  return result;
}

// ---------- stub notices (no public notices endpoint) ----------

const STUB_NOTICES = {
  ok: false as const,
  source: "xiaomi.jobs.f.mioffice.cn",
  message: "Xiaomi: no public notices endpoint",
};

export async function listNotices(): Promise<typeof STUB_NOTICES> {
  return STUB_NOTICES;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "xiaomi.jobs.f.mioffice.cn",
    message: "Xiaomi: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "xiaomi.jobs.f.mioffice.cn",
    message: "Xiaomi: no public notices endpoint",
  };
}

// ---------- matchResume ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number; channel?: "campus" | "internship" } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 20);
  const channel = opts.channel ?? "campus";
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false,
      source: "xiaomi.jobs.f.mioffice.cn",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 100, channel });
  if (!list.ok) {
    return {
      ok: false,
      source: "xiaomi.jobs.f.mioffice.cn",
      message: list.message,
      positions: [],
    };
  }

  const defaultRecruitId = channel === "internship" ? "202" : "201";
  const payload = {
    keyword,
    limit: 100,
    offset: 0,
    portal_type: 3,
    portal_entrance: 1,
    language: "zh",
    recruitment_id_list: [defaultRecruitId],
  };
  const raw = await call<RawSearchData>("/search/job/posts", payload, channel);
  const rawPosts: RawJobPost[] = raw.ok ? (raw.data?.job_post_list ?? []) : [];

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
    source: "xiaomi.jobs.f.mioffice.cn",
    channel,
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
