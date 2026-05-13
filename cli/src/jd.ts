// Thin client for JD (京东) campus-recruiting API at campus.jd.com.
//
// ============================================================
// Endpoint inventory (probed 2026-05, JS bundle umi.js 20260511224015):
//
//   GET  https://campus.jd.com/api/wx/position/getProjectList
//        Unauthenticated. Returns recruit types (code: present/internship/talent),
//        plan IDs, direction code lists, and BG names.
//        Response: { success:true, body:{ projectList:[...], bgList:[...], bgbuConfig:[...] } }
//
//   POST https://campus.jd.com/api/wx/position/page?type={{type}}
//        Unauthenticated. type = "present" | "internship" | "talent"
//        Payload: { pageSize:int, pageIndex:int,
//                   parameter:{ positionName:str, planIdList:int[], positionDeptList:[],
//                                jobDirectionCodeList:str[], workCityCodeList:str[] } }
//        Response: { success:true, body:{ totalNumber:int, items:[...] } }
//        - Each item has publishId (= post_id), positionName, jobDirection, jobDirectionCode,
//          workContent, qualification, and requirementVoList (array per city/BG).
//        - positionDeptList: the server accepts [] (no-op); no public dictionary for dept codes.
//        - workCityCodeList: city codes from requirementVoList[].workCityCode (e.g. "00001"=北京).
//        - jobDirectionCodeList: string codes from items[].jobDirectionCode.
//        Observed direction codes (probed 2026-05):
//          "01" 采销与物流方向  "02" 技术方向  "03" 产品方向  "04" 运营方向
//          "05" 供应链方向      "06" 设计方向  "09" 保险及金融方向
//          "10" 新锐之星方向    "13" 管理培训生方向  "14" TGT顶尖技术方向
//          "16" 数据方向        "17" 市场方向  "18" 人力方向
//          "19" 财务方向        "20" 法务方向  "30" 基层管理方向
//          "31" 一线销售方向    "34" 职能方向
//
//   GET  https://campus.jd.com/api/wx/position/detail/{{publishId}}
//        Unauthenticated. Returns the same fields as the list item but with full
//        workContent + qualification text. requirementVoList carries positionBg and workCity.
//        Response: { success:true, body:{ publishId, positionName, jobDirection, ... } }
//
// ============================================================
// Endpoints that require JD SSO auth (all redirect to /passport):
//   POST /api/position/list, /api/social/position/list, /api/campus/position/list,
//   /api/wx/position/page?type=... (GET variant), /api/wx/position/delivery/*,
//   /api/wx/resume/*, /api/wx/favorites/*, /api/common/recruit/dict/*
//
// ============================================================
// Recruit types (from getProjectList, probed 2026-05):
//   code "present"    应届生   ~23 positions
//     planId 52 = JDS-新星计划 (directions 01-06)
//     planId 53 = TET-管理培训生 (direction 13)
//     planId 54 = 新锐之星 (direction 10)
//   code "internship" 实习生   ~110 positions
//     planId 45 = JD YOUNG-实习生计划 (directions 03,04,06,16-20)
//     planId 51 = 新锐之星实习生 (direction 10)
//   code "talent"     TGT专项  ~155 positions
//     planId 47 = TGT-顶尖青年技术天才计划 (direction 14)
//     planId 55 = TGT-顶尖青年技术实习生   (direction 14)
//
// ============================================================
// BG names (from getProjectList bgList):
//   京东集团, 京东零售, 京东物流, 京东科技,
//   京东健康, 京东国际, 京东产发, 京东工业, 京东创新零售, CHO体系, CCO体系, CFO体系
//
// ============================================================
// ---- PositionSummary field mapping (JD → canonical) ----
//   post_id       ← String(item.publishId)
//   title         ← item.positionName
//   project       ← item.jobDirection  (职位方向, e.g. "技术方向")
//   recruit_label ← recruitType label  (e.g. "应届生" / "实习生" / "TGT专项")
//   bgs           ← unique positionBg values from requirementVoList joined with " / "
//   work_cities   ← unique workCity values from requirementVoList joined with " / "
//   apply_url     ← https://campus.jd.com/#/newDetails?publishId=<id>

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://campus.jd.com";
const CAMPUS_PAGE = "https://campus.jd.com/";
const DETAIL_PAGE = (publishId: string) =>
  `${CAMPUS_PAGE}#/newDetails?publishId=${encodeURIComponent(publishId)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Referer: CAMPUS_PAGE,
};

// ---------- raw response types ----------

interface RawRequirementVo {
  planId?: number | null;
  reqNo?: string | null;
  reqName?: string | null;
  workYears?: string | null;
  education?: string | null;
  toWorkTime?: string | null;
  workCityCode?: string;
  workCity?: string;
  interviewCity?: string;
  interviewCityCode?: string;
  positionBg?: string;
  positionDept?: string | null;
  reqId?: number;
}

interface RawPositionItem {
  publishId?: number;
  reqId?: number;
  positionDept?: string | null;
  positionName?: string;
  jobDirection?: string;
  jobDirectionCode?: string;
  workContent?: string;
  qualification?: string;
  publishTime?: number | null;
  deliveryStatus?: unknown;
  requirementVoList?: RawRequirementVo[];
}

interface RawPageBody {
  totalNumber?: number;
  items?: RawPositionItem[];
}

interface RawPageResponse {
  success?: boolean;
  body?: RawPageBody;
  errorMessage?: string;
  errorCode?: string;
}

interface RawDetailResponse {
  success?: boolean;
  body?: RawPositionItem;
  errorMessage?: string;
}

interface RawPlanMap {
  id?: number;
  planName?: string;
  directionList?: string[];
  description?: string | null;
}

interface RawGroup {
  no?: number;
  name?: string;
  planMapList?: RawPlanMap[];
}

interface RawProjectEntry {
  type?: string;
  code?: string;
  release?: boolean;
  groupList?: RawGroup[];
}

interface RawBgbuConfig {
  name?: string;
  queryName?: string;
  descriptions?: string;
  logoUrl?: string;
}

interface RawProjectListBody {
  projectList?: RawProjectEntry[];
  bgList?: string[];
  bgbuConfig?: RawBgbuConfig[];
}

interface RawProjectListResponse {
  success?: boolean;
  body?: RawProjectListBody;
  errorMessage?: string;
}

// ---------- helpers ----------

async function getJson<T>(url: string): Promise<{ ok: boolean; data?: T; message: string }> {
  let response: Response;
  try {
    response = await fetch(url, { headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }
  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, data: payload, message: "ok" };
}

async function postJson<T>(
  url: string,
  body: unknown
): Promise<{ ok: boolean; data?: T; message: string }> {
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
  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, data: payload, message: "ok" };
}

// ---------- PositionSummary ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;     // ← jobDirection (e.g. "技术方向")
  recruit_label: string; // ← recruit type label derived from ?type= param
  bgs: string;         // ← unique positionBg values from requirementVoList
  work_cities: string; // ← unique workCity values from requirementVoList
  apply_url: string;
}

function summarizePosition(item: RawPositionItem, recruitLabel: string): PositionSummary {
  const id = String(item.publishId ?? "");
  const reqs = item.requirementVoList ?? [];

  const seenCities = new Set<string>();
  const seenBgs = new Set<string>();
  for (const r of reqs) {
    if (r.workCity) seenCities.add(r.workCity);
    if (r.positionBg) seenBgs.add(r.positionBg);
  }

  return {
    post_id: id,
    title: item.positionName ?? "",
    project: item.jobDirection ?? "",
    recruit_label: recruitLabel,
    bgs: [...seenBgs].join(" / "),
    work_cities: [...seenCities].join(" / "),
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// Label mapping for the three recruit type codes
const TYPE_LABELS: Record<string, string> = {
  present: "应届生",
  internship: "实习生",
  talent: "TGT专项",
};

// ---------- SearchOptions ----------

export interface SearchOptions {
  /** Keyword to filter by position name. Max 60 chars. */
  keyword?: string;
  /** Page number (1-based). Default: 1. */
  page?: number;
  /** Page size. Default: 20. Max: 200 (server returns all if huge). */
  pageSize?: number;
  /** Recruit type tab: "present" (应届生, default), "internship" (实习生), "talent" (TGT专项).
   *  Corresponds to projectList[].code from getProjectList. */
  recruitType?: "present" | "internship" | "talent";
  /** Filter by plan IDs from getProjectList (planMapList[].id).
   *  e.g. [45] = JD YOUNG实习生计划, [47] = TGT-顶尖青年技术天才计划. */
  planIdList?: number[];
  /** Filter by job direction codes from items[].jobDirectionCode.
   *  e.g. ["02"] = 技术方向, ["01"] = 采销与物流方向, ["14"] = TGT顶尖技术方向. */
  jobDirectionCodeList?: string[];
  /** Filter by city codes from requirementVoList[].workCityCode.
   *  e.g. ["00001"] = 北京市, ["00196"] = 广东省-广州市. */
  workCityCodeList?: string[];
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const recruitType = opts.recruitType ?? "present";
  const recruitLabel = TYPE_LABELS[recruitType] ?? recruitType;
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const payload = {
    pageSize,
    pageIndex: page,
    parameter: {
      positionName: keyword,
      planIdList: opts.planIdList ?? [],
      positionDeptList: [],
      jobDirectionCodeList: opts.jobDirectionCodeList ?? [],
      workCityCodeList: opts.workCityCodeList ?? [],
    },
  };

  const url = `${API_ROOT}/api/wx/position/page?type=${encodeURIComponent(recruitType)}`;
  const resp = await postJson<RawPageResponse>(url, payload);

  if (!resp.ok || !resp.data) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      message: resp.message,
      query: payload,
      page,
      page_size: pageSize,
      total: 0,
      positions: [] as PositionSummary[],
    };
  }

  const d = resp.data;
  if (!d.success) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      message: d.errorMessage ?? "upstream returned success=false",
      query: payload,
      page,
      page_size: pageSize,
      total: 0,
      positions: [] as PositionSummary[],
    };
  }

  const items = d.body?.items ?? [];
  return {
    ok: true as const,
    source: "campus.jd.com",
    query: payload,
    page,
    page_size: pageSize,
    total: d.body?.totalNumber ?? items.length,
    positions: items.map((item) => summarizePosition(item, recruitLabel)),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 10);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false as const,
        source: "campus.jd.com",
        message: result.message,
        total: total ?? 0,
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
    source: "campus.jd.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      message: "post_id is required",
    };
  }

  const url = `${API_ROOT}/api/wx/position/detail/${encodeURIComponent(id)}`;
  const resp = await getJson<RawDetailResponse>(url);

  if (!resp.ok || !resp.data) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      post_id: id,
      message: resp.message,
    };
  }

  if (!resp.data.success) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      post_id: id,
      message: resp.data.errorMessage ?? "upstream returned success=false",
    };
  }

  const raw = resp.data.body;
  if (!raw) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      post_id: id,
      message: "empty body in detail response",
    };
  }

  const reqs = raw.requirementVoList ?? [];
  const seenCities: string[] = [];
  const seenBgs: string[] = [];
  const seenCitySet = new Set<string>();
  const seenBgSet = new Set<string>();
  for (const r of reqs) {
    if (r.workCity && !seenCitySet.has(r.workCity)) {
      seenCities.push(r.workCity);
      seenCitySet.add(r.workCity);
    }
    if (r.positionBg && !seenBgSet.has(r.positionBg)) {
      seenBgs.push(r.positionBg);
      seenBgSet.add(r.positionBg);
    }
  }

  return {
    ok: true as const,
    source: "campus.jd.com",
    post_id: String(raw.publishId ?? id),
    title: raw.positionName ?? "",
    direction: raw.jobDirection ?? "",
    description: raw.workContent ?? "",
    requirements: raw.qualification ?? "",
    work_cities: seenCities,
    recruit_cities: reqs
      .map((r) => r.interviewCity)
      .filter((v): v is string => Boolean(v))
      .filter((v, i, arr) => arr.indexOf(v) === i),
    bgs: seenBgs,
    apply_url: DETAIL_PAGE(String(raw.publishId ?? id)),
  };
}

// ---------- fetchDictionaries ----------
// GET /api/wx/position/getProjectList is unauthenticated and returns the full
// recruit-type × plan × direction taxonomy plus the BG name list.
// No city dictionary or department code dictionary exists publicly.

let _projectCache: ReturnType<typeof _buildDictResult> | null = null;

function _buildDictResult(data: RawProjectListResponse) {
  const body = data.body ?? {};
  const projectList = body.projectList ?? [];

  type PlanEntry = {
    id: number;
    name: string;
    recruitType: string;
    recruitTypeCode: string;
    directionCodes: string[];
  };
  const plans: PlanEntry[] = [];

  for (const p of projectList) {
    for (const g of p.groupList ?? []) {
      for (const pm of g.planMapList ?? []) {
        plans.push({
          id: pm.id ?? 0,
          name: pm.planName ?? "",
          recruitType: p.type ?? "",
          recruitTypeCode: p.code ?? "",
          directionCodes: pm.directionList ?? [],
        });
      }
    }
  }

  const knownDirections: Record<string, string> = {
    "01": "采销与物流方向",
    "02": "技术方向",
    "03": "产品方向",
    "04": "运营方向",
    "05": "供应链方向",
    "06": "设计方向",
    "09": "保险及金融方向",
    "10": "新锐之星方向",
    "13": "管理培训生方向",
    "14": "TGT顶尖技术方向",
    "16": "数据方向",
    "17": "市场方向",
    "18": "人力方向",
    "19": "财务方向",
    "20": "法务方向",
    "30": "基层管理方向",
    "31": "一线销售方向",
    "34": "职能方向",
  };

  return {
    ok: true as const,
    source: "campus.jd.com",
    verified_at: new Date().toISOString(),
    recruit_types: projectList.map((p) => ({
      code: p.code ?? "",
      name: p.type ?? "",
      label: TYPE_LABELS[p.code ?? ""] ?? p.type ?? "",
    })),
    plans,
    job_directions: Object.entries(knownDirections).map(([code, name]) => ({ code, name })),
    business_groups: body.bgList ?? [],
    business_group_details: (body.bgbuConfig ?? []).map((b) => ({
      name: b.name ?? "",
      queryName: b.queryName ?? "",
      description: b.descriptions ?? "",
    })),
    note:
      "City codes live in requirementVoList[].workCityCode on each position item — " +
      "no public city dictionary endpoint exists. " +
      "Department codes are not publicly exposed.",
  };
}

export async function fetchDictionaries() {
  if (_projectCache !== null) return _projectCache;

  const url = `${API_ROOT}/api/wx/position/getProjectList`;
  const resp = await getJson<RawProjectListResponse>(url);

  if (!resp.ok || !resp.data) {
    const r = {
      ok: false as const,
      source: "campus.jd.com",
      message: `JD: getProjectList failed — ${resp.message}`,
    };
    return r;
  }

  if (!resp.data.success) {
    const r = {
      ok: false as const,
      source: "campus.jd.com",
      message: `JD: getProjectList returned success=false — ${resp.data.errorMessage ?? ""}`,
    };
    return r;
  }

  const result = _buildDictResult(resp.data);
  _projectCache = result;
  return result;
}

// ---------- stub notices ----------
// No public notice/announcement endpoint was found.

const STUB_NOTICES_RESULT = {
  ok: false as const,
  source: "campus.jd.com",
  message: "JD: no public notices endpoint",
} as const;

export async function listNotices() {
  return STUB_NOTICES_RESULT;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "campus.jd.com",
    message: "JD: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "campus.jd.com",
    message: "JD: no public notices endpoint",
  };
}

// ---------- matchResume ----------
// Mirror tencent's algorithm:
// 1. Extract signals from resume text.
// 2. Search with top-3 terms as keyword across recruitType="internship" (larger pool).
// 3. Score each position against title + direction + BG + cities + description blobs.
// 4. Enrich top candidates with full detail and re-score.
// 5. Return top N matches with reasons.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number; recruitType?: "present" | "internship" | "talent" } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 20);
  const recruitType = opts.recruitType ?? "internship";
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");

  // Fetch up to 200 positions so we have a good candidate pool
  const list = await searchPositions({ keyword, page: 1, pageSize: 200, recruitType });
  if (!list.ok) {
    return {
      ok: false as const,
      source: "campus.jd.com",
      message: list.message,
      positions: [] as PositionSummary[],
    };
  }

  // If keyword search returns few results, fall back to full list
  const pool =
    list.positions.length < 10
      ? (await searchPositions({ page: 1, pageSize: 200, recruitType })).positions
      : list.positions;

  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
  };
  const scored: Scored[] = [];

  for (const p of pool) {
    const blob = [p.title, p.project, p.recruit_label, p.bgs, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({ score, position: p, reasons });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    // Fallback: return first candidates from pool
    shortlist = pool.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  // Enrich top candidates with detail for description-level scoring
  type Enriched = {
    score: number;
    row: PositionSummary & {
      description?: string;
      requirements?: string;
      match_reasons: string[];
    };
  };
  const enriched: Enriched[] = [];

  for (const { score: baseScore, position, reasons: baseReasons } of shortlist.slice(0, candidates)) {
    const detail = await fetchPositionDetail(position.post_id);
    let extraScore = 0;
    let extraReasons: string[] = [];
    let description: string | undefined;
    let requirements: string | undefined;

    if (detail.ok) {
      description = detail.description;
      requirements = detail.requirements;
      const detailBlob = [
        detail.title,
        detail.direction,
        detail.description,
        detail.requirements,
        detail.bgs.join(" "),
        detail.work_cities.join(" "),
      ].join(" ");
      const r = scoreOverlap(detailBlob, terms, cities);
      extraScore = r.score;
      extraReasons = r.reasons;
    }

    const combined = [...new Set([...baseReasons, ...extraReasons])].slice(0, 5);
    if (!combined.length) {
      combined.push("no specific keyword overlap — surfaced from initial keyword search");
    }

    enriched.push({
      score: baseScore + extraScore,
      row: {
        ...position,
        description,
        requirements,
        match_reasons: combined,
      },
    });
  }
  enriched.sort((a, b) => b.score - a.score);

  return {
    ok: true as const,
    source: "campus.jd.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches: enriched.slice(0, topN).map((e) => e.row),
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
