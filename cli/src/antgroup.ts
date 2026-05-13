// Thin client for Ant Group's campus-recruiting portal at talent.antgroup.com.
//
// ============================================================
// API Discovery (probed 2026-05, JS bundle + network analysis):
//
//   Portal URL:   https://talent.antgroup.com/campus-list      (public list view)
//                 https://talent.antgroup.com/campus-full-list (full list view)
//   JS bundles:   gw.alipayobjects.com/render/p/yuyan/180020010001257966/umi.6f081e74.js
//                 render.alipay.com/p/yuyan/180020010001257966/p__CampusRecruitment__CRList__index.*.async.js
//                 render.alipay.com/p/yuyan/180020010001257966/p__CampusRecruitment__CRFullList__index.*.async.js
//   Gateway host: talent.antgroup.com  (Spanner CDN/WAF, Alipay's proprietary gateway)
//   Backend host: antwork-prod.antgroup-inc.cn  (actual API server)
//
// ============================================================
// Endpoint inventory (extracted from JS bundle module 64588 + full UMI bundle):
//
//   POST /api/campus/position/search      — paginated job search
//   POST /api/campus/position/detail      — single position detail
//   POST /api/campus/position/queryDept   — dept tree for a position group
//   POST /api/campus/positionGroup/queryBatchConfig      — batch config
//   POST /api/campus/positionGroup/queryBatchDetailById  — batch detail
//   POST /api/searchCondition/list             — filter taxonomy (categories, cities, depts)
//   POST /api/searchCondition/listPositionGroup
//   POST /api/searchCondition/listTalentPlan
//
//   Canonical position detail URL: /campus-position?positionId=<id>
//
// ============================================================
// AUTH STATUS — GATED (Alipay OAuth / buservice SDK):
//
//   EVERY endpoint (including /api/campus/position/search and
//   /api/searchCondition/list) requires an authenticated Alipay/Ant Group
//   session. Without login, the backend returns:
//
//     { "buserviceErrorCode": "USER_NOT_LOGIN",
//       "buserviceErrorMsg": "https://pubbuservice.alipay.com/…" }
//
//   The buservice middleware intercepts ALL routes as a catch-all auth gate
//   before any controller logic runs. There is no guest/anonymous tier.
//
//   The talent.antgroup.com Spanner gateway additionally returns 405 Method
//   Not Allowed for POST requests that lack valid Alipay session cookies,
//   preventing even the USER_NOT_LOGIN response from being seen in most cases.
//   Direct calls to antwork-prod.antgroup-inc.cn reveal the auth error clearly.
//
// ============================================================
// CSRF / session flow (observed but INSUFFICIENT for anonymous access):
//
//   GET /campus-list sets:
//     ALIPAYJSESSIONID=<token>; domain=.antgroup.com
//     _CHIPS-ALIPAYJSESSIONID=<same_token>; samesite=none; partitioned
//     spanner=<signed_value>; path=/; secure
//
//   These cookies are required for CORS (Access-Control-Allow-Credentials: true)
//   but the buservice SDK then validates the session against Alipay's auth
//   infrastructure — a simple GET-derived cookie has no authenticated user.
//   Unlike Alibaba's portal (campus-talent.alibaba.com) which only needs an
//   XSRF-TOKEN for public search, Ant Group's portal requires full Alipay OAuth.
//
// ============================================================
// Ant Group vs Alibaba — KEY DIFFERENCES:
//
//   Portal:       talent.antgroup.com    vs campus-talent.alibaba.com
//   Auth:         Alipay OAuth (gated)   vs XSRF-TOKEN only (public search works)
//   CSRF:         Not sufficient alone   vs Sufficient for anonymous search
//   Backend host: antwork-prod.antgroup-inc.cn vs campus-talent.alibaba.com
//   Auth MW:      buservice SDK (blocks all) vs Spring XSRF (only mutating ops)
//
// ============================================================
// FILTER TAXONOMY (from JS bundle, not verified against live API):
//   channel values: "campus_group_official_site" (zh), "en_official_site" (en)
//   searchCondition/list returns: searchItems with types "workCity", "category", "dept", "recruitType"
//   Position fields: id, categoryName, workLocations, graduationTime, circleNames (BU)
//
// ============================================================
// ---- PositionSummary field mapping (Ant Group → canonical) ----
//   post_id       ← item.id  (stringified)
//   title         ← item.name
//   project       ← item.categoryName ?? ""    (e.g. "技术类", "产品类")
//   recruit_label ← item.recruitType ?? ""     (e.g. "实习生", "校招生")
//   bgs           ← item.circleNames?.[0] ?? "" (BU / business unit)
//   work_cities   ← item.workLocations?.join(" / ") ?? ""
//   apply_url     ← https://talent.antgroup.com/campus-position?positionId=<id>

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { extractResumeSignals, scoreOverlap, checkResume };

