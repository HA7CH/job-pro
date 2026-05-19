// Thin client for 智元机器人 (Agibot / AGIBOT Innovation) campus & social recruiting.
//
// ============================================================
// API DISCOVERY (probed 2026-05)
//
// Infrastructure:
//   The corporate site www.agibot.com links to the Lark Hire (飞书招聘) SaaS portal:
//     https://agirobot.jobs.feishu.cn/
//   which hosts four separate recruiting portals:
//     /index               — 高端岗位 (senior / executive)   website_id: 7314554416651995443
//     /socialrecruitment   — 社会招聘 (social / experienced)  website_id: 7212468858346785082
//     /campusrecruitment   — 校园招聘 (campus / new-grad)     website_id: 7212468542670309689
//     /internrecruitment   — 实习招聘 (intern)
//
// Dead ends probed:
//   https://www.zhiyuan-robot.com/careers  — returns 404 (redirects to agibot.com.cn)
//   https://careers.agibot.com/            — connection refused / no server
//   https://hr.agibot.com/                 — connection refused / no server
//   Moka orgId 145143                      — auth-gated, not publicly accessible
//
// WORKING APPROACH — Lark Hire SaaS JSON API:
//   All four portals share a single unauthenticated POST endpoint:
//     POST https://agirobot.jobs.feishu.cn/api/v1/search/job/posts
//   The API returns all 661+ positions (social + campus + intern combined) without
//   any portal-type filter; the Referer header does not affect which posts are returned.
//
//   Discovered by reverse-engineering the webpack bundle
//   lf-package-cn.feishucdn.com/…/saas-career/static/js/4026.f23f1edc.js:
//     Module 59235 sets eW = "" (relative host), so i = "/api/v1".
//     getPositionList  = i + "/search/job/posts"    (POST, page_index + page_size)
//     getPositionDetail = i + "/job/posts/" + id    (GET)
//     getPositionFilter = i + "/config/job/filters/" + path (GET)
//
// API call details (POST /api/v1/search/job/posts):
//   Request body: { keyword, page_size, page_index, ... }
//   Response:     { code:0, data:{ job_post_list:[...], count:<int> } }
//   count: 661 (all portals combined, 2026-05 snapshot)
//
// Note: department_id is always null in public search results — no BG/部门 field available.
//
// ============================================================
// PositionSummary field mapping (canonical keys — matches all other adapters):
//   post_id       — item.id (string)
//   title         — item.title
//   project       — item.job_category.name (e.g. "研发" / "智能制造 / 工业互联网")
//   recruit_label — item.recruit_type.name + " / " + item.recruit_type.parent.name
//                   (e.g. "全职 / 社招" / "实习 / 校招")
//   bgs           — "" (department_id is always null in public API)
//   work_cities   — city_list[].name joined with " / " (e.g. "上海" / "北京 / 上海")
//   apply_url     — https://agirobot.jobs.feishu.cn/socialrecruitment/position/{id}/detail
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume, pickDistinctiveTerms } from "./tencent.js";
export { checkResume };

const SOURCE = "agirobot.jobs.feishu.cn";
const API_ROOT = "https://agirobot.jobs.feishu.cn/api/v1";
const PORTAL_BASE = "https://agirobot.jobs.feishu.cn";
const LIST_PAGE = `${PORTAL_BASE}/socialrecruitment`;
const DETAIL_URL = (id: string) =>
  `${PORTAL_BASE}/socialrecruitment/position/${encodeURIComponent(id)}/detail`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Origin: PORTAL_BASE,
  Referer: LIST_PAGE,
};

// ---------- API envelope ----------

interface AgibotEnvelope<T> {
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

  let payload: AgibotEnvelope<T>;
  try {
    payload = (await response.json()) as AgibotEnvelope<T>;
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
  i18n_name?: string;
}

interface RawRecruitType {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  depth?: number;
  parent?: RawRecruitType | null;
}

interface RawJobCategory {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  depth?: number;
}

interface RawJobPost {
  id?: string | number;
  title?: string;
  sub_title?: string | null;
  description?: string;
  requirement?: string;
  job_category?: RawJobCategory | null;
  city_info?: RawCityInfo | null;
  city_list?: RawCityInfo[] | null;
  recruit_type?: RawRecruitType | null;
  publish_time?: number;
  job_hot_flag?: unknown;
  job_subject?: unknown;
  code?: string | null;
  department_id?: string | null;
  job_function?: unknown | null;
  job_process_id?: string | null;
  process_type?: number | null;
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

  // work_cities: prefer city_list for multi-city; fall back to city_info
  const cityList = item.city_list ?? [];
  let work_cities: string;
  if (cityList.length >= 1) {
    work_cities = cityList.map((c) => c.name ?? "").filter(Boolean).join(" / ");
  } else {
    work_cities = item.city_info?.name ?? "";
  }

  // recruit_label: "全职 / 社招" or "实习 / 校招" style
  const rt = item.recruit_type;
  const rtName = rt?.name ?? "";
  const rtParent = rt?.parent?.name ?? "";
  const recruit_label = rtParent ? `${rtName} / ${rtParent}` : rtName;

