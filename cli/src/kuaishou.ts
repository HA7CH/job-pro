// Thin client for Kuaishou's public campus-recruiting API at campus.kuaishou.cn.
//
// All endpoints are unauthenticated; the server enforces Referer to discourage
// cross-site embedding.  The campus portal (formerly zhaopin.kuaishou.com, now
// redirected to zhaopin.kuaishou.cn, with the actual API on campus.kuaishou.cn)
// is a React SPA backed by a Spring-Boot JSON API.
//
// ============================================================
// API discovery (probed 2026-05, campus JS bundle main.e3c87842.js):
//
//   Base: https://campus.kuaishou.cn/recruit/campus/e
//
//   POST /api/v1/open/positions/simple
//        Payload: { pageNum, pageSize, positionCategoryCodes?, workLocationCodes?,
//                   positionNatureCode?, positionLabel?, recruitSubProjectCode? }
//        Response: { code:0, message:"OK", result:{ total, list:[...], pages, ... } }
//        Note: the `keyword` field is accepted but silently ignored — the server
//        returns the full unfiltered list regardless of keyword value.  There is
//        no functional server-side text search on this endpoint.
//        Default (no filter): 441 positions total (校招 + 实习 combined).
//
//   GET  /api/v1/dictionary/{type}   (type is a literal path segment)
//        GET /api/v1/dictionary/positionCategory → full 2-level category tree.
//        GET /api/v1/dictionary/workLocation     → all city codes + names.
//
//   GET  /api/v1/open/sub-project/list
//        Returns the full list of recruit sub-projects (年度招聘批次) including:
//          "20261749721165" = 2026应届生 (fulltime, active)
//          "20261707035672" = 2026实习生 (intern, active)
//          "20251718874803" = 2025应届生 (fulltime, active)
//          "20251707035672" = 2025实习生 (intern, active)
//          ... and older cohorts
//
// ============================================================
// Filter semantics (probed 2026-05):
//   positionNatureCode="fulltime" → 校招/正式 (~207 posts — matches 校园招聘 tab)
//   positionNatureCode="intern"   → 实习 (~234 posts)
//   No positionNatureCode          → all (~441 posts)
//   recruitSubProjectCode=code    → specific cohort (e.g. 2026届正式 = 205 posts)
//   positionLabel="kstar"        → 快Star-X elite track (~77 posts)
//   workLocationCodes=["beijing"] → Beijing only (~419 posts across all types)
//   positionCategoryCodes=["algorithm"] → algorithm category (~163 posts)
//
// ============================================================
// Position category taxonomy (GET /api/v1/dictionary/positionCategory, 2026-05):
//
//   Parent "algorithm"  算法类
//     J1001 机器学习       J1002 数据科学       J1003 自然语言处理
//     J1004 搜索           J1005 推荐           J1006 广告
//     J1007 计算机视觉     J1008 计算机图形学   J1009 视频增强和处理
//     J1010 音频处理       J1011 视频编解码     J1012 网络传输
//     J1013 系统架构
//   Parent "engeering"  工程类  (note: upstream typo)
//     J1014 服务端         J1015 前端           J1016 客户端
//     J1017 测试测开       J1018 数据研发       J1019 安全
//     J1020 系统架构
//   Parent "production" 产品类
//     J1021 策略产品       J1022 用户产品C端    J1023 海外产品
//     J1024 平台产品B端    J1025 数据产品       J1026 产品运营
//   Parent "operation"  运营类
//     J1027 客户运营       J1028 用户运营       J1029 内容运营
//     J1030 策略运营       J1031 渠道运营       J1032 行业运营
//     J1033 社区安全运营   J1034 内容质量运营   J1035 海外运营   J1036 业务运营
//   Parent "marketing"  市场类   (no children in active list)
//   Parent "design"     设计类   (no children in active list)
//   Parent "function"   职能类   (no children in active list)
//   Parent "analysis"   战略分析类 (no children in active list)
//   Parent "gamePlanning" 游戏类 (no children in active list)
//   Parent "PM"         项目管理类 (no children in active list)
//   Parent "sales"      销售类   (no children in active list)
//
// ============================================================
// City codes (GET /api/v1/dictionary/workLocation, 2026-05, 38 total):
//   beijing=北京  shanghai=上海  Guangzhou=广州  Shenzhen=深圳  Hangzhou=杭州
//   suzhou=苏州   Wuhan=武汉     Chengdu=成都    Tianjin=天津   Jinan=济南
//   qingdao=青岛  zhengzhou=郑州 chongqing=重庆  changsha=长沙  dalian=大连
//   Haerbin=哈尔滨 Shenyang=沈阳 Singapore=新加坡 and more.
//
// ============================================================
// NOTE on keyword search: The positions/simple endpoint does NOT support
// server-side text search.  Client-side filtering is applied in matchResume()
// by scoring position name + description + demand against resume signals.
//
// ============================================================
// ---- PositionSummary field mapping (Kuaishou → canonical) ----
//   post_id       ← item.code   (UUID string, stable, used in detail URL)
//   title         ← item.name
//   project       ← item.positionCategoryCode  (e.g. "J1014" = 服务端)
//   recruit_label ← item.positionNatureCode  ("fulltime" or "intern")
//   bgs           ← ""  (Kuaishou does not expose BG in public API)
//   work_cities   ← item.workLocationDicts[*].name joined with " / "
//   apply_url     ← https://campus.kuaishou.cn/recruit/campus/e/#/campus/job-info/?code={code}

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_BASE =
  "https://campus.kuaishou.cn/recruit/campus/e";
