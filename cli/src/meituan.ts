// Thin client for Meituan's public recruiting API at zhaopin.meituan.com.
//
// All endpoints are unauthenticated; the server just checks Referer/Origin.
// Endpoint inventory (verified 2026-05-14):
//
//   POST /api/official/job/getJobList      — paginated job search
//   POST /api/official/job/getJobDetail    — single job detail by jobUnionId
//   POST /api/official/city/search         — resolve city name → {code, name}
//
// Response envelope: { status: 1, message: "成功", data: { ... } }
// NOTE: status === 1 (not 0) indicates success on this platform.
//
// ═══════════════════════════════════════════════════════════════════════════
// FILTER TAXONOMY (all verified against live API 2026-05-14)
// ═══════════════════════════════════════════════════════════════════════════
//
// ── 1. jobType (in request body as jobType: [{code, subCode:[]}]) ──────────
//   "1" → 校招应届正式 (new-grad full-time)     totalCount ~112
//          jobSpecialCode distribution: {"1":72, "3":27, "7":1}
//          sample: 自动驾驶算法工程师 / 计算机视觉工程师
//   "2" → 实习 (intern)                          totalCount ~531
//          jobSpecialCode distribution: {"6":94, "1":3, "3":3}
//          sample: HR实习生-招聘方向 / Marketing Intern
//   "3" → 社招 (experienced hire)                totalCount ~2613
//          jobSpecialCode distribution: {"5":100}
//   ∅  → all three combined                      totalCount ~3256
//   Default: ["1","2"] mirrors the "校招" tab on zhaopin.meituan.com.
//
// ── 2. city (in request body as cityList: [{code, name}]) ─────────────────
//   City codes come from POST /api/official/city/search {keyword: "北京"}.
//   CRITICAL: passing {name} without a code returns wrong results (e.g. 10
//   instead of 2148 for Beijing). Always resolve code first.
//
//   Top cities (all jobTypes combined, 2026-05-14):
//     北京市  001001      2148    上海市  001009       736
//     深圳市  001019002    375    成都市  001023001    198
//     广州市  001019001    177    杭州市  001011001    142
//     武汉市  001017001    109    人力资源平台  —        95
//     南京市  001010001     70    西安市  001027001     67
//     苏州市  001010013     50
//   Campus (jobType 1+2) by city:
//     北京市   557    上海市   229    深圳市    81    成都市    40    杭州市    11
//
// ── 3. department / BU (in request body as department: [{code}]) ───────────
//   department codes are Meituan's internal "BG" codes.  Passing name-only
//   does NOT filter (returns all results). Codes discovered by scanning the
//   JS bundle + brute-force sweep BG001..BG100 (2026-05-14):
//
//   BG053  食杂零售-小象事业部              361
//   BG041  核心本地商业-基础研发平台         342
//   BG052  食杂零售-快驴事业部              233
//   BG022  食杂零售 (parent BG)            762  ← aggregates 053/052/054/055/056
//   BG038  核心本地商业-闪购事业部          204
//   BG043  核心本地商业-业务研发平台         195
//   BG047  核心本地商业-酒店旅行            189
//   BG024  软硬件服务 (parent BG)           388  ← aggregates 012/018/019/050/057/058
//   BG021  Keeta                           188
//   BG015  财务平台                        126
//   BG012  软硬件服务-骑行事业部            112
//   BG039  核心本地商业-医药健康事业部        99
//   BG032  核心本地商业-服务零售事业部        98
//   BG011  人力资源平台                     95
//   BG037  核心本地商业-到家履约平台         95
//   BG054  食杂零售-快乐猴事业部             88
//   BG036  核心本地商业-外卖事业部           72
//   BG046  核心本地商业-商业增值部           50
//   BG019  软硬件服务-充电宝业务部           50
//   BG048  核心本地商业-下沉市场发展部        43
//   BG055  食杂零售-公共部门                43
//   BG018  软硬件服务-餐饮SaaS事业部         44
//   BG009  美团自动车配送                   145
//   BG003  美团金服                         45
//   BG031  核心本地商业-到餐事业部           44
//   BG056  食杂零售-Keemart                 36
//   BG013  核心本地商业-美团平台            278
//   BG010  公司事务平台                     35
//   BG057  软硬件服务-硬件管理部             28
//   BG020  美团无人机                        93
//   BG044  核心本地商业-平台及职能部门        19
//   BG050  软硬件服务-软件研发部             19
//   BG049  软硬件服务-酒店SaaS业务部         10
//   BG016  战略与投资平台                     6
//   BG008  核心本地商业-点评事业部            24
//   BG045  GN06                              4
//   BG051  (unidentified)                    1
//   BG058  软硬件服务-软硬件合规部             1
//   Note: codes returning 3256 (e.g. BG001) act as no-op; only the above
//   codes represent real filterable BU subdivisions.
//
// ── 4. jobFamily / jobFamilyGroup — NOT filterable via API ────────────────
//   jobFamily and jobFamilyGroup appear as metadata on job objects but
//   sending them in the request body has no effect (always returns 3256).
//   Values observed in corpus (first 500 jobs):
//     jobFamily: 技术类 / 运营类 / 产品类 / 零售类 / 职能类
//               销售、客服与支持类 / 商业分析类 / 市场营销类 / 设计类
//     jobFamilyGroup: 软件 / 算法 / 运维 / 测试 / 产品 / 产品运营 / 用户运营
//               业务运营 / 运营类 / 财务 / 人力资源 / 商业分析 / 供应链
//               物流 / 门店 / 销售 / 营销 / 采购 / 市场 / 行政 / …
//   Use keyword search to narrow by family (e.g. keyword="算法").
//
// ── 5. jobSpecialCode — metadata only, not a filter dimension ─────────────
//   "1" = 普通校招岗 (normal campus)
//   "3" = 可能为 global/特殊项目 (mixed, appears in both type 1 & 2)
//   "5" = 社招 (experienced hire)
//   "6" = 实习 (intern, always accompanies jobType=2)
//   "7" = rare, appears in type 1 (<1%)
//
// ── 6. jobShareType — undocumented enum ───────────────────────────────────
//   "1" → returns ~3256 (the full public listing, used as default)
//   "2" → returns ~2194 (subset, purpose unclear)
//   ∅  → returns ~3256 (same as "1")
//
// ── Request body shape ────────────────────────────────────────────────────
//   {
//     page: { pageNo: number, pageSize: number },  // max pageSize = 100
//     jobShareType: "1",
//     keywords: string,                            // respected, max 30 chars
//     cityList: [{code: string, name: string}],    // code required for filter
//     department: [{code: string}],                // BG code; name ignored
//     jobType: [{code: string, subCode: []}],
//   }
//
// ── City lookup ───────────────────────────────────────────────────────────
//   POST /api/official/city/search {keyword: "城市名"}
//   Returns [{code, name, children, …}]
//   Common codes hardcoded in CITY_CODES below for offline use.
//
// ═══════════════════════════════════════════════════════════════════════════
//
// PositionSummary field mapping:
//   post_id       ← jobUnionId (stringified)
//   title         ← name
//   project       ← department[0].name if present, else ""
//   recruit_label ← jobType mapped to human label (社招/实习/校园)
//   bgs           ← jobFamilyGroup (e.g. "软件") + jobFamily (e.g. "技术类")
//   work_cities   ← cityList[*].name joined with " / "
//   apply_url     ← https://zhaopin.meituan.com/job-list/${jobUnionId}
//
// Detail fields:
//   description   ← jobDuty (job responsibilities)
//   requirements  ← jobRequirement (required qualifications)
//   highlight     ← highLight (why join)
//   department_intro ← departmentIntro (team introduction)

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://zhaopin.meituan.com/api/official";
const LIST_PAGE = "https://zhaopin.meituan.com/job-list";
const DETAIL_PAGE = (jobUnionId: string) =>
  `https://zhaopin.meituan.com/job-list/${encodeURIComponent(jobUnionId)}`;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

