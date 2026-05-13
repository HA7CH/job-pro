// Thin client for Bilibili's campus-recruiting API at jobs.bilibili.com.
//
// AUTH MODEL  — Two-step stateless handshake (no login required):
//   1. GET /api/auth/v1/csrf/token
//        Headers: X-AppKey: ops.ehr-api.auth, X-UserType: 2
//        Response: { code:0, data:"<uuid>" }
//        Side-effect: sets cookie X-CSRF=<uuid> on domain bilibili.co
//                     (note: curl won't auto-save it due to domain mismatch with jobs.bilibili.com)
//   2. POST /api/campus/position/positionList
//        Pass the token both as:
//          header  X-CSRF: <token>
//          cookie  X-CSRF=<token>
//        Without both, the server returns code:-3 ("csrf不能为空").
//
// The /api/campus/* endpoints require NO Bilibili account session (ajSessionId).
// A fresh CSRF token from step 1 is sufficient for public position browsing.
//
// ============================================================
// Endpoint inventory (probed 2026-05, JS bundle app.3a48ef6c.js + position.846fe539.js):
//
//   GET  https://jobs.bilibili.com/api/auth/v1/csrf/token
//        Headers: X-AppKey, X-UserType:2
//        Response: { code:0, data:"<csrf-uuid>" }
//
//   POST https://jobs.bilibili.com/api/campus/position/positionList
//        Headers: X-AppKey, X-UserType:2, X-CSRF:<token>, Cookie: X-CSRF=<token>
//        Payload: { pageNum, pageSize, positionName?, workLocationList?, positionTypeList?,
//                   deptCodeList?, workTypeList?, practiceTypes?, onlyHotRecruit?, recruitType? }
//        Response: { code:0, data:{ list:[...], pages:<int>, size:<int>, total:<int> } }
//
//   GET  https://jobs.bilibili.com/api/campus/dict/post
//        Headers: X-AppKey, X-UserType:2, X-CSRF:<token>, Cookie: X-CSRF=<token>
//        Response: code:0, data:[{ parentRankCode, rankCode, rankName, sonRankBasics:[...] }]
//        This is the public job-category taxonomy — no account needed.
//
// ============================================================
// Filter taxonomy (probed 2026-05, total ~356 positions):
//
// DIMENSION 1 — positionTypeList (职位类型)
//   "实习"  — intern positions       (~335 of 356 visible)
//   "全职"  — full-time campus hire  (~21 of 356 visible)
//   (default: both, pass [] or omit)
//
// DIMENSION 2 — workLocationList (工作地点, free-text city names from workLocation field)
//   Common values seen: "上海", "北京", "上海/北京", "深圳", "杭州", "成都"
//   The API matches substring, so "北京" will match "上海/北京".
//   Pass [] or omit to query all cities.
//
// DIMENSION 3 — positionName (搜索关键词)
//   Free-text search matched against position title. Pass "" or omit for all.
//
// DIMENSION 4 — practiceTypes (校招项目 project IDs)
//   53 — 实习生校招项目  (campus intern program, recruitType=1)
//   52 — 全职校招项目    (campus full-time program, recruitType=1)
//   0  — 普通实习         (regular intern, recruitType=0)
//   Pass [] or omit to return all projects.
//   Note: passing [52] or [53] alone does NOT reliably filter by type in this API —
//   see the workTypeList + positionTypeList combination instead.
//
// DIMENSION 5 — recruitType (招聘类型)
//   1 — 校招 (campus program recruit)
//   0 — 普通实习 (ad-hoc intern)
//   (default: both; pass undefined to include all)
//
// DIMENSION 6 — job category taxonomy from GET /api/campus/dict/post (positionType)
//   Parent "01" 技术类
//     "010" 开发序列, "011" 运维序列, "012" 测试序列, "013" 算法序列
//     "014" 安全序列, "015" 信息管理序列, "016" 多媒体序列
//   Parent "02" 大职能类
//     "020" 财务, "021" 法务, "022" 投资, "023" 行政, "024" 采购
//     "025" 综合业务, "026" 公共关系, "027" 信息管理, "028" 人力资源, "029" 战略
//   Parent "03" 产品运营类
//     "030" 产品, "031" 产品运营, "032" 用户运营, "033" 电商运营
//     "034" 展会活动运营, "035" 数据分析, "036" 数据科学
//   Parent "04" 设计类
//     "040" UED, "041" 美术创意, "042" 平面设计
//   Parent "05" 内容类
//     "050" 内容运营, "051" 版权管理, "052" 内容合作
//   Parent "06" 文创类
//     "061" 制作, "062" 出品
//   Parent "07" 市场营销类
//     "070" 品牌市场, "071" 公关, "072" 商务BD, "073" 销售支持
//     "074" 销售, "075" 广告运营
//   Parent "08" 运营保障类
//     "080" 审核, "081" 客服, "082" 审核管理, "083" 审核运营
//     "084" 审核执行, "085" 客服执行, "086" 客服运营, "087" 客服管理
//   Parent "09" 综合管理类 / "10" 项目管理类 / "11" 游戏类 / "12" 外包类 / "99" 其他
//
// ============================================================
// PositionSummary field mapping (Bilibili → canonical):
//   post_id       ← String(item.id)
//   title         ← item.positionName
//   project       ← item.postCodeName   (e.g. "技术类" / "大职能类")
//   recruit_label ← item.positionTypeName (e.g. "实习" / "全职")
//   bgs           ← ""  (Bilibili does not expose BG/事业群 in public search)
//   work_cities   ← item.workLocation   (e.g. "上海" / "上海/北京")
//   apply_url     ← https://jobs.bilibili.com/campus/positions/${id}
//
// ============================================================
// Endpoints that return 403 without a real account session (ajSessionId):
//   GET/POST /api/campus/dict/dictMsg
//   GET/POST /api/campus/position/cityList
//   GET/POST /api/campus/position/postCodeList
//   GET/POST /api/campus/position/detail/<id>
//   GET/POST /api/srs/*   (social recruit system — requires full login)
//   GET/POST /api/rts/*   (internal system — 403 or 500)
//
// The CSRF token is fresh per request; cache it for the process lifetime to
// avoid double-fetching on repeated searchPositions calls.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://jobs.bilibili.com";
const CAMPUS_PAGE = "https://jobs.bilibili.com/campus/positions";
const DETAIL_PAGE = (id: string) =>
  `https://jobs.bilibili.com/campus/positions/${encodeURIComponent(id)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "X-AppKey": "ops.ehr-api.auth",
  "X-UserType": "2",
  Referer: "https://jobs.bilibili.com/",
};

// ---------- CSRF token cache ----------
// Fresh UUID from GET /api/auth/v1/csrf/token — valid for the process lifetime.
let _csrfCache: string | null = null;

async function fetchCsrfToken(): Promise<
  { ok: true; token: string } | { ok: false; message: string }
> {
  if (_csrfCache) return { ok: true, token: _csrfCache };

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}/api/auth/v1/csrf/token`, {
      headers: DEFAULT_HEADERS,
    });
  } catch (err) {
    return {
      ok: false,
      message: `network error fetching CSRF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    return { ok: false, message: `CSRF HTTP ${response.status}` };
  }

  let payload: { code?: number; data?: string; message?: string };
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "bad JSON in CSRF response" };
  }

  if (payload.code !== 0 || !payload.data) {
    return {
      ok: false,
      message: payload.message ?? "CSRF endpoint returned error",
    };
  }

  _csrfCache = payload.data;
  return { ok: true, token: payload.data };
}

// ---------- low-level call helper ----------

interface BiliEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

async function call<T>(
  body: unknown
): Promise<{ ok: boolean; data?: T; message: string }> {
  const csrfResult = await fetchCsrfToken();
  if (!csrfResult.ok) {
    return { ok: false, message: csrfResult.message };
  }
  const token = csrfResult.token;

  const url = `${API_ROOT}/api/campus/position/positionList`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "X-CSRF": token,
        // The backend requires the CSRF token as both a request header AND a cookie.
        // The Set-Cookie header from /api/auth/v1/csrf/token sets it on domain bilibili.co
        // (not jobs.bilibili.com), so browsers do send it automatically but Node's fetch
        // does not forward cross-domain cookies — we inject it manually here.
        Cookie: `X-CSRF=${token}`,
      },
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

  let payload: BiliEnvelope<T>;
  try {
    payload = (await response.json()) as BiliEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  return {
    ok: payload.code === 0,
    data: payload.data,
    message: payload.message ?? (payload.code === 0 ? "ok" : `code ${payload.code}`),
  };
}

// ---------- raw response types ----------

interface RawPosition {
  id?: number | string;
  positionName?: string;
  positionTypeName?: string; // "实习" | "全职"
  postCodeName?: string;     // "技术类" | "大职能类" | etc.
  workLocation?: string;     // "上海" | "上海/北京" | etc.
  pushTime?: string;
  recruitType?: number;      // 0=普通实习, 1=校招
  campusProjectId?: number;  // 0=普通实习, 52=全职校招, 53=实习校招
  hotRecruit?: number;
  positionDescription?: string;
}

interface RawListData {
  list?: RawPosition[];
  pages?: number;
  size?: number;
  total?: number;
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

function summarizePosition(item: RawPosition): PositionSummary {
  const id = String(item.id ?? "");
  return {
    post_id: id,
    title: item.positionName ?? "",
    project: item.postCodeName ?? "",
    recruit_label: item.positionTypeName ?? "",
    bgs: "",
    work_cities: item.workLocation ?? "",
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Filter by position type. Default: both.
   *  "实习" = intern only, "全职" = full-time campus hire only.
   *  Pass [] or omit for all. */
  positionTypes?: string[];
  /** Filter by work city (free-text, substring match).
   *  e.g. ["上海"], ["北京"], ["上海", "北京"].
   *  Pass [] or omit for all cities. */
  workLocations?: string[];
  /** Filter by recruit mode. 1=校招 (campus program), 0=普通实习 (ad-hoc intern).
   *  Omit to include both. */
  recruitType?: number;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const payload: Record<string, unknown> = {
    pageNum: page,
    pageSize,
    positionName: keyword,
    workTypeList: [],
    deptCodeList: [],
  };

  if (opts.positionTypes?.length) {
    payload.positionTypeList = opts.positionTypes;
  } else {
    payload.positionTypeList = [];
  }

  if (opts.workLocations?.length) {
    payload.workLocationList = opts.workLocations;
  } else {
    payload.workLocationList = [];
  }

  if (opts.recruitType !== undefined) {
    payload.recruitType = opts.recruitType;
  }

  const response = await call<RawListData>(payload);
  if (!response.ok || !response.data) {
    return {
      ok: false,
      message: response.message,
      source: "jobs.bilibili.com",
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.list ?? [];
  return {
    ok: true,
    source: "jobs.bilibili.com",
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
  const maxPages = Math.max(1, opts.maxPages ?? 4); // ~400 positions max

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        source: "jobs.bilibili.com",
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
    source: "jobs.bilibili.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
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
      ok: false,
      source: "jobs.bilibili.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
  if (!list.ok) {
    return { ok: false, source: "jobs.bilibili.com", message: list.message, positions: [] };
  }

  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
  };
  const scored: Scored[] = [];

  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({ score, position: p, reasons });
    }
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
    ok: true,
    source: "jobs.bilibili.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}

// ---------- stub notices ----------
// Bilibili's campus site has no public notices/announcements endpoint.

const STUB_NOTICES = {
  ok: false as const,
  source: "jobs.bilibili.com",
  message: "Bilibili: no public notices endpoint",
};

export async function listNotices(): Promise<typeof STUB_NOTICES> {
  return STUB_NOTICES;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bilibili.com",
    message: "Bilibili: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bilibili.com",
    message: "Bilibili: no public notices endpoint",
  };
}
