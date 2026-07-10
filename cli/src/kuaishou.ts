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
//        Payload: { pageNum, pageSize, name?, positionCategoryCodes?,
//                   workLocationCodes?, positionNatureCode?, positionLabel?,
//                   recruitSubProjectCode? }
//        Response: { code:0, message:"OK", result:{ total, list:[...], pages, ... } }
//        Server-side text search (re-probed 2026-07-11): the working param is
//        `name` — NOT `keyword` or `positionName`, both of which are accepted
//        but silently ignored (total stays 515 regardless of their value).
//        Measured: {name:"前端"} → total=4 (all titles contain 前端);
//        {name:"工程师"} → total=321; combines with positionNatureCode
//        ({name:"工程师",positionNatureCode:"fulltime"} → 170, intern → 151,
//        170+151=321 ✓). `total` in the response is the FILTERED count.
//        Default (no filter): 515 positions total as of 2026-07 (校招 + 实习).
//
//        UPSTREAM QUIRK (probed 2026-07-11, 3/3 reproductions): the exact
//        combination pageNum=1 + pageSize=10 WITHOUT a `name` filter returns
//        {code:-1,"message":"Internal Server Error"} deterministically (a
//        poisoned cache/shard for that page slot), while pageSize 5/11/20/50
//        and {pageNum:2,pageSize:10} all succeed. searchPositions() dodges it
//        by requesting 11 rows for that slot and slicing back to 10.
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
// Social-hire endpoint discovery (probed 2026-05, /recruit/e portal):
//
//   Portal URL: https://zhaopin.kuaishou.cn/recruit/e/ (社招 / experienced)
//   JS entry:   careers-experienced/.../main.a1eab777.js
//   $basePath = "/recruit/e"
//
//   Confirmed working anon (no session):
//     GET  /recruit/e/api/v1/dictionary/positionCategory  → C001/C002/...
//     GET  /recruit/e/api/v1/dictionary/positionNature    → C001=全职 C002=实习 C003=兼职
//     GET  /recruit/e/api/v1/dictionary/recruitProject    → socialr=社招 schoolr=校招 epiboly=外包
//     GET  /recruit/e/api/v1/dictionary/workLocation      → city codes
//
//   Confirmed BLOCKED anon (returns code:-1 "系统错误" — backend requires session):
//     GET  /recruit/e/api/v1/open/positions/simple
//          ?pageNum=1&pageSize=2[&positionNatureCode=C001][&recruitProject=socialr]
//          Always 200 envelope with code:-1 "系统错误" — the endpoint exists
//          and dispatches, but the downstream list service rejects anon callers.
//          (POST returns 40014 "参数不正确" — POST shape mismatch; the social
//          SPA uses the GET signature.)
//     GET  /recruit/e/api/v1/external/positions/recommend/simple
//          → 40008 "用户未登录" (explicitly user.not.login).
//
// Conclusion: Kuaishou social-hire is anon-blocked at the upstream level. The
// `supportedScopes` declaration EXCLUDES `"social"` so the dispatcher fails
// fast with the §2.3 message rather than returning an opaque 系统错误. A
// session-based path (Phase 2 apply executor reuses cookies) could revisit
// this endpoint later — the discovery is preserved here so the future agent
// doesn't repeat the recon.
//
// ============================================================
// NOTE on keyword search: The positions/simple endpoint DOES support
// server-side text search via the `name` field (re-probed 2026-07-11 — the
// original 2026-05 probe tried `keyword`, which is silently ignored, and
// wrongly concluded no text search existed).  searchPositions/fetchAllPositions
// map the CLI keyword to `name`, so `total` is the server-filtered count.
// matchResume() still pulls the full pool and scores client-side.
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
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Scopes this adapter can serve from the public, anon-accessible APIs (1.1.0+).
 *
 * Only `campus.kuaishou.cn/recruit/campus/e/api/v1/open/positions/simple` is
 * anon-reachable. That endpoint covers `校招/fulltime` and `intern` via the
 * `positionNatureCode` filter — but NOT `社招`, which lives on the separate
 * `/recruit/e/` (zhaopin.kuaishou.cn) sub-tree and rejects every anon list
 * call with code:-1 "系统错误" (see header for the full probe matrix).
 *
 * The dispatcher uses this list to fail fast with a useful message when a
 * caller passes `--scope social` — preferable to surfacing the opaque
 * upstream error.
 */
