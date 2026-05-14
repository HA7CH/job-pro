// Thin client for 理想汽车 (Li Auto) public recruiting API at www.lixiang.com.
//
// Both campus (校园/实习) and social-hire (社招) job feeds are backed by the
// same API server at api-web.lixiang.com.  All endpoints are unauthenticated
// GET requests; POST with a JSON body returns HTTP 100012 "no access" for all
// public-facing paths.
//
// ============================================================
// Endpoint inventory (probed 2026-05, JS bundle employ/index.3f85ec75.js):
//
//   GET https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/school/job-page
//       Required params: page=<int>, page_size=<int>
//       Optional params: search=<string>  — keyword filter on title (server-side)
//                        project_id=<int> — filter by recruit project (see taxonomy)
//       Response: { code:0, message:"成功", data:{ page, page_size, total_pages,
//                   total_count, items:[...] } }
//       Total campus + intern listings as of 2026-05: ~361 posts
//
//   GET https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/social/job-page
//       Same params as school endpoint.
//       Total social-hire listings: ~2185 posts
//
//   GET https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/job/detail
//       Required params: job_id=<int>
//       Response: { code:0, data:{ id, code, title, description, requirements,
//                   job_mode_name, job_mode, first_job_function_title,
//                   second_job_function_title, location_title, department_title,
//                   subject_name, limit_count, hire_mode, is_collect, is_apply, is_prior } }
//
//   GET https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/school/project/list
//       No params required.
//       Returns: { data:{ item:[{ id, name }] } }
//       (Recruit-project taxonomy for campus posts.)
//
//   GET https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/school/job/function
//       Returns: job-function category hierarchy for campus jobs.
//
// ============================================================
// Note: query params that have NO effect on school/job-page output (silently ignored):
//   keyword, title, q, job_mode, job_mode_name, hire_mode,
//   first_job_function_id, second_job_function_id, subject_id, location_title.
// Only `search` and `project_id` are effective server-side filters.
//
// ============================================================
// Recruit-project taxonomy (GET /recruit/school/project/list, probed 2026-05):
//   id:13  2026"理想+"  (~6 posts)
//   id:12  2026校园招聘 (~125 posts)
//   id:11  2025春招     (~3 posts)
//   id:10  2024校园招聘 (~0 posts)
//   id:9   2025秋招     (~1 post)
//   id:5   实习生招聘   (~226 posts)
//
// ============================================================
// Job-function category hierarchy (GET /recruit/school/job/function, probed 2026-05):
//   id:8   整车研发       (30 posts) — 底盘, 车身&内外饰, 热管理, 电池开发, 动力驱动,
//                                     增程系统, 整车集成, 研发质量, 虚拟开发与验证,
//                                     制造工程, 材料开发, 座舱, 空气动力, 车载硬件,
//                                     电子电器架构, 硬件测试, 工业化
//   id:1   算法与软件     (71 posts) — 算法, 软件测试, 技术运维, 信息安全, 车辆控制,
//                                     前端开发, 后端开发, 操作系统及嵌入式开发,
//                                     数据开发, 数据分析
//   id:92  芯片研发       (4 posts)  — 芯片前端设计, 芯片后端设计, 软件设计, 芯片架构
//   id:21  产品           (4 posts)  — 软件产品, 硬件产品, 产品运营
//   id:29  供应链与智能制造 (2 posts) — 质量安全, 采购与供应计划, 制造
//   id:34  市场与销售服务 (70 posts) — 储备管理, 零售, 交付, 质量运营, 售后运营,
//                                     商业拓展, 销售规划与运营
//
// ============================================================
// Job-mode codes (job_mode field in item responses):
//   "201" = 正式   (new-grad / full-time campus hire)
//   "202" = 实习   (intern)
//   ""    = 全职   (social-hire full-time)
//
// ============================================================
// Detail page URL: https://www.lixiang.com/job/detail/<id>.html
// Campus listing:  https://www.lixiang.com/employ/campus.html
// Social listing:  https://www.lixiang.com/employ/social.html
// Employ home:     https://www.lixiang.com/employ.html
//
// ---- PositionSummary field mapping (Li Auto → canonical) ----
//   post_id       ← String(item.id)
//   title         ← item.title
//   project       ← item.first_job_function_title ?? item.second_job_function_title
//                   (function category, closest equivalent to Tencent's projectName)
//   recruit_label ← item.job_mode_name  (e.g. "实习" / "正式" / "全职")
//   bgs           ← ""  (Li Auto does not expose a BG/事业群 field in the public API)
//   work_cities   ← item.location_title
//   apply_url     ← https://www.lixiang.com/job/detail/<id>.html

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit";
const EMPLOY_PAGE = "https://www.lixiang.com/employ.html";
const CAMPUS_PAGE = "https://www.lixiang.com/employ/campus.html";
const SOCIAL_PAGE = "https://www.lixiang.com/employ/social.html";
const DETAIL_PAGE = (id: string | number) =>
  `https://www.lixiang.com/job/detail/${encodeURIComponent(String(id))}.html`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: EMPLOY_PAGE,
};