// jobType code → human label
const JOB_TYPE_LABEL: Record<string, string> = {
  "1": "校招",
  "2": "实习",
  "3": "社招",
};

// Hardcoded city codes for common cities (verified 2026-05-14 via city/search).
// Use resolveCityCodes() to look up arbitrary city names at runtime.
const CITY_CODES: Record<string, string> = {
  "北京": "001001",
  "北京市": "001001",
  "上海": "001009",
  "上海市": "001009",
  "广州": "001019001",
  "广州市": "001019001",
  "深圳": "001019002",
  "深圳市": "001019002",
  "杭州": "001011001",
  "杭州市": "001011001",
  "成都": "001023001",
  "成都市": "001023001",
  "武汉": "001017001",
  "武汉市": "001017001",
  "西安": "001027001",
  "西安市": "001027001",
  "苏州": "001010013",
  "苏州市": "001010013",
  "南京": "001010001",
  "南京市": "001010001",
};

// BG department codes (verified 2026-05-14, see header comment for full list)
// Map from code → canonical department name
export const BG_DEPARTMENT_CODES: Record<string, string> = {
  "BG003": "美团金服",
  "BG008": "核心本地商业-点评事业部",
  "BG009": "美团自动车配送",
  "BG010": "公司事务平台",
  "BG011": "人力资源平台",
  "BG012": "软硬件服务-骑行事业部",
  "BG013": "核心本地商业-美团平台",
  "BG015": "财务平台",
  "BG016": "战略与投资平台",
  "BG018": "软硬件服务-餐饮SaaS事业部",
  "BG019": "软硬件服务-充电宝业务部",
  "BG020": "美团无人机",
  "BG021": "Keeta",
  "BG022": "食杂零售",
  "BG024": "软硬件服务",
  "BG031": "核心本地商业-到餐事业部",
  "BG032": "核心本地商业-服务零售事业部",
  "BG036": "核心本地商业-外卖事业部",
  "BG037": "核心本地商业-到家履约平台",
  "BG038": "核心本地商业-闪购事业部",
  "BG039": "核心本地商业-医药健康事业部",
  "BG041": "核心本地商业-基础研发平台",
  "BG043": "核心本地商业-业务研发平台",
  "BG044": "核心本地商业-平台及职能部门",
  "BG045": "GN06",
  "BG046": "核心本地商业-商业增值部",
  "BG047": "核心本地商业-酒店旅行",
  "BG048": "核心本地商业-下沉市场发展部",
  "BG049": "软硬件服务-酒店SaaS业务部",
  "BG050": "软硬件服务-软件研发部",
  "BG052": "食杂零售-快驴事业部",
  "BG053": "食杂零售-小象事业部",
  "BG054": "食杂零售-快乐猴事业部",
  "BG055": "食杂零售-公共部门",
  "BG056": "食杂零售-Keemart",
  "BG057": "软硬件服务-硬件管理部",
  "BG058": "软硬件服务-软硬件合规部",
};