export const supportedScopes = ["campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

/** Map the CLI `--scope` value to Kuaishou's `positionNatureCode` parameter
 *  on the campus endpoint. `social` is intentionally absent — see
 *  `supportedScopes` above. `undefined` (caller omitted `--scope`) → no
 *  filter (matches the 1.0.93 default of returning the full ~441-post pool). */
function natureCodeForScope(scope: PositionScope | undefined): "fulltime" | "intern" | undefined {
  if (scope === "campus") return "fulltime";
  if (scope === "intern") return "intern";
  // "social" cannot be served — dispatcher rejects before we get here.
  // "all" + undefined → no nature filter (full pool).
  return undefined;
}

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
  /**
   * Free-text keyword, filtered SERVER-SIDE via the upstream `name` field
   * (probed 2026-07-11: {name:"前端"} → total=4, {name:"工程师"} → total=321
   * of 515; `keyword`/`positionName` are accepted but silently ignored, so we
   * must send `name`). The response `total` is the filtered count. Combines
   * with positionNatureCode and the other filters below.
   */
  keyword?: string;
  /** Page number, 1-based. Default: 1. */
  page?: number;
  /** Page size, 1–100. Default: 20. */
  pageSize?: number;
  /**
   * CLI scope axis (1.1.0+). Maps to `positionNatureCode` via
   * `natureCodeForScope`: campus→fulltime, intern→intern, all→no filter.
   * `social` is structurally unsupported (see `supportedScopes`); the
   * dispatcher rejects it before the call reaches us.
   *
   * When both `scope` and `positionNatureCode` are given, `scope` wins.
   * `undefined` preserves the 1.0.93 default (no nature filter).
   */
  scope?: PositionScope;
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
  // Server-side text search: the upstream field is `name` (see header — the
  // obvious spellings `keyword`/`positionName` are silently ignored).
  const kw = (opts.keyword ?? "").trim();
  if (kw) payload.name = kw;
  // CLI scope wins over the bespoke positionNatureCode if both are present.
  const natureFromScope = natureCodeForScope(opts.scope);
  const nature = natureFromScope ?? opts.positionNatureCode;
  if (nature) payload.positionNatureCode = nature;
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
  // Upstream poisoned-cache dodge (probed 2026-07-11): the exact slot
  // pageNum=1 + pageSize=10 deterministically returns code:-1 "Internal
  // Server Error" (3/3 retries; pageSize 5/11/20/50 and pageNum≥2 all work).
  // Request 11 rows for that slot and slice back to 10 — same page-1 window,
  // and page 2 at size 10 (offset 10) lines up correctly afterwards.
  const requestSize = page === 1 && pageSize === 10 ? 11 : pageSize;
  const payload = buildPayload(opts, page, requestSize);

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
  const rows = (response.data.list ?? []).slice(0, pageSize);
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
  // Default bound raised 5 → 60 (2026-07): the pool is 515 posts and the old
  // 5×100 default stranded the last 15. 60 pages exhausts the current total
  // at any pageSize ≥ 9; the loop stops as soon as `total` is reached or the
  // upstream sends a short/empty page, so at the default pageSize=100 a full
  // crawl costs just ceil(515/100) = 6 requests.
  const maxPages = Math.max(1, opts.maxPages ?? 60);

  const bucket: PositionSummary[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let truncated = false;

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
    // Dedupe by post_id — pages can shift between requests while we crawl.
    let added = 0;
    for (const p of result.positions) {
      if (p.post_id) {
        if (seen.has(p.post_id)) continue;
        seen.add(p.post_id);
      }
      bucket.push(p);
      added++;
    }
    // Exhaustion checks: advertised total reached, or upstream signalled the
    // end of data with a short page / a page of nothing-new.
    if (total !== undefined && bucket.length >= total) break;
    if (result.positions.length < pageSize || added === 0) break;
    // Still more to fetch but the page budget is spent → honest truncation.
    if (page === maxPages) truncated = true;
  }

  return {
    ok: true as const,
    source: "campus.kuaishou.cn",
    total: total ?? bucket.length,
    fetched: bucket.length,
    truncated,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
// Kuaishou's public /api/v1/open/position?code= endpoint returns code:1 "Fail"
// for external requests (re-probed 2026-07-11) — the detail HTML is rendered
// client-side from the same data already returned in the list.  We approximate
// detail by scanning the full pool (short-page stop, bounded at 20 pages of
// 100 = 2000 posts; the pool is 515 as of 2026-07, so the old 5-page bound
// left the last 15 posts unreachable).

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: "campus.kuaishou.cn", message: "post_id is required" };

  const pageSize = 100;
  const maxPages = 20;
  let scanned = 0;

  for (let page = 1; page <= maxPages; page++) {
    const payload = buildPayload({}, page, pageSize);
    const response = await post<RawPageResult>("/api/v1/open/positions/simple", payload);
    if (!response.ok || !response.data) break;

    const posts = response.data.list ?? [];
    scanned += posts.length;
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
    message: `post ${id} not found in public search results (scanned ${scanned} posts)`,
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
// 2. Fetch the full position pool (server `name` search exists but resume
//    matching wants the broad pool scored client-side, not one keyword).
// 3. Score each position against title + category + description + demand blob.
// 4. Return top N matches with reasons.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number; scope?: PositionScope } = {}
) {
  // `scope` is accepted for parity with the CLI surface but does not narrow
  // the matching pool today — we already pull the full ~441-post listing and
  // score client-side. `social` cannot reach this code path (rejected by
  // dispatcher); `campus|intern|all` all benefit from the broad pool, so we
  // intentionally ignore the value here.
  void opts.scope;
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

  // Fetch the full pool (515 posts as of 2026-07; fetchAllPositions stops on
  // short page, so this costs ~6 requests at pageSize 100).
  const pool = await fetchAllPositions({ pageSize: 100 });
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
  for (let pg = 1; pg <= 20; pg++) {
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
