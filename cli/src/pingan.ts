// Thin client for Ping An's (中国平安) public campus-recruiting API at campus.pingan.com.
//
// campus.pingan.com is a self-hosted Vue 2 SPA (webpack). All API calls
// go through a single backend at:
//
//   https://campus.pingan.com/zztj-recruit-talent-webserver/rctt
//
// Endpoints are unauthenticated for read-only operations; the server returns
// JSON with an envelope { responseCode, responseMsg, data }.
// Success code is "10001"; "20006" = missing required parameter.
//
// ============================================================
// Endpoint inventory (probed 2026-05, JS bundle app.0687451e.js +
//   chunk_freshStudent~chunk_internStudent~chunk_position.aba9b06f.js):
//
//   POST /candidate/officialWebsite/selectGroupOfficial
//        Gets the wecruitId (session-like token) for a given campus site.
//        Required payload: { websiteType: "3", officialUrl: "campus.pingan.com",
//                            recruitType: "3" }
//        Response: { responseCode:"10001", data:"<32-char-hex-wecruitId>" }
//        websiteType values: 3 = 集团官网/Group campus site (confirmed).
//        The wecruitId for the production Group campus site is stable across
//        requests (probed 2026-05: "6c1db1bba8c33deab19a733ec785711a").
//        We re-fetch it live on each cold start and cache in-process.
//
//   POST /candidate/position/campus/positionSearch/queryPositionPage
//        Search / list positions.
//        Required: { wecruitId, pageNo, pageSize }
//        Optional filters: { keyWord, workCity, interviewCity, businessUnitId,
//                            positionCategoryId, positionType }
//        Response: { responseCode:"10001", data:{ list:[...], pageNo, pageSize,
//                    totalCount, totalPage } }
//        Total positions (no filter, 2026-05): ~849 across all subsidiaries.
//
//   POST /candidate/position/campus/positionSearch/queryPositionDetail
//        Fetch a single position's full detail.
//        Required: { positionId: "<idPosition>", wecruitId }
//        Response: { data: { position:{...}, description, checkResumeRepeat } }
//
//   POST /candidate/position/campus/positionSearch/queryCityCompanyCategory
//        Returns filter taxonomy (cities, subsidiaries, positionCategoryMap).
//        Required: { wecruitId }
//        Returns: { data: { domesticCity, overseasCity, interviewCity,
//                            campusCompanyMap, positionCategoryMap,
//                            newPositionCategory, specialCompany } }
//
// ============================================================
// Filter semantics (from JS bundle analysis + probing, 2026-05):
//
//   positionType (招聘性质)
//     "全职" = 应届生 full-time positions  ~787 posts
//     "实习"  = intern positions            ~62 posts
//     No filter = all                       ~849 posts
//
//   positionCategoryId (职位类别, short codes used in real data):
//     C001  技术类        C003  产品类         C004  设计类
//     C005  市场类        C006  职能类         C009  业务类
//     C015  共同资源类    C016  管培生
//     (These come from position.positionCategoryId in list responses, not from
//     the positionCategoryMap which uses UUID keys — the UUID keys do NOT match.)
//
//   businessUnitId (成员公司/subsidiary):
//     PA001  平安集团      PA002  平安寿险       PA004  平安产险
//     PA006  平安银行      PA010  平安健康险     PA011  平安证券
//     PA014  平安资管      PA017  陆控           PA021  平安科技
//     PA023  平安医疗健康  PA026  平安租赁       PA043  金融壹帐通
//     (From real position data — not exhaustive; more exist)
//
//   workCity / interviewCity: Chinese city name string, e.g. "上海市", "北京市"
//
// ============================================================
// Position detail URL (from chunk_positionDetail.24051db4.js analysis):
//   https://campus.pingan.com/positionDetail?positionId=<idPosition>
//
// ============================================================
// Subsidiaries sharing the API: ALL Ping An group entities (平安集团, 平安银行,
//   平安寿险, 平安科技, etc.) share a single campus.pingan.com portal and the
//   same API backend. There is no separate endpoint per subsidiary.
//   The businessUnitId field in responses identifies the specific entity.
//
// ============================================================
// Endpoints that exist but require login (10005 response):
//   POST /candidate/campus/deliveryRecord/getAll          (application history)
//   POST /candidate/campus/deliveryRecord/insertJobIntension (apply)
//
// No public /notices or /announcements equivalent found.
//
// ============================================================
// ---- PositionSummary field mapping (PingAn → canonical) ----
//   post_id        ← item.idPosition  (32-char hex UUID)
//   title          ← item.positionName
//   project        ← item.positionCategoryName  (职位类别)
//   recruit_label  ← item.positionType  (全职 / 实习)
//   bgs            ← item.businessUnitName + " / " + (item.deptShowName || item.deptName)
//   work_cities    ← item.workCity
//   apply_url      ← https://campus.pingan.com/positionDetail?positionId=<id>

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { extractResumeSignals, scoreOverlap, checkResume };