const CAMPUS_PAGE = `${API_BASE}/#/campus/index/`;
const DETAIL_URL = (code: string) =>
  `${API_BASE}/#/campus/job-info/?code=${encodeURIComponent(code)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Referer: CAMPUS_PAGE,
  Origin: "https://campus.kuaishou.cn",
};

// ---------- low-level helpers ----------

interface KsEnvelope<T> {
  code?: number;
  message?: string;
  result?: T;
}

async function post<T>(
  path: string,
  body: unknown
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_BASE}${path}`;
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
  let payload: KsEnvelope<T>;
  try {
    payload = (await response.json()) as KsEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return {
    ok: payload.code === 0,
    data: payload.result,
    message: payload.message ?? (payload.code === 0 ? "ok" : "upstream error"),
  };
}

async function get<T>(
  path: string
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: DEFAULT_HEADERS,
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
  let payload: KsEnvelope<T>;
  try {
    payload = (await response.json()) as KsEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return {
    ok: payload.code === 0,
    data: payload.result,
    message: payload.message ?? (payload.code === 0 ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface RawWorkLocation {
  name?: string;
  code?: string;
}

interface RawPosition {
  id?: number;
  code?: string;
  name?: string;
  positionNatureCode?: string;   // "fulltime" | "intern"
  positionCategoryCode?: string; // e.g. "J1014" = 服务端
  recruitProjectCode?: string;   // e.g. "schoolr"
  recruitSubProjectCode?: string;// e.g. "20261749721165"
  positionLabel?: string | null; // e.g. "kstar" for 快Star-X track
  departmentCode?: string | null;
  departmentName?: string | null;
  description?: string;
  positionDemand?: string;
  workLocationDicts?: RawWorkLocation[];
  releaseTime?: string;
  updateTime?: number;
}

interface RawPageResult {
  total?: number;
  list?: RawPosition[];
  pages?: number;
  pageNum?: number;
  pageSize?: number;
}

// ---------- PositionSummary ----------

export interface PositionSummary {
  post_id: string;    // ← item.code (UUID, stable)
  title: string;      // ← item.name
  project: string;    // ← item.positionCategoryCode (e.g. "J1014")
  recruit_label: string; // ← item.positionNatureCode ("fulltime" | "intern")
  bgs: string;        // ← "" (not exposed by Kuaishou public API)
  work_cities: string; // ← item.workLocationDicts[*].name joined with " / "
  apply_url: string;   // ← DETAIL_URL(item.code)
}

function summarizePosition(item: RawPosition): PositionSummary {
  const code = item.code ?? String(item.id ?? "");
  const cities = (item.workLocationDicts ?? [])
    .map((c) => c.name ?? "")
    .filter(Boolean)
    .join(" / ");
  return {
    post_id: code,
    title: item.name ?? "",
    project: item.positionCategoryCode ?? "",
    recruit_label: item.positionNatureCode ?? "",
    bgs: "",
    work_cities: cities,
    apply_url: code ? DETAIL_URL(code) : CAMPUS_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  /** Page number, 1-based. Default: 1. */
  page?: number;
  /** Page size, 1–100. Default: 20. */
  pageSize?: number;
  /**
   * Filter by recruit type.
   * "fulltime" = 校招/正式 (~207 posts, matches 校园招聘 tab default).
   * "intern"   = 实习 (~234 posts).
   * Omit for all (~441 posts).
   */
  positionNatureCode?: "fulltime" | "intern";
  /**
   * Filter by position category codes.  May be parent codes or leaf codes.
   * Parent codes:  "algorithm" | "engeering" | "production" | "operation" |
   *                "marketing" | "design" | "function" | "analysis" |
   *                "gamePlanning" | "PM" | "sales"
   * Leaf codes:    "J1001"–"J1036" (see header comment for full mapping).
   * Examples: ["algorithm"] = 算法类 (~163 posts); ["J1014"] = 服务端 subset.
   */
  positionCategoryCodes?: string[];
  /**
   * Filter by city codes from GET /api/v1/dictionary/workLocation.
   * Examples: ["beijing"] = 北京 (~419); ["Shenzhen","Hangzhou"] = 深圳+杭州.
   */
  workLocationCodes?: string[];
  /**
   * Filter by special label.  Currently known value: "kstar" = 快Star-X elite
   * track (~77 posts).  Omit for all positions.
   */
  positionLabel?: string;
  /**
   * Filter by recruit sub-project (cohort) code from GET /api/v1/open/sub-project/list.
   * Active fulltime: "20261749721165" = 2026应届生 (~205 posts).
   * Note: intern cohort codes return 0 results — use positionNatureCode="intern" instead.
   */
  recruitSubProjectCode?: string;
}

function buildPayload(opts: SearchOptions, pageNum: number, pageSize: number) {
  const payload: Record<string, unknown> = { pageNum, pageSize };
  if (opts.positionNatureCode) payload.positionNatureCode = opts.positionNatureCode;
  if (opts.positionCategoryCodes?.length) payload.positionCategoryCodes = opts.positionCategoryCodes;
  if (opts.workLocationCodes?.length) payload.workLocationCodes = opts.workLocationCodes;
  if (opts.positionLabel) payload.positionLabel = opts.positionLabel;
  if (opts.recruitSubProjectCode) payload.recruitSubProjectCode = opts.recruitSubProjectCode;
  return payload;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const payload = buildPayload(opts, page, pageSize);

  const response = await post<RawPageResult>("/api/v1/open/positions/simple", payload);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: "campus.kuaishou.cn",
      query: payload,
      positions: [] as PositionSummary[],
      total: 0,
    };
  }
  const rows = response.data.list ?? [];
  return {
    ok: true as const,
    source: "campus.kuaishou.cn",
    query: payload,
    page,
    page_size: pageSize,
    total: response.data.total ?? rows.length,
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
        source: "campus.kuaishou.cn",
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
    source: "campus.kuaishou.cn",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
// Kuaishou's public /api/v1/open/position?code= endpoint returns code:1 for
// external requests — the detail HTML is rendered client-side from the same
// data already returned in the list.  We approximate detail by scanning up to
// 5 pages of 100 for the matching post_id (which is item.code).

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: "campus.kuaishou.cn", message: "post_id is required" };

  const pageSize = 100;
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const payload = buildPayload({}, page, pageSize);
    const response = await post<RawPageResult>("/api/v1/open/positions/simple", payload);
    if (!response.ok || !response.data) break;

    const posts = response.data.list ?? [];
    const found = posts.find((p) => (p.code ?? String(p.id ?? "")) === id);
    if (found) {
      const summary = summarizePosition(found);
      return {
        ok: true as const,
        source: "campus.kuaishou.cn",
        post_id: id,
        title: found.name ?? "",
        direction: found.positionCategoryCode ?? "",
        description: found.description ?? "",
        requirements: found.positionDemand ?? "",
        work_cities: found.workLocationDicts ?? [],
        recruit_label: found.positionNatureCode ?? "",
        release_time: found.releaseTime ?? "",
        apply_url: summary.apply_url,
      };
    }
    if (posts.length < pageSize) break;
  }

  return {
    ok: false as const,
    source: "campus.kuaishou.cn",
    post_id: id,
    message: `post ${id} not found in public search results (searched up to ${maxPages * pageSize} posts)`,
  };
}

// ---------- fetchDictionaries ----------

interface RawDictItem {
  id?: number;
  type?: string;
  code?: string;
  name?: string;
  parentCode?: string | null;
  ifActive?: boolean;
  children?: RawDictItem[] | null;
}

interface RawSubProject {
  id?: number;
  name?: string;
  code?: string;
  startTime?: string;
  year?: string;
  projectType?: string;
  active?: boolean;
}

interface RawSubProjectPage {
  total?: number;
  list?: RawSubProject[];
}

let _dictCache:
  | {
      ok: true;
      source: string;
      positionCategories: Array<{
        code: string;
        name: string;
        parentCode: string | null;
        children: Array<{ code: string; name: string }>;
      }>;
      cities: Array<{ code: string; name: string }>;
      subProjects: Array<{
        code: string;
        name: string;
        projectType: string;
        year: string;
        active: boolean;
        startTime: string;
      }>;
      positionNatureCodes: Array<{ code: string; note: string }>;
    }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_dictCache !== null) return _dictCache;

  const [catRes, cityRes, subProjRes] = await Promise.all([
    get<RawDictItem[]>("/api/v1/dictionary/positionCategory"),
    get<RawDictItem[]>("/api/v1/dictionary/workLocation"),
    get<RawSubProjectPage>("/api/v1/open/sub-project/list"),
  ]);

  const anyFailed = !catRes.ok || !cityRes.ok || !subProjRes.ok;
  if (anyFailed && !catRes.ok) {
    const r = { ok: false as const, source: "campus.kuaishou.cn", message: catRes.message };
    _dictCache = r;
    return r;
  }

  const positionCategories = (catRes.data ?? []).map((cat) => ({
    code: cat.code ?? "",
    name: cat.name ?? "",
    parentCode: cat.parentCode ?? null,
    children: (cat.children ?? []).map((c) => ({
      code: c.code ?? "",
      name: c.name ?? "",
    })),
  }));

  const cities = (cityRes.data ?? []).map((c) => ({
    code: c.code ?? "",
    name: c.name ?? "",
  }));

  const subProjects = (subProjRes.data?.list ?? []).map((p) => ({
    code: p.code ?? "",
    name: p.name ?? "",
    projectType: p.projectType ?? "",
    year: p.year ?? "",
    active: Boolean(p.active),
    startTime: p.startTime ?? "",
  }));

  const positionNatureCodes = [
    { code: "fulltime", note: "校招/正式 (~207 active posts)" },
    { code: "intern",   note: "实习 (~234 active posts)" },
  ];

  const result = {
    ok: true as const,
    source: "campus.kuaishou.cn",
    positionCategories,
    cities,
    subProjects,
    positionNatureCodes,
  };
  _dictCache = result;
  return result;
}