interface ApiEnvelope<T> {
  status?: number;
  message?: string;
  data?: T;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; referer?: string } = {}
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    Referer: opts.referer ?? LIST_PAGE,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
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

  // Meituan uses status === 1 for success (not 0 like Tencent)
  return {
    ok: payload.status === 1,
    data: payload.data,
    message: payload.message || (payload.status === 1 ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface CityNode {
  code?: string | null;
  name?: string;
  children?: CityNode[] | null;
}

interface DepartmentNode {
  code?: string | null;
  name?: string;
  children?: DepartmentNode[] | null;
}

interface RawJobListEntry {
  jobUnionId?: string | number;
  name?: string;
  projectId?: string | number | null;
  projectName?: string | null;
  jobType?: string;
  jobSpecialCode?: string;
  jobSource?: string;
  jobStatus?: string;
  jobFamily?: string;
  jobFamilyGroup?: string;
  cityList?: CityNode[];
  workYear?: string | null;
  department?: DepartmentNode[];
  desc?: string | null;
  departmentIntro?: string | null;
  jobDuty?: string | null;
  jobRequirement?: string | null;
  precedence?: string | null;
  highLight?: string | null;
  otherInfo?: string | null;
  firstPostTime?: number | null;
  refreshTime?: number | null;
  tag?: unknown;
  expiredTime?: number | null;
  socialRecommendJob?: boolean | null;
}

interface RawJobDetail extends RawJobListEntry {
  // detail response adds these with full content
}

interface RawPageInfo {
  pageNo?: number;
  pageSize?: number;
  totalPage?: number;
  totalCount?: number;
}

interface RawJobListResponse {
  list?: RawJobListEntry[];
  page?: RawPageInfo;
  traceId?: string | null;
}

// ---------- positions ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

function citiesText(cityList?: CityNode[]): string {
  if (!cityList || !cityList.length) return "";
  return cityList
    .map((c) => c.name ?? "")
    .filter(Boolean)
    .join(" / ");
}

function summarizePosition(item: RawJobListEntry): PositionSummary {
  const jobUnionId = String(item.jobUnionId ?? "");
  const deptName = item.department?.[0]?.name ?? "";
  const jobTypeCode = item.jobType ?? "";
  const recruitLabel = JOB_TYPE_LABEL[jobTypeCode] ?? jobTypeCode;
  const bgs = [item.jobFamilyGroup, item.jobFamily].filter(Boolean).join(" · ");

  return {
    post_id: jobUnionId,
    title: item.name ?? "",
    project: deptName,
    recruit_label: recruitLabel,
    bgs,
    work_cities: citiesText(item.cityList),
    apply_url: jobUnionId ? DETAIL_PAGE(jobUnionId) : LIST_PAGE,
  };
}

export interface SearchOptions {
  keyword?: string;
  /** default: ["1","2"] (校招应届正式 + 实习) — matches the 校招 tab on zhaopin.meituan.com */
  jobTypeCodes?: string[];
  /**
   * Filter by city.  Each entry is a city name (e.g. "北京" or "北京市").
   * Common cities are resolved offline via CITY_CODES; unknown names are
   * looked up live via POST /api/official/city/search.  A code must be found
   * for the filter to take effect — name-only does NOT filter correctly.
   * Example: ["北京", "上海"]
   */
  cities?: string[];
  /**
   * Filter by BU / department using BG codes (e.g. "BG021" for Keeta).
   * See BG_DEPARTMENT_CODES for the full list, or use the human-readable
   * department names from the header comment.  Passing a name without a
   * BG code has no effect — the API ignores it.
   * Example: ["BG021", "BG022"]  or human aliases resolved by this client.
   */
  departments?: string[];
  page?: number;
  pageSize?: number;
}

/**
 * Resolve city names to [{code, name}] objects for the getJobList payload.
 * Uses the hardcoded CITY_CODES map first; falls back to a live API lookup.
 */
async function resolveCityCodes(
  cityNames: string[]
): Promise<{ code: string; name: string }[]> {
  const result: { code: string; name: string }[] = [];
  for (const raw of cityNames) {
    const name = raw.trim();
    if (!name) continue;
    const knownCode = CITY_CODES[name];
    if (knownCode) {
      result.push({ code: knownCode, name });
      continue;
    }
    // Live lookup
    const res = await call<Array<{ code?: string; name?: string }>>(
      "POST",
      "/city/search",
      { body: { keyword: name } }
    );
    if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
      const first = res.data[0];
      if (first.code && first.name) {
        result.push({ code: first.code, name: first.name });
      }
    }
    // If not resolved, skip — sending name-only would give wrong counts
  }
  return result;
}

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const jobTypeCodes = opts.jobTypeCodes ?? ["1", "2"];

  // Resolve city names → [{code, name}]
  const cityList = opts.cities?.length
    ? await resolveCityCodes(opts.cities)
    : [];

  // Resolve department strings → [{code}]
  // Accept BG codes directly (e.g. "BG021") or canonical names looked up in
  // the reverse map. Name-only entries that can't be resolved are dropped.
  const bgNameToCode: Record<string, string> = {};
  for (const [code, name] of Object.entries(BG_DEPARTMENT_CODES)) {
    bgNameToCode[name] = code;
  }
  const department: { code: string }[] = [];
  for (const d of opts.departments ?? []) {
    const s = d.trim();
    if (!s) continue;
    if (/^BG\d+$/i.test(s)) {
      department.push({ code: s.toUpperCase() });
    } else if (bgNameToCode[s]) {
      department.push({ code: bgNameToCode[s] });
    }
    // Unresolvable names are silently dropped (API ignores them anyway)
  }

  const body = {
    page: { pageNo: page, pageSize },
    jobShareType: "1",
    keywords: (opts.keyword ?? "").trim().slice(0, 30),
    cityList,
    department,
    jobType: jobTypeCodes.map((code) => ({ code, subCode: [] })),
  };

  const response = await call<RawJobListResponse>("POST", "/job/getJobList", { body });
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: "zhaopin.meituan.com",
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = response.data.list ?? [];
  const pageInfo = response.data.page ?? {};
  return {
    ok: true as const,
    source: "zhaopin.meituan.com",
    query: body,
    page,
    page_size: pageSize,
    total: pageInfo.totalCount ?? rows.length,
    total_pages: pageInfo.totalPage ?? 1,
    positions: rows.map(summarizePosition),
  };
}