/**
 * Ping An supports campus / intern / all only (1.1.0+).
 *
 * campus.pingan.com is structurally a campus portal. Probed 2026-05-20:
 *   - `selectGroupOfficial` with `recruitType:"2"` (社招推断) returns
 *     the SAME wecruitId as `recruitType:"3"` (campus) — the wecruitId
 *     is not scope-bound on this portal.
 *   - `queryPositionPage` with `recruitType:"2"` on the campus wecruitId
 *     returns the IDENTICAL 815-post feed as the default call (param
 *     silently ignored; every row's positionType is "全职" / "实习").
 *   - `positionType:"社招"` returns `{data:null}` (filter recognised but
 *     matches nothing — no 社招 rows exist).
 *   - `/candidate/position/social/positionSearch/queryPositionPage` 404s
 *     ("The requested resource could not be found" — no /social/ subroute
 *     on the talent-webserver).
 *
 * Ping An's social-hire feed lives on a different stack (career.pingan.com,
 * separate ATS). Dispatcher should fail fast for `--scope social`.
 *
 * Scope translation:
 *   campus    → positionType:"全职"   (787 posts)
 *   intern    → positionType:"实习"   (62 posts)
 *   all       → no positionType filter (815 posts)
 *   undefined → no positionType filter (preserves 1.0.93 default — all types)
 */