// ---------- low-level call helper ----------

interface LiEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

async function get<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  referer?: string
): Promise<{ ok: boolean; data?: T; message: string }> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${API_ROOT}${path}${qs ? "?" + qs : ""}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...(referer ? { Referer: referer } : {}) },
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

  let payload: LiEnvelope<T>;
  try {
    payload = (await response.json()) as LiEnvelope<T>;
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

interface RawJobItem {
  id?: number | string;
  code?: string;
  title?: string;
  job_mode?: string;
  job_mode_name?: string;
  hire_mode?: number;
  first_job_function_title?: string | null;
  second_job_function_title?: string | null;
  department_title?: string | null;
  location_title?: string | null;
  subject_name?: string | null;
  is_collect?: number;
  is_prior?: number;
}

interface RawJobDetail extends RawJobItem {
  description?: string;
  requirements?: string;
  limit_count?: string;
  is_apply?: number;
}

interface RawPageData {
  page?: number;
  page_size?: number;
  total_pages?: number;
  total_count?: number;
  items?: RawJobItem[];
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

function summarizePosition(item: RawJobItem): PositionSummary {
  const id = String(item.id ?? "");
  const project =
    (item.first_job_function_title ?? item.second_job_function_title ?? "").trim();
  return {
    post_id: id,
    title: item.title ?? "",
    project,
    recruit_label: item.job_mode_name ?? "",
    bgs: "",
    work_cities: item.location_title ?? "",
    apply_url: id ? DETAIL_PAGE(id) : EMPLOY_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  /** Free-text keyword filter on job title (server-side). */
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Recruit-project filter (campus endpoint only).
   *  Known IDs (probed 2026-05):
   *    13 = 2026"理想+"  (~6 posts)
   *    12 = 2026校园招聘  (~125 posts)
   *    11 = 2025春招      (~3 posts)
   *    9  = 2025秋招      (~1 post)
   *    5  = 实习生招聘    (~226 posts)  */
  projectId?: number;
  /** If true (default), query the campus+intern endpoint (~361 posts).
   *  Set false to query the social-hire endpoint (~2185 posts). */
  campusOnly?: boolean;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const campusOnly = opts.campusOnly !== false; // default true

  const path = campusOnly ? "/school/job-page" : "/social/job-page";
  const referer = campusOnly ? CAMPUS_PAGE : SOCIAL_PAGE;

  const params: Record<string, string | number | undefined> = {
    page,
    page_size: pageSize,
  };
  if (keyword) params.search = keyword;
  if (campusOnly && opts.projectId !== undefined) params.project_id = opts.projectId;

  const response = await get<RawPageData>(path, params, referer);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: "www.lixiang.com",
      query: params,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.items ?? [];
  return {
    ok: true as const,
    source: "www.lixiang.com",
    query: params,
    page,
    page_size: pageSize,
    total: response.data.total_count ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 10);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message,
        source: "www.lixiang.com",
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
    source: "www.lixiang.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: "www.lixiang.com", message: "post_id is required" };

  const response = await get<RawJobDetail>("/job/detail", { job_id: id }, EMPLOY_PAGE);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      source: "www.lixiang.com",
      post_id: id,
      message: response.message || "no detail returned",
    };
  }

  const raw = response.data;
  return {
    ok: true as const,
    source: "www.lixiang.com",
    post_id: String(raw.id ?? id),
    code: raw.code ?? "",
    title: raw.title ?? "",
    job_mode: raw.job_mode ?? "",
    recruit_label: raw.job_mode_name ?? "",
    first_job_function: raw.first_job_function_title ?? "",
    second_job_function: raw.second_job_function_title ?? "",
    department: raw.department_title ?? "",
    work_cities: raw.location_title ?? "",
    subject: raw.subject_name ?? "",
    description_html: raw.description ?? "",
    requirements_html: raw.requirements ?? "",
    limit_count: raw.limit_count ?? "",
    apply_url: DETAIL_PAGE(raw.id ?? id),
  };
}

// ---------- fetchDictionaries ----------

interface RawProjectItem {
  id?: number;
  name?: string;
}

interface RawProjectList {
  item?: RawProjectItem[];
}

interface RawFunctionCategory {
  id?: number;
  title?: string;
  job_count?: number;
  description?: string;
  category_desc?: string;
  list?: Array<{ id?: number; title?: string }>;
}

interface RawFunctionList {
  list?: RawFunctionCategory[];
}

export async function fetchDictionaries() {
  const [projects, functions] = await Promise.all([
    get<RawProjectList>("/school/project/list", {}, CAMPUS_PAGE),
    get<RawFunctionList>("/school/job/function", {}, CAMPUS_PAGE),
  ]);

  const recruitProjects = (projects.data?.item ?? []).map((p) => ({
    id: p.id ?? 0,
    name: p.name ?? "",
  }));

  const jobFunctions = (functions.data?.list ?? []).map((cat) => ({
    id: cat.id ?? 0,
    title: cat.title ?? "",
    job_count: cat.job_count ?? 0,
    description: cat.description ?? "",
    sub_functions: (cat.list ?? []).map((s) => ({
      id: s.id ?? 0,
      title: s.title ?? "",
    })),
  }));

  return {
    ok: projects.ok && functions.ok,
    source: "www.lixiang.com",
    api_host: "api-web.lixiang.com",
    verified_at: new Date().toISOString(),
    campus_page: CAMPUS_PAGE,
    social_page: SOCIAL_PAGE,
    recruit_projects: recruitProjects,
    job_functions: jobFunctions,
    job_mode_codes: [
      { code: "201", label: "正式", note: "campus new-grad full-time" },
      { code: "202", label: "实习", note: "intern (campus)" },
      { code: "",    label: "全职", note: "social-hire full-time" },
    ],
    note:
      "Filter params: use `search` for keyword, `project_id` for recruit project (campus only). " +
      "Campus endpoint: ~361 total (201=正式, 202=实习 mixed). " +
      "Social endpoint: ~2185 total.",
  };
}

// ---------- notices (no public endpoint) ----------

const STUB_NOTICE = {
  ok: false as const,
  source: "www.lixiang.com",
  message: "Li Auto: no public notices/announcements endpoint",
};

export async function listNotices(): Promise<typeof STUB_NOTICE> {
  return STUB_NOTICE;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: "www.lixiang.com", message: "Li Auto: no public notices endpoint" };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: "www.lixiang.com", message: "Li Auto: no public notices endpoint" };
}

// ---------- matchResume ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 30);
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false as const,
      source: "www.lixiang.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");

  // Fetch campus + intern listings with keyword filter
  const list = await searchPositions({ keyword, page: 1, pageSize: 100, campusOnly: true });
  if (!list.ok) {
    return {
      ok: false as const,
      source: "www.lixiang.com",
      message: list.message,
      positions: [] as PositionSummary[],
    };
  }

  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];

  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    // Fall back: return the first N positions regardless of score
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
        : ["no specific keyword overlap — surfaced from initial keyword search"];
    return { ...s.position, match_reasons: mr };
  });

  return {
    ok: true as const,
    source: "www.lixiang.com",
    extracted_terms: terms,
    city_preferences: cities,
    keyword_used: keyword,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