export async function fetchAllPositions(
  opts: {
    keyword?: string;
    maxPages?: number;
    pageSize?: number;
    jobTypeCodes?: string[];
    cities?: string[];
    departments?: string[];
  } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 30);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({
      keyword: opts.keyword,
      jobTypeCodes: opts.jobTypeCodes,
      cities: opts.cities,
      departments: opts.departments,
      page,
      pageSize,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message,
        source: "zhaopin.meituan.com",
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
    source: "zhaopin.meituan.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- detail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, message: "post_id is required" };

  const response = await call<RawJobDetail>("POST", "/job/getJobDetail", {
    body: { jobUnionId: id },
    referer: DETAIL_PAGE(id),
  });
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message || "no detail returned",
      source: "zhaopin.meituan.com",
      post_id: id,
    };
  }
  const raw = response.data;
  const first = (...vals: (string | null | undefined)[]) => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };

  return {
    ok: true as const,
    source: "zhaopin.meituan.com",
    post_id: String(raw.jobUnionId ?? id),
    title: raw.name ?? "",
    direction: first(raw.jobFamily, raw.jobFamilyGroup),
    description: first(raw.jobDuty, raw.desc),
    requirements: first(raw.jobRequirement),
    highlight: first(raw.highLight),
    department_intro: first(raw.departmentIntro),
    work_year: raw.workYear ?? null,
    work_cities: (raw.cityList ?? []).map((c) => c.name ?? "").filter(Boolean),
    recruit_cities: [],  // Meituan API does not expose a separate recruit city list
    apply_url: DETAIL_PAGE(String(raw.jobUnionId ?? id)),
  };
}