export const supportedScopes = ["campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

function positionTypeForScope(s: PositionScope | undefined): string | undefined {
  if (s === "campus") return "全职";
  if (s === "intern") return "实习";
  // "all" + undefined → no filter (return undefined; payload omits positionType)
  return undefined;
}

const API_ROOT = "https://campus.pingan.com/zztj-recruit-talent-webserver/rctt";
const CAMPUS_PAGE = "https://campus.pingan.com";
const DETAIL_PAGE = (id: string) =>
  `${CAMPUS_PAGE}/positionDetail?positionId=${encodeURIComponent(id)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json;charset=utf-8",
  "Content-Type": "application/json",
  Origin: CAMPUS_PAGE,
  Referer: `${CAMPUS_PAGE}/`,
};

// ---------- envelope ----------

interface PaEnvelope<T> {
  responseCode?: string;
  responseMsg?: string;
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

  let payload: PaEnvelope<T>;
  try {
    payload = (await response.json()) as PaEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  const ok = payload.responseCode === "10001";
  return {
    ok,
    data: payload.data,
    message: payload.responseMsg || (ok ? "ok" : "upstream error"),
  };
}

// ---------- wecruitId cache ----------
// wecruitId is a session-like token that the Group campus site issues.
// It is stable across requests (same value for campus.pingan.com in all probes).
// We fetch it once per process and cache it.

let _wecruitIdCache: string | null = null;

async function getWecruitId(): Promise<string | null> {
  if (_wecruitIdCache !== null) return _wecruitIdCache;

  const result = await call<string>(
    "/candidate/officialWebsite/selectGroupOfficial",
    {
      websiteType: "3",           // 集团官网/Group campus
      officialUrl: "campus.pingan.com",
      recruitType: "3",           // campus / 校园招聘
    }
  );
  if (result.ok && typeof result.data === "string" && result.data.length > 0) {
    _wecruitIdCache = result.data;
    return _wecruitIdCache;
  }
  return null;
}

// ---------- raw response types ----------

interface RawPosition {
  idPosition?: string;
  positionName?: string;
  positionCategoryId?: string;
  positionCategoryName?: string;
  positionType?: string;       // "全职" | "实习"
  businessUnitId?: string;
  businessUnitName?: string;
  deptName?: string;
  deptShowName?: string;
  workCity?: string;
  workCityCode?: string;
  interviewCity?: string;
  duty?: string;               // job description
  qualification?: string;      // requirements
  education?: string;          // min education level
  positionCode?: string;
  publishDate?: string;
  recruitNumber?: number;
}

interface RawPositionListData {
  list?: RawPosition[];
  pageNo?: number;
  pageSize?: number;
  totalCount?: number;
  totalPage?: number;
}

interface RawPositionDetailData {
  position?: RawPosition & {
    positionId?: string;
    positionShareId?: string;
  };
  description?: string | null;
  checkResumeRepeat?: { isRepeat?: number };
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
  const id = item.idPosition ?? "";
  const dept = (item.deptShowName ?? item.deptName ?? "").trim();
  const company = (item.businessUnitName ?? "").trim();
  const bgs = dept ? `${company} / ${dept}` : company;
  return {
    post_id: id,
    title: item.positionName ?? "",
    project: item.positionCategoryName ?? "",
    recruit_label: item.positionType ?? "",
    bgs,
    work_cities: (item.workCity ?? "").trim(),
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Work city (Chinese city name), e.g. "上海市", "北京市". */
  workCity?: string;
  /** Interview city (Chinese city name), e.g. "深圳市". */
  interviewCity?: string;
  /** Subsidiary businessUnitId, e.g. "PA006"=平安银行, "PA021"=平安科技.
   *  Pass without a filter to get all subsidiaries (default). */
  businessUnitId?: string;
  /** Position category short code, e.g. "C001"=技术, "C016"=管培生,
   *  "C009"=业务, "C006"=职能, "C003"=产品, "C004"=设计, "C005"=市场.
   *  Pass without a filter to get all categories (default). */
  positionCategoryId?: string;
  /** Recruit type: "全职" = new-grad full-time (default), "实习" = intern.
   *  Pass undefined / "" to get all. */
  positionType?: string;
  /** Canonical CLI scope axis (1.1.0+). When set and `positionType` is
   *  omitted, scope picks the upstream positionType filter. Social is not
   *  supported on campus.pingan.com (see supportedScopes comment). */
  scope?: PositionScope;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const wecruitId = await getWecruitId();
  if (!wecruitId) {
    return {
      ok: false,
      source: "campus.pingan.com",
      message: "could not obtain wecruitId from selectGroupOfficial",
      positions: [] as PositionSummary[],
    };
  }

  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 20);

  const payload: Record<string, unknown> = {
    wecruitId,
    pageNo: page,
    pageSize,
  };
  if (keyword) payload["keyWord"] = keyword;
  if (opts.workCity) payload["workCity"] = opts.workCity.trim();
  if (opts.interviewCity) payload["interviewCity"] = opts.interviewCity.trim();
  if (opts.businessUnitId) payload["businessUnitId"] = opts.businessUnitId.trim();
  if (opts.positionCategoryId) payload["positionCategoryId"] = opts.positionCategoryId.trim();
  // positionType: explicit positionType wins; otherwise derive from scope (1.1.0+).
  // undefined positionType + undefined/all scope = all types (no filter).
  const positionType =
    opts.positionType !== undefined ? opts.positionType : positionTypeForScope(opts.scope);
  if (positionType !== undefined) payload["positionType"] = positionType;

  const response = await call<RawPositionListData>(
    "/candidate/position/campus/positionSearch/queryPositionPage",
    payload
  );
  if (!response.ok || !response.data) {
    return {
      ok: false,
      source: "campus.pingan.com",
      message: response.message,
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.list ?? [];
  return {
    ok: true,
    source: "campus.pingan.com",
    query: payload,
    page,
    page_size: pageSize,
    total: response.data.totalCount ?? rows.length,
    total_pages: response.data.totalPage,
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
        ok: false,
        source: "campus.pingan.com",
        message: result.message,
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
    source: "campus.pingan.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(positionId: string) {
  const id = (positionId ?? "").trim();
  if (!id) {
    return { ok: false, source: "campus.pingan.com", message: "positionId is required" };
  }

  const wecruitId = await getWecruitId();
  if (!wecruitId) {
    return {
      ok: false,
      source: "campus.pingan.com",
      post_id: id,
      message: "could not obtain wecruitId",
    };
  }

  const response = await call<RawPositionDetailData>(
    "/candidate/position/campus/positionSearch/queryPositionDetail",
    { positionId: id, wecruitId }
  );
  if (!response.ok || !response.data) {
    return {
      ok: false,
      source: "campus.pingan.com",
      post_id: id,
      message: response.message || "no detail returned",
    };
  }

  const pos = response.data.position ?? {};
  const dept = (pos.deptShowName ?? pos.deptName ?? "").trim();
  const company = (pos.businessUnitName ?? "").trim();
  return {
    ok: true,
    source: "campus.pingan.com",
    post_id: id,
    title: pos.positionName ?? "",
    direction: pos.positionCategoryName ?? "",
    project: pos.positionCategoryName ?? "",
    recruit_label: pos.positionType ?? "",
    description: pos.duty ?? response.data.description ?? "",
    requirements: pos.qualification ?? "",
    education: pos.education ?? "",
    recruit_number: pos.recruitNumber,
    work_cities: (pos.workCity ?? "").trim(),
    interview_city: (pos.interviewCity ?? "").trim(),
    bgs: dept ? `${company} / ${dept}` : company,
    apply_url: DETAIL_PAGE(id),
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  const wecruitId = await getWecruitId();
  if (!wecruitId) {
    return {
      ok: false,
      source: "campus.pingan.com",
      message: "could not obtain wecruitId",
    };
  }

  const response = await call<{
    domesticCity?: Record<string, unknown[]>;
    overseasCity?: Record<string, unknown[]>;
    interviewCity?: Record<string, unknown[]>;
    campusCompanyMap?: { data?: Record<string, unknown[]> };
    positionCategoryMap?: Array<{ idPositionCategory?: string; categoryName?: string }>;
    newPositionCategory?: unknown;
    specialCompany?: unknown;
  }>(
    "/candidate/position/campus/positionSearch/queryCityCompanyCategory",
    { wecruitId }
  );

  if (!response.ok || !response.data) {
    return { ok: false, source: "campus.pingan.com", message: response.message };
  }

  const d = response.data;

  // Flatten domestic cities from alphabetically-grouped map
  const domesticCities: string[] = [];
  for (const entries of Object.values(d.domesticCity ?? {})) {
    for (const e of entries) {
      const city = (e as Record<string, unknown>)["workCity"];
      if (typeof city === "string" && city) domesticCities.push(city);
    }
  }

  const companySectors: Record<string, string[]> = {};
  for (const [sector, companies] of Object.entries(d.campusCompanyMap?.data ?? {})) {
    companySectors[sector] = (companies as Array<Record<string, unknown>>).map(
      (c) => String(c["companyName"] ?? "")
    );
  }

  const positionCategories = (d.positionCategoryMap ?? []).map((c) => ({
    id: c.idPositionCategory ?? "",
    name: c.categoryName ?? "",
  }));

  return {
    ok: true,
    source: "campus.pingan.com",
    verified_at: new Date().toISOString(),
    wecruitId,
    domestic_cities: domesticCities,
    company_sectors: companySectors,
    position_categories: positionCategories,
    note:
      "positionCategoryId values in search use the short-code from actual positions (C001, C009, etc.) " +
      "not the UUID keys returned by positionCategoryMap.",
  };
}

// ---------- stub notices ----------
// campus.pingan.com has no public announcement/notice endpoint.

const STUB_NOTICES = {
  ok: false as const,
  source: "campus.pingan.com",
  message: "PingAn campus: no public notices endpoint discovered",
};

export async function listNotices(): Promise<typeof STUB_NOTICES> {
  return STUB_NOTICES;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "campus.pingan.com",
    message: "PingAn campus: no public notices endpoint discovered",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "campus.pingan.com",
    message: "PingAn campus: no public notices endpoint discovered",
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
      source: "campus.pingan.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  // Pingan rejects English keywords — skip keyword search and do a broad no-keyword
  // fetch, then score locally against extracted terms.
  const list = await searchPositions({ pageSize: 100 });
  if (!list.ok) {
    return { ok: false, source: "campus.pingan.com", message: list.message, positions: [] };
  }

  // Fetch a broader raw batch to access duty + qualification fields for scoring
  const wecruitId = await getWecruitId();
  const rawPosts: RawPosition[] = [];
  if (wecruitId) {
    const raw = await call<RawPositionListData>(
      "/candidate/position/campus/positionSearch/queryPositionPage",
      { wecruitId, pageNo: 1, pageSize: 100 }
    );
    if (raw.ok && raw.data?.list) {
      rawPosts.push(...raw.data.list);
    }
  }

  const rawById = new Map<string, RawPosition>();
  for (const p of rawPosts) {
    if (p.idPosition) rawById.set(p.idPosition, p);
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
      p.bgs,
      p.work_cities,
      rp?.duty ?? "",
      rp?.qualification ?? "",
    ].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({
        score,
        position: p,
        reasons,
        description: rp?.duty,
        requirements: rp?.qualification,
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
      description: rawById.get(position.post_id)?.duty,
      requirements: rawById.get(position.post_id)?.qualification,
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
    source: "campus.pingan.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_pingan } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_pingan } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_pingan } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "campus.pingan.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://campus.pingan.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "campus.pingan.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_pingan({
      source: "campus.pingan.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://campus.pingan.com/recruit/api/applyJob",
      submitKind: "multipart-session",
      endpointVerified: true,
      submitNotes:
        "Ping An — POST /recruit/api/applyJob with session cookie. Endpoint anon-probed → HTTP 405 + Nginx page (routing table has this URL; the backend expects POST with session, not anon). Body shape still needs validation.",
    }),
  };
}