  return {
    post_id: id,
    title: item.title ?? "",
    project: item.job_category?.name ?? "",
    recruit_label,
    bgs: "", // department_id is always null in public search results
    work_cities,
    apply_url: id ? DETAIL_URL(id) : LIST_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const payload: Record<string, unknown> = {
    keyword,
    page_size: pageSize,
    page_index: page,
  };

  const response = await call<RawSearchData>("/search/job/posts", payload);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: SOURCE,
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.job_post_list ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    query: payload,
    page,
    page_size: pageSize,
    total: response.data.count ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 10); // up to 1000 posts

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message,
        source: SOURCE,
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
    source: SOURCE,
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

interface RawDetailData {
  job_post_detail?: {
    id?: string | number;
    title?: string;
    sub_title?: string | null;
    description?: string;
    requirement?: string;
    job_category?: RawJobCategory | null;
    city_list?: RawCityInfo[] | null;
    recruit_type?: RawRecruitType | null;
  };
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return { ok: false as const, source: SOURCE, message: "post_id is required" };
  }

  const url = `${API_ROOT}/job/posts/${encodeURIComponent(id)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { ...DEFAULT_HEADERS, Referer: DETAIL_URL(id) },
    });
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let payload: AgibotEnvelope<RawDetailData>;
  try {
    payload = (await response.json()) as AgibotEnvelope<RawDetailData>;
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `bad JSON: ${err instanceof Error ? err.message : err}`,
    };
  }

  if (payload.code !== 0 || !payload.data?.job_post_detail) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: payload.message ?? "upstream error",
    };
  }

  const d = payload.data.job_post_detail;
  const cities = (d.city_list ?? []).map((c) => c.name ?? "").filter(Boolean);

  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(d.id ?? id),
    title: d.title ?? "",
    direction: d.sub_title ?? "",
    project: d.job_category?.name ?? "",
    recruit_label: d.recruit_type?.name ?? "",
    description: d.description ?? "",
    requirements: d.requirement ?? "",
    work_cities: cities,
    apply_url: DETAIL_URL(String(d.id ?? id)),
  };
}

// ---------- fetchDictionaries ----------
// Returns the job-type and city taxonomy from GET /api/v1/config/job/filters/index

interface RawFilterJobType {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  depth?: number;
  parent?: RawFilterJobType | null;
  children?: RawFilterJobType[] | null;
}

interface RawFilterCity {
  code?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
}

interface RawFilterData {
  job_type_list?: RawFilterJobType[];
  city_list?: RawFilterCity[];
  recruitment_type_list?: RawRecruitType[] | null;
  job_subject_list?: unknown[] | null;
}

export async function fetchDictionaries() {
  const url = `${API_ROOT}/config/job/filters/index`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `HTTP ${response.status}`,
    };
  }

  let payload: AgibotEnvelope<RawFilterData>;
  try {
    payload = (await response.json()) as AgibotEnvelope<RawFilterData>;
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `bad JSON: ${err instanceof Error ? err.message : err}`,
    };
  }

  if (payload.code !== 0 || !payload.data) {
    return {
      ok: false as const,
      source: SOURCE,
      message: payload.message ?? "upstream error",
    };
  }

  const d = payload.data;
  const jobCategories = (d.job_type_list ?? []).map((c) => ({
    id: c.id ?? "",
    name: c.name ?? "",
    en_name: c.en_name ?? "",
    depth: c.depth ?? 1,
    parent_id: c.parent?.id ?? null,
  }));
  const cities = (d.city_list ?? []).map((c) => ({
    code: c.code ?? "",
    name: c.name ?? "",
    en_name: c.en_name ?? "",
  }));

  return {
    ok: true as const,
    source: SOURCE,
    portal: PORTAL_BASE,
    portals: {
      index: `${PORTAL_BASE}/index`,
      social: `${PORTAL_BASE}/socialrecruitment`,
      campus: `${PORTAL_BASE}/campusrecruitment`,
      intern: `${PORTAL_BASE}/internrecruitment`,
    },
    note:
      "All four Agibot recruiting portals share a single public API endpoint at " +
      "/api/v1/search/job/posts. department_id is always null in public results " +
      "(no BG/部门 exposed). Total ~661 positions across social + campus + intern.",
    jobCategories,
    cities,
  };
}

// ---------- notices (no public endpoint) ----------

const NOTICES_STUB = {
  ok: false as const,
  source: SOURCE,
  message: "Agibot: no public notices or announcement endpoint available",
};

export async function listNotices(): Promise<typeof NOTICES_STUB> {
  return NOTICES_STUB;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return NOTICES_STUB;
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return NOTICES_STUB;
}

// ---------- matchResume ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 20);
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false as const,
      source: SOURCE,
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
  if (!list.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: list.message,
      positions: [] as PositionSummary[],
    };
  }

  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];

  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities, p.post_id].join(" ");
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
        : ["no specific keyword overlap — surfaced from initial keyword search"];
    return { ...s.position, match_reasons: mr };
  });

  return {
    ok: true as const,
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------
import { makeFeishuApplyFn } from "./feishu.js";

export const fetchApplicationSchema = makeFeishuApplyFn({
  host: "agirobot.jobs.feishu.cn",
  source: "agirobot.jobs.feishu.cn",
  channel: "campus",
  applyUrlPrefix: "https://agirobot.jobs.feishu.cn/campus/position",
  fetchTitle: (id) => fetchPositionDetail(id),
});