// ---------- stub notices ----------
// campus.kuaishou.cn has no public notices/announcements API.

const STUB_SRC = "campus.kuaishou.cn";
const STUB_MSG = "Kuaishou: no public notices endpoint";

export async function listNotices(): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return { ok: false, source: STUB_SRC, message: STUB_MSG };
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: STUB_SRC, message: STUB_MSG };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: STUB_SRC, message: STUB_MSG };
}

// ---------- matchResume ----------
// 1. Extract resume signals (tech terms + city preferences) via shared helpers.
// 2. Fetch all positions (up to 5 pages × 100) — no server-side keyword filter.
// 3. Score each position against title + category + description + demand blob.
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
      ok: false as const,
      source: "campus.kuaishou.cn",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  // Fetch a broad pool of posts (defaults to fulltime, up to 500 posts).
  const pool = await fetchAllPositions({ pageSize: 100, maxPages: 5 });
  if (!pool.ok) {
    return {
      ok: false as const,
      source: "campus.kuaishou.cn",
      message: pool.message,
      positions: [] as PositionSummary[],
    };
  }

  // We already have description + positionDemand in the list response, so no
  // second fetch is needed.  We need raw items for those fields though — re-fetch
  // 1 page to get raw data.  Actually the full data is in PositionSummary's
  // associated raw items held in pool; since we only have summaries at this point,
  // re-fetch page 1 raw to build a lookup.
  const rawLookup = new Map<string, RawPosition>();
  for (let pg = 1; pg <= 5; pg++) {
    const payload = buildPayload({}, pg, 100);
    const r = await post<RawPageResult>("/api/v1/open/positions/simple", payload);
    if (!r.ok || !r.data) break;
    for (const item of r.data.list ?? []) {
      const code = item.code ?? String(item.id ?? "");
      if (code) rawLookup.set(code, item);
    }
    if ((r.data.list?.length ?? 0) < 100) break;
  }

  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
    requirements?: string;
  };
  const scored: Scored[] = [];

  for (const p of pool.positions) {
    const raw = rawLookup.get(p.post_id);
    const blob = [
      p.title,
      p.project,
      p.recruit_label,
      p.work_cities,
      raw?.description ?? "",
      raw?.positionDemand ?? "",
    ].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({
        score,
        position: p,
        reasons,
        description: raw?.description,
        requirements: raw?.positionDemand,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = pool.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [] as string[],
      description: rawLookup.get(position.post_id)?.description,
      requirements: rawLookup.get(position.post_id)?.positionDemand,
    }));
  }

  const matches = shortlist.slice(0, topN).map((s) => {
    const mr =
      s.reasons.length > 0
        ? s.reasons.slice(0, 5)
        : ["no specific keyword overlap — surfaced from broad position pool"];
    return {
      ...s.position,
      description: s.description,
      requirements: s.requirements,
      match_reasons: mr,
    };
  });

  return {
    ok: true as const,
    source: "campus.kuaishou.cn",
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_kuaishou } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_kuaishou } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_kuaishou } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "campus.kuaishou.cn", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://campus.kuaishou.cn";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "campus.kuaishou.cn", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_kuaishou({
      source: "campus.kuaishou.cn",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://campus.kuaishou.cn/rest/campus-recruit/post/deliver",
      submitKind: "multipart-session",
      submitNotes:
        "Kuaishou — POST /rest/campus-recruit/post/deliver with session cookie. Endpoint inferred; needs validation.",
    }),
  };
}