// ---------- dictionaries (synthesized from API probing 2026-05-14) ----------

/**
 * Returns the full filter taxonomy for zhaopin.meituan.com as of 2026-05-14.
 * There is no single "dictionaries" endpoint — this data was assembled by:
 *   1. Enumerating jobType counts via getJobList.
 *   2. Scanning the entry-main JS bundle for BG codes.
 *   3. Brute-forcing BG001..BG100 to discover all live department codes.
 *   4. Resolving city codes via POST /city/search.
 * jobFamily/jobFamilyGroup are returned as metadata-only (not filterable).
 */
export async function fetchDictionaries() {
  return {
    ok: true as const,
    source: "zhaopin.meituan.com",
    note: "Synthesized from API probing; no single dictionaries endpoint exists. jobFamily/jobFamilyGroup are metadata only — use keyword to narrow by them.",
    jobTypes: [
      { code: "1", label: "校招应届正式", totalCount: 112,
        jobSpecialCodes: { "1": "普通校招", "3": "特殊/全球岗", "7": "稀有" } },
      { code: "2", label: "实习", totalCount: 531,
        jobSpecialCodes: { "6": "实习", "1": "其他", "3": "特殊" } },
      { code: "3", label: "社招", totalCount: 2613,
        jobSpecialCodes: { "5": "社招" } },
    ],
    cities: [
      { code: "001001",     name: "北京市",   totalCount: 2148 },
      { code: "001009",     name: "上海市",   totalCount: 736 },
      { code: "001019002",  name: "深圳市",   totalCount: 375 },
      { code: "001023001",  name: "成都市",   totalCount: 198 },
      { code: "001019001",  name: "广州市",   totalCount: 177 },
      { code: "001011001",  name: "杭州市",   totalCount: 142 },
      { code: "001017001",  name: "武汉市",   totalCount: 109 },
      { code: "001010001",  name: "南京市",   totalCount: 70 },
      { code: "001027001",  name: "西安市",   totalCount: 67 },
      { code: "001010013",  name: "苏州市",   totalCount: 50 },
    ],
    departments: Object.entries(BG_DEPARTMENT_CODES)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    jobFamilies: {
      note: "Metadata on job objects only — cannot be used as a filter in getJobList.",
      jobFamily: [
        "技术类", "运营类", "产品类", "零售类", "职能类",
        "销售、客服与支持类", "商业分析类", "市场营销类", "设计类",
      ],
      jobFamilyGroup: [
        "软件", "算法", "运维", "测试", "硬件", "硬件产品",
        "产品", "产品运营", "用户运营", "业务运营", "内容运营", "商品运营",
        "财务", "人力资源", "供应链", "物流", "门店",
        "销售", "客服", "营销", "市场", "商业分析",
        "业务支持", "采购", "行政", "公司事务", "设计",
      ],
    },
    payloadShapes: {
      cityFilter: "cityList: [{code: '001001', name: '北京市'}]  — code is required",
      departmentFilter: "department: [{code: 'BG021'}]  — name is ignored by the server",
      jobTypeFilter: "jobType: [{code: '1', subCode: []}, {code: '2', subCode: []}]",
      cityLookup: "POST /api/official/city/search {keyword: '城市名'} → [{code, name}]",
    },
  };
}

