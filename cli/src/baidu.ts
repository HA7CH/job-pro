// Thin client for Baidu's public campus-recruiting API at talent.baidu.com/jobs.
//
// ============================================================
// Discovery notes (probed 2026-05 — webpack bundle analysis):
//
//   Portal URL: https://talent.baidu.com/jobs/list?recruitType=GRADUATE
//   Old portal: https://talent.baidu.com/external/baidu/index.html (redirects)
//   JS entry:   talent-offical-static-prod.cdn.bcebos.com/hcm-recruitment/...
//   Relevant chunks: 3085675597715898.0406a4cc.chunk.js  (module 1093 = fetch layer)
//                    detail-fetch.9c2c2d3c.chunk.js       (list + detail routing)
//
// ============================================================
// Endpoint inventory:
//
//   POST https://talent.baidu.com/httservice/getPostListNew
//        Content-Type: application/x-www-form-urlencoded  ← CRITICAL: JSON body returns 400
//        Params: recruitType, keyWord, pageNum, pageSize,
//                workPlace (repeatable), postType (repeatable), projectType
//        Response: { status:"ok", data:{ total:"<int>", pages:<int>, pageNum:<int>,
//                    pageSize:<int>, list:[...], hasNextPage:<bool> } }
//        Note: total is a STRING in the response ("100", "416", …)
//
//   GET  https://talent.baidu.com/httservice/getSearchCompDicInfo?recruitType=GRADUATE
//        Returns { status:"ok", data:{ postType:[{code,name,order}],
//                  workPlace:[{code,name,order}],
//                  internProjectType:[{code,name}], graduateProjectType:[{code,name}] } }
//
//   GET  https://talent.baidu.com/httservice/getPostDetail?postId=<uuid>&recruitType=<type>
//        Returns { status:"ok", data:{ postId, name, postType, workPlace, projectType,
//                  serviceCondition (requirements), workContent (description), … } }
//
// ============================================================
// Filter taxonomy (from GET /httservice/getSearchCompDicInfo, probed 2026-05):
//
// DIMENSION 1 — postType (职位类别)
//   "1"  = 技术      "2"  = 产品      "13" = 政企
//   "14" = 销售      "15" = 综合
//
// DIMENSION 2 — workPlace (工作地点, city codes)
//   ""    = 不限     "1100" = 北京市   "3100" = 上海市   "4403" = 深圳市
//   "4401"= 广州市   "5101" = 成都市   "2102" = 大连市   "1403" = 阳泉市
//   "4201"= 武汉市   "3301" = 杭州市   "3501" = 福州市   "4419" = 东莞市
//   "4601"= 海口市   "3701" = 济南市   "9000" = 全国
//
// DIMENSION 3 — recruitType (招聘类型)
//   "GRADUATE" = 校园招聘 (new-grad, default)   ~100 positions
//   "INTERN"   = 实习生招聘                      ~778 positions (split by projectType)
//   "SOCIAL"   = 社招 (separate portal, not returned here)
//
// DIMENSION 4 — projectType (项目类型, varies by recruitType)
//   For GRADUATE:  "" = all (~100), "1" = 校招 (~89), "3" = AIDU项目, "4" = 管培生项目
//   For INTERN:    "" = 9 (social/misc), "-1" = 日常实习项目 (~416), "9" = 暑期实习项目 (~362)
//
// ============================================================
// Pagination gotcha:
//   - total is returned as a STRING ("100"), not a number.
//   - GRADUATE without filters: server caps total at 100 (UI shows 100 positions).
//   - INTERN total depends on projectType: must set projectType to get realistic counts.
//   - Server does NOT support offset-based pagination above the total cap;
//     requesting pageNum > ceil(total/pageSize) silently resets to page 1.
//
// ============================================================
// ---- PositionSummary field mapping (Baidu → canonical) ----
//   post_id       ← item.postId  (UUID string, e.g. "ab5ec82f-…")
//   title         ← item.name    (e.g. "2027AIDU-大模型算法工程师(J99938)")
//   project       ← item.projectType  (e.g. "AIDU项目", "校招", "日常实习项目")
//   recruit_label ← item.postType     (职位类别: "技术", "产品", "综合", …)
//   bgs           ← ""  (Baidu does not expose BG/事业群 in public search)
//   work_cities   ← item.workPlace (comma-joined string "北京市,深圳市")
//   apply_url     ← https://talent.baidu.com/jobs/detail/<recruitType>/<postId>
//
// ============================================================
// Endpoints confirmed NOT to exist publicly:
//   POST /httservice/getPostListNew with JSON body → 400 "Illegal argument : recruitType"
//   /jobs/api/*  → 404
//   /httservice/notice* → (no public notice endpoint found)

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://talent.baidu.com";
const LIST_PAGE = "https://talent.baidu.com/jobs/list";
const DETAIL_PAGE = (recruitType: string, postId: string) =>
  `${API_ROOT}/jobs/detail/${encodeURIComponent(recruitType)}/${encodeURIComponent(postId)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

// ---------- low-level helpers ----------

interface BaiduEnvelope<T> {
  status?: string;
  message?: string;
  data?: T;
}

/** Build an application/x-www-form-urlencoded body string.
 *  The POST endpoint REQUIRES this content type — JSON bodies return 400.
 *  Multi-value keys (workPlace, postType) are handled via repeated keys. */
function buildForm(params: Record<string, string | string[]>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(params)) {
    const values = Array.isArray(val) ? val : [val];
    for (const v of values) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.join("&");
}

async function postForm<T>(
  path: string,
  params: Record<string, string | string[]>,
  referer: string
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: referer,
      },
      body: buildForm(params),
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
  let payload: BaiduEnvelope<T>;
  try {
    payload = (await response.json()) as BaiduEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return {
    ok: payload.status === "ok",
    data: payload.data,
    message: payload.message || (payload.status === "ok" ? "ok" : "upstream error"),
  };
}

async function getJson<T>(
  path: string,
  params: Record<string, string>,
  referer: string
): Promise<{ ok: boolean; data?: T; message: string }> {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_ROOT}${path}${qs ? `?${qs}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, Referer: referer },
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
  let payload: BaiduEnvelope<T>;
  try {
    payload = (await response.json()) as BaiduEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  return {
    ok: payload.status === "ok",
    data: payload.data,
    message: payload.message || (payload.status === "ok" ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface RawPosition {
  postId?: string;
  jobId?: string;
  name?: string;
  postType?: string;         // 职位类别: 技术/产品/政企/销售/综合
  projectType?: string;      // e.g. "AIDU项目", "校招", "日常实习项目"
  projectTypeCode?: string;
  workPlace?: string;        // comma-joined city string: "北京市,深圳市"
  orgName?: string;
  education?: string;
  recruitNum?: string;
  workYears?: string;
  workContent?: string;      // job description
  serviceCondition?: string; // requirements
  publishDate?: string;
  updateDate?: string;
  interviewDate?: string;
  writeExaminationDate?: string;
  favoriteFlag?: boolean;
  hotFlag?: boolean;
}

interface RawListData {
  total?: string | number;
  pages?: number;
  pageNum?: number;
  pageSize?: number;
  list?: RawPosition[];
  hasNextPage?: boolean;
}

interface RawDicInfo {
  postType?: Array<{ code: string; name: string; order?: number }>;
  workPlace?: Array<{ code: string; name: string; order?: number }>;
  internProjectType?: Array<{ code: string; name: string; order?: number }>;
  graduateProjectType?: Array<{ code: string; name: string; order?: number }>;
}

// ---------- PositionSummary ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  /** projectType field: "AIDU项目" / "校招" / "管培生项目" / "日常实习项目" / "暑期实习项目" */
  project: string;
  /** postType field: "技术" / "产品" / "政企" / "销售" / "综合" */
  recruit_label: string;
  /** Always "" — Baidu does not expose BG/事业群 in the public search API */
  bgs: string;
  work_cities: string;
  apply_url: string;
}

function summarizePosition(item: RawPosition, recruitType: string): PositionSummary {
  const postId = item.postId ?? "";
  return {
    post_id: postId,
    title: item.name ?? "",
    project: item.projectType ?? "",
    recruit_label: item.postType ?? "",
    bgs: "",
    work_cities: (item.workPlace ?? "").trim(),
    apply_url: postId ? DETAIL_PAGE(recruitType, postId) : LIST_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Recruit type. Default: "GRADUATE" (校园招聘, matches default site tab, ~100 positions).
   *  Use "INTERN" for 实习生招聘 (~778 positions total, split by projectType).
   *  Note: "SOCIAL" (社招) lives on a separate portal and is not returned here. */
  recruitType?: "GRADUATE" | "INTERN";
  /** Project type code.
   *  For GRADUATE: "" = all (~100), "1" = 校招 (~89), "3" = AIDU项目, "4" = 管培生项目
   *  For INTERN:   "" = misc (9 items), "-1" = 日常实习项目 (~416), "9" = 暑期实习项目 (~362)
   *  Omit (undefined) to fetch all across project types for GRADUATE.
   *  For INTERN, pass "-1" or "9" for meaningful counts. */
  projectType?: string;
  /** Job category codes from GET /httservice/getSearchCompDicInfo.
   *  "1"=技术 "2"=产品 "13"=政企 "14"=销售 "15"=综合
   *  Pass multiple values as an array to OR them (repeatable param). */
  postTypes?: string[];
  /** City codes from GET /httservice/getSearchCompDicInfo → workPlace.
   *  "1100"=北京市 "3100"=上海市 "4403"=深圳市 "4401"=广州市 "5101"=成都市
   *  "2102"=大连市 "4201"=武汉市 "3301"=杭州市 "9000"=全国
   *  Pass multiple values as an array (repeatable param). */
  workPlaces?: string[];
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 10));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const recruitType = opts.recruitType ?? "GRADUATE";

  const params: Record<string, string | string[]> = {
    recruitType,
    keyWord: keyword,
    pageNum: String(page),
    pageSize: String(pageSize),
  };

  if (opts.projectType !== undefined) {
    params.projectType = opts.projectType;
  }

  const postTypes = opts.postTypes ?? [];
  if (postTypes.length) {
    params.postType = postTypes;
  }

  const workPlaces = opts.workPlaces ?? [];
  if (workPlaces.length) {
    params.workPlace = workPlaces;
  }

  const referer = `${LIST_PAGE}?recruitType=${recruitType}`;
  const response = await postForm<RawListData>(
    "/httservice/getPostListNew",
    params,
    referer
  );

  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: "talent.baidu.com",
      query: params,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.list ?? [];
  const total = Number(response.data.total ?? rows.length);
  return {
    ok: true as const,
    source: "talent.baidu.com",
    query: params,
    page,
    page_size: pageSize,
    total,
    positions: rows.map((r) => summarizePosition(r, recruitType)),
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
        source: "talent.baidu.com",
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
    source: "talent.baidu.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string, recruitType = "GRADUATE") {
  const id = (postId ?? "").trim();
  if (!id) {
    return { ok: false as const, source: "talent.baidu.com", message: "post_id is required" };
  }
  const rt = (recruitType ?? "GRADUATE").trim() || "GRADUATE";
  const referer = DETAIL_PAGE(rt, id);
  const response = await getJson<RawPosition>(
    "/httservice/getPostDetail",
    { postId: id, recruitType: rt },
    referer
  );
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      source: "talent.baidu.com",
      post_id: id,
      message: response.message || "no detail returned",
    };
  }
  const raw = response.data;
  const summary = summarizePosition(raw, rt);
  return {
    ok: true as const,
    source: "talent.baidu.com",
    post_id: raw.postId ?? id,
    title: raw.name ?? "",
    direction: "",
    project: raw.projectType ?? "",
    recruit_label: raw.postType ?? "",
    description: raw.workContent ?? "",
    requirements: raw.serviceCondition ?? "",
    work_cities: (raw.workPlace ?? "").trim(),
    publish_date: raw.publishDate ?? "",
    interview_date: raw.interviewDate ?? "",
    exam_date: raw.writeExaminationDate ?? "",
    apply_url: summary.apply_url,
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  // Fetch for both recruit types in parallel; GRADUATE has the full filter set.
  const [gradDic, internDic] = await Promise.all([
    getJson<RawDicInfo>(
      "/httservice/getSearchCompDicInfo",
      { recruitType: "GRADUATE" },
      `${LIST_PAGE}?recruitType=GRADUATE`
    ),
    getJson<RawDicInfo>(
      "/httservice/getSearchCompDicInfo",
      { recruitType: "INTERN" },
      `${LIST_PAGE}?recruitType=INTERN`
    ),
  ]);

  if (!gradDic.ok || !gradDic.data) {
    return {
      ok: false as const,
      source: "talent.baidu.com",
      message: gradDic.message,
    };
  }

  const d = gradDic.data;
  return {
    ok: true as const,
    source: "talent.baidu.com",
    verified_at: new Date().toISOString(),
    /** 职位类别 (job category). Use codes in SearchOptions.postTypes[]. */
    postTypes: (d.postType ?? []).map((t) => ({
      code: t.code,
      name: t.name,
    })),
    /** 工作地点 (city codes). Use codes in SearchOptions.workPlaces[]. */
    workPlaces: (d.workPlace ?? []).map((c) => ({
      code: c.code,
      name: c.name,
    })),
    /** 校园招聘 project types. Use code in SearchOptions.projectType. */
    graduateProjectTypes: (d.graduateProjectType ?? []).map((p) => ({
      code: p.code,
      name: p.name,
    })),
    /** 实习生 project types (from INTERN-scoped call). Use code in SearchOptions.projectType. */
    internProjectTypes: (
      internDic.ok ? (internDic.data?.internProjectType ?? []) : []
    ).map((p) => ({
      code: p.code,
      name: p.name,
    })),
    recruitTypes: [
      { code: "GRADUATE", name: "校园招聘", note: "new-grad campus hire (~100 positions shown)" },
      { code: "INTERN", name: "实习生招聘", note: "intern (~416 日常 + ~362 暑期)" },
    ],
  };
}

// ---------- stub notices ----------
// talent.baidu.com has a 招聘动态 (news/trend) section but no public notice-list
// JSON endpoint was found — it is rendered server-side via httservice/config/article
// which returns HTML articles, not a structured notice API.

const STUB_SOURCE = "talent.baidu.com";
const STUB_MSG = "Baidu: no public structured notices endpoint (招聘动态 is HTML-only)";

export async function listNotices(): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return { ok: false, source: STUB_SOURCE, message: STUB_MSG };
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: STUB_SOURCE, message: STUB_MSG };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: STUB_SOURCE, message: STUB_MSG };
}