const PORTAL_ROOT = "https://talent.antgroup.com";
const CAMPUS_PAGE = `${PORTAL_ROOT}/campus-list`;
const DETAIL_PAGE = (id: string | number) =>
  `${PORTAL_ROOT}/campus-position?positionId=${encodeURIComponent(String(id))}`;

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

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Category filter (e.g. "技术类", "产品类"). From searchCondition/list type="category". */
  category?: string;
  /** City filter (e.g. "北京", "上海"). From searchCondition/list type="workCity". */
  region?: string;
  /** Dept filter code. From searchCondition/list type="dept". Leaf codes only. */
  deptCode?: string;
  /** Channel: "campus_group_official_site" (zh, default) or "en_official_site" (en). */
  channel?: string;
}

// ---------- stub reason constant ----------

const STUB_MESSAGE =
  "Ant Group (talent.antgroup.com): all API endpoints require Alipay OAuth login. " +
  "POST /api/campus/position/search returns buserviceErrorCode=USER_NOT_LOGIN for " +
  "unauthenticated requests. The Spanner CDN gateway additionally returns HTTP 405 " +
  "for POST requests lacking a valid Alipay session cookie. No anonymous/guest tier exists. " +
  "To use this portal, the user must log in at talent.antgroup.com with an Alipay account " +
  "and supply a valid ALIPAYJSESSIONID cookie.";

// ---------- searchPositions (stub) ----------

export async function searchPositions(opts: SearchOptions = {}): Promise<{
  ok: boolean;
  source: string;
  message: string;
  query: Record<string, unknown>;
  page: number;
  page_size: number;
  total: number | null;
  positions: PositionSummary[];
}> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const channel = opts.channel ?? "campus_group_official_site";

  const query: Record<string, unknown> = {
    pageIndex: page,
    pageSize,
    channel,
    language: "zh",
  };
  if (opts.keyword?.trim()) query.keyword = opts.keyword.trim().slice(0, 60);
  if (opts.category) query.category = opts.category;
  if (opts.region) query.region = opts.region;
  if (opts.deptCode) query.deptCode = opts.deptCode;

  return {
    ok: false,
    source: PORTAL_ROOT,
    message: STUB_MESSAGE,
    query,
    page,
    page_size: pageSize,
    total: null,
    positions: [],
  };
}

// ---------- fetchAllPositions (stub) ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
): Promise<{
  ok: boolean;
  source: string;
  message: string;
  fetched: number;
  total: number | null;
  positions: PositionSummary[];
}> {
  return {
    ok: false,
    source: PORTAL_ROOT,
    message: STUB_MESSAGE,
    fetched: 0,
    total: null,
    positions: [],
  };
}

// ---------- fetchPositionDetail (stub) ----------

export async function fetchPositionDetail(postId: string): Promise<{
  ok: boolean;
  source: string;
  message: string;
  post_id?: string;
  apply_url?: string;
}> {
  const id = (postId ?? "").trim();
  if (!id) {
    return {
      ok: false,
      source: PORTAL_ROOT,
      message: "post_id is required",
    };
  }
  return {
    ok: false,
    source: PORTAL_ROOT,
    message: STUB_MESSAGE,
    post_id: id,
    apply_url: DETAIL_PAGE(id),
  };
}

// ---------- fetchDictionaries (stub) ----------

export async function fetchDictionaries(): Promise<{
  ok: boolean;
  source: string;
  message: string;
  note: string;
}> {
  return {
    ok: false,
    source: PORTAL_ROOT,
    message: STUB_MESSAGE,
    note:
      "Filter taxonomy (categories, cities, depts) is served via POST /api/searchCondition/list " +
      "with body {channel:'campus_group_official_site', language:'zh'}. " +
      "Response shape: { searchItems: [{type:'workCity'|'category'|'dept'|'recruitType', items:[{label,value}]}] }. " +
      "All require Alipay login.",
  };
}

// ---------- notices (stub) ----------

export async function listNotices(): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return {
    ok: false,
    source: PORTAL_ROOT,
    message: "Ant Group: no public notices endpoint",
  };
}

export async function getNotice(_id: string): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return {
    ok: false,
    source: PORTAL_ROOT,
    message: "Ant Group: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  matches: never[];
}> {
  return {
    ok: false,
    source: PORTAL_ROOT,
    message: "Ant Group: no public notices endpoint",
    matches: [],
  };
}

// ---------- matchResume (stub) ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
): Promise<{
  ok: boolean;
  source: string;
  message: string;
  extracted_terms?: string[];
  city_preferences?: string[];
  matches?: never[];
}> {
  const { terms, cities } = extractResumeSignals(text ?? "");
  return {
    ok: false,
    source: PORTAL_ROOT,
    message: STUB_MESSAGE,
    extracted_terms: terms,
    city_preferences: cities,
    matches: [],
  };
}