export async function listNotices() {
  return { ok: false as const, message: "Meituan: no public notices endpoint", notices: [] };
}

export async function getNotice(_id: string) {
  return { ok: false as const, message: "Meituan: no public notice endpoint" };
}

export async function findNoticesByQuestion(_q: string, _opts: { questionTime?: string; topK?: number } = {}) {
  return {
    ok: false as const,
    message: "Meituan: no public notices endpoint",
    matches: [],
  };
}

// ---------- resume matching ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number; jobTypeCodes?: string[] } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 20);
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false as const,
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({
    keyword,
    page: 1,
    pageSize: 100,
    jobTypeCodes: opts.jobTypeCodes,
  });
  if (!list.ok) return { ok: false as const, message: list.message, positions: [] };

  type Pre = { score: number; position: PositionSummary; reasons: string[] };
  const pre: Pre[] = [];
  for (const p of list.positions) {
    // Use name + project + bgs + work_cities as haystack (desc is in detail only)
    const blob = [p.title, p.project, p.bgs, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) pre.push({ score, position: p, reasons });
  }
  pre.sort((a, b) => b.score - a.score);

  let shortlist = pre.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = list.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  type Enriched = {
    score: number;
    row: PositionSummary & {
      title_detail?: string;
      direction?: string;
      description?: string;
      requirements?: string;
      match_reasons: string[];
    };
  };
  const enriched: Enriched[] = [];
  for (const { score: baseScore, position, reasons: baseReasons } of shortlist.slice(0, candidates)) {
    const detail = await fetchPositionDetail(position.post_id);
    if (!detail.ok) continue;
    const jdBlob = [
      detail.title,
      detail.direction,
      detail.description,
      detail.requirements,
      (detail.work_cities ?? []).join(" "),
    ].join(" ");
    const { score: extraScore, reasons: extraReasons } = scoreOverlap(jdBlob, terms, cities);
    const combined = [...new Set([...baseReasons, ...extraReasons])].slice(0, 5);
    if (!combined.length) {
      combined.push("no specific keyword overlap — surfaced from initial keyword search");
    }
    enriched.push({
      score: baseScore + extraScore,
      row: {
        ...position,
        title_detail: detail.title,
        direction: detail.direction,
        description: detail.description,
        requirements: detail.requirements,
        match_reasons: combined,
      },
    });
  }
  enriched.sort((a, b) => b.score - a.score);

  return {
    ok: true as const,
    source: "zhaopin.meituan.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches: enriched.slice(0, topN).map((e) => e.row),
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