// ---------- matchResume ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number; recruitType?: "GRADUATE" | "INTERN" } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 20);
  const recruitType = opts.recruitType ?? "GRADUATE";
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false as const,
      source: STUB_SOURCE,
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, pageSize: 100, recruitType });
  if (!list.ok) {
    return { ok: false as const, source: STUB_SOURCE, message: list.message, positions: [] };
  }

  // Also fetch without keyword to broaden the candidate pool if keyword returns few results
  let allPositions = list.positions;
  if (allPositions.length < candidates) {
    const broad = await searchPositions({ pageSize: 100, recruitType });
    if (broad.ok) {
      const seen = new Set(allPositions.map((p) => p.post_id));
      for (const p of broad.positions) {
        if (!seen.has(p.post_id)) {
          allPositions.push(p);
          seen.add(p.post_id);
        }
      }
    }
  }

  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
    requirements?: string;
  };
  const scored: Scored[] = [];

  for (const p of allPositions) {
    // The list response already includes workContent and serviceCondition inline —
    // no extra detail fetch needed (unlike ByteDance/Tencent which omit description).
    // We access them via the raw list response; for matchResume we use the summary fields.
    const blob = [p.title, p.project, p.recruit_label, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({ score, position: p, reasons });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = allPositions.slice(0, candidates).map((position) => ({
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
    source: STUB_SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_baidu } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_baidu } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_baidu } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "talent.baidu.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://talent.baidu.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "talent.baidu.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_baidu({
      source: "talent.baidu.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://talent.baidu.com/external/baidu/applyJob.json",
      submitKind: "multipart-session",
      submitNotes:
        "Baidu — POST /external/baidu/applyJob.json with session cookie. Endpoint inferred; needs validation.",
    }),
  };
}
