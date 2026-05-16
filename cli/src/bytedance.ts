// Thin client for ByteDance's public campus-recruiting API at jobs.bytedance.com.
//
// All endpoints are unauthenticated; the server enforces portal-channel /
// portal-platform / website-path headers to discourage cross-site embedding.
//
// ============================================================
// Endpoint inventory (probed 2026-05, JS bundle 5635.93c0c8db.js):
//
//   POST https://jobs.bytedance.com/api/v1/search/job/posts
//        Payload: { keyword, limit, offset, portal_type:3, portal_entrance:1, language:"zh",
//                   recruitment_id_list, job_category_id_list, location_code_list,
//                   subject_id_list, tag_id_list, storefront_id_list, job_function_id_list }
//        Response: { code:0, data:{ job_post_list:[...], count:<int> }, message:"ok" }
//
//   GET  https://jobs.bytedance.com/api/v1/config/job/filters/{any_id}
//        Returns the full filter taxonomy: job_type_list (=job categories, 2-level),
//        city_list, job_subject_list.  The {id} param is ignored — same data every time.
//        Verified: /config/job/filters/campus returns code:0.
//        Note: recruitment_type_list, job_type_count_map, city_count_map are null in the
//        public campus response (counts must be fetched via search).
//
// ============================================================
// Filter semantics (from JS bundle S={1:"1",2:"201",3:"202,301"} mapping):
//   URL ?type=2  → recruitment_id_list:["201"]      → 正式 (campus / new-grad)  ~2057 posts
//   URL ?type=3  → recruitment_id_list:["202"]      → 实习 (intern)              ~5767 posts
//   URL ?type=3  → recruitment_id_list:["202","301"]→ 实习+other (S map), same ~5767
//   No filter   → all listings                                                   ~7824 posts
//   ID 301 alone returns 0 (no active posts).
//
// The campus page (jobs.bytedance.com/campus/position) defaults to the 校园招聘 tab (type=2,
// 正式/new-grad only).  Without recruitment_id_list the API returns all 7824 listings
// (campus + intern combined), which does NOT match the default tab view.
// The correct default filter is recruitment_id_list:["201"].
//
// ============================================================
// Full filter taxonomy (from GET /api/v1/config/job/filters/campus, probed 2026-05):
//
// DIMENSION 1 — job_category_id_list (职位类别, 2-level hierarchy)
//   Parent "研发/R&D"          id:6704215862603155720
//     算法/Algorithm           id:6704215956018694411
//     后端/Backend             id:6704215862557018372
//     客户端/Client            id:6704215957146962184
//     前端/Frontend            id:6704215886108035339
//     测试/Testing             id:6704215897130666254
//     大数据/Big data          id:6704215888985327886
//     机器学习/Machine learning id:6704219534724696331
//     安全/Security            id:6704216109274368264
//     硬件/Hardware            id:6938376045242353957
//     基础架构/Infrastructure  id:6704215958816295181
//     多媒体/Multimedia        id:6704215963966900491
//     计算机视觉/Computer vision id:6704216296701036811
//     运维/DevOps              id:6704217321877014787
//     数据挖掘/Data mining     id:6704216635923761412
//     自然语言处理/NLP         id:6704219452277262596
//   Parent "运营/Operations"   id:6704215882479962371
//     产品运营/Product ops     id:6704216057269192973
//     商业运营/Commerce ops    id:6704215882438019342
//     用户运营/User ops        id:6704215955154667787
//     项目管理/Project Mgmt    id:6863074795655792910
//     内容运营/Content ops     id:6704215961064442123
//     游戏运营/Game Operations id:6850051246221429006
//     销售运营/Sales ops       id:6704216853931100430
//     审核/Content auditing    id:6704215908782442766
//     编辑/Editor              id:6704217437631416580
//   Parent "产品/Product"      id:6704215864629004552
//     产品经理/Product manager id:6704215864591255820
//     数据分析/Data analysis   id:6704216224387041544
//     商业产品（广告）         id:6704215924712409352
//   Parent "职能/支持"         id:6704215913488451847
//     人力/HR                  id:6704216386916321540
//     战略/Strategy            id:6704216232129726734
//     财务/Finance             id:6704216480889702664
//     IT支持/IT support        id:6704217005358057732
//     法务/Legal               id:6704215913454897421
//     行政设施/Facilities      id:6704216727414114564
//     内审/Internal Approval   id:6850051245856524558
//   Parent "设计/Design"       id:6709824272514156812
//     游戏美术/Game Art        id:6850051246036879630
//     用户研究/User Research   id:6709824272996501772
//     交互设计/Interaction design id:6704216925762750724
//     UI                       id:6704216194292910348
//     视觉设计/Visual Design   id:6709824272627403020
//     多媒体设计/Multi-media Design id:6709824273332046088
//   Parent "销售/Sales"        id:6709824272505768200
//     销售/Sales               id:6704215938645887239
//     销售支持/Sales support   id:6704215966085024003
//   Parent "市场/Marketing"    id:6704215901438216462
//     营销策划/Marketing planning id:6704216021651163395
//     广告投放/Advertising     id:6704215901392079117
//     媒介公关/Media relations id:6704217388763580683
//     PR                       id:6704216386178124040
//     品牌/Branding            id:6704216430973290760
//     商务拓展BD/Business dev  id:6704216950135851275
//   Parent "游戏策划/Game Design" id:6850051244971526414
//     游戏数值策划/Game Statistics id:6850051245315459342
//     游戏音频策划/Game Audio  id:6850051245680363783
//
// DIMENSION 2 — location_code_list (工作地点, city codes)
//   CT_11=北京 CT_125=上海 CT_128=深圳 CT_52=杭州 CT_45=广州 CT_22=成都
//   CT_192=珠海 CT_155=西安 CT_154=武汉 CT_107=南京 CT_190=重庆 CT_163=新加坡
//   CT_188=郑州 CT_66=济南 CT_143=天津 CT_119=青岛 CT_129=沈阳 CT_199=苏州
//   CT_20=长沙 CT_158=厦门 CT_159=中国香港 (+ ~30 more in full list)
//
// DIMENSION 3 — recruitment_id_list (招聘类型)
//   "201" = 正式 (campus / new-grad)
//   "202" = 实习 (intern)
//   "301" = (reserved / currently 0 posts)
//
// DIMENSION 4 — subject_id_list (项目, special programs — 顶尖/elite tracks)
//   GROUP "实习":
//     7624086888207862069 = 前沿技术领域人才实习招聘 (~122 posts) ← elite frontier tech intern
//     7621018569480046853 = Seed大模型人才实习招聘 (~80 posts)    ← elite LLM intern
//     7194661644654577981 = 日常实习 (~2468 posts)
//     7194661126919358757 = ByteIntern (~3097 posts)
//   GROUP "正式" (en: "Soaring Star Talent Program"):
//     7624064258157889845 = 2027届前沿技术领域人才校招 (~127 posts) ← elite frontier tech
//     7621018151002507573 = 2027届Seed大模型人才校招 (~91 posts)    ← elite LLM new-grad
//     7525009396952582407 = 2026届校园招聘 (~1839 posts)
//
//   To query the 顶尖实习 (top/elite intern) track, use:
//     subject_id_list: ["7624086888207862069"]   ← 前沿技术领域人才实习招聘
//     subject_id_list: ["7621018569480046853"]   ← Seed大模型人才实习招聘
//   (These are ByteDance's equivalent of Tencent's 顶尖实习 — elite research intern programs)
//
// ============================================================
// Category count breakdown (probed 2026-05, no recruitment filter = all 7824):
//   研发/R&D:        ~4624   运营/Ops:   ~1482   产品/Product: ~1096
//   职能/Corp Func:   ~244   设计/Design: ~188   销售/Sales:     ~96
//   市场/Marketing:    ~60
//
// City count breakdown (no recruitment filter):
//   北京: ~3429   上海: ~2356   深圳: ~893   杭州: ~790   广州: ~111
//   成都: ~102    武汉:   ~13   南京:  ~10   新加坡: ~6   天津:   ~2
//
// ============================================================
// Endpoints that do NOT exist publicly (all return 404):
//   POST /api/v1/search/job/post_categories
//   POST /api/v1/search/job/recruitment_types
//   POST /api/v1/search/job/cities
//   POST /api/v1/dict/job_category
//   POST /api/v1/search/job/filters
//   (Any POST variant of the filters path)
//   The notices system has no public endpoints.
//
// ============================================================
// ---- PositionSummary field mapping (ByteDance → canonical) ----
//   post_id       ← item.id  (stringified)
//   title         ← item.title
//   project       ← item.job_category.name  (closest equiv to Tencent's projectName)
//   recruit_label ← item.recruit_type.name  (e.g. "日常实习" / "暑期实习" / "正式")
//   bgs           ← ""  (ByteDance does not expose BG/事业群 in public search)
//   work_cities   ← item.city_info.name + city_list joined with " / " for multi-city posts
//   apply_url     ← https://jobs.bytedance.com/campus/position/${id}/detail

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { extractResumeSignals, scoreOverlap, checkResume };

const API_ROOT = "https://jobs.bytedance.com/api/v1";
const CAMPUS_PAGE = "https://jobs.bytedance.com/campus/position";
const DETAIL_PAGE = (id: string) =>
  `https://jobs.bytedance.com/campus/position/${encodeURIComponent(id)}/detail`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "portal-channel": "campus",
  "portal-platform": "pc",
  "website-path": "campus",
  Referer: CAMPUS_PAGE,
};

// ---------- low-level call helper ----------

interface BdEnvelope<T> {
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

  let payload: BdEnvelope<T>;
  try {
    payload = (await response.json()) as BdEnvelope<T>;
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
}

interface RawJobCategory {
  id?: string;
  name?: string;
  en_name?: string;
}

interface RawRecruitType {
  id?: string;
  name?: string;
  en_name?: string;
}

interface RawJobSubject {
  id?: string;
  name?: { zh_cn?: string; en_us?: string; i18n?: string };
  limit_count?: number;
}

interface RawJobPost {
  id?: string | number;
  title?: string;
  sub_title?: string | null;
  description?: string;
  requirement?: string;
  job_category?: RawJobCategory;
  city_info?: RawCityInfo;
  city_list?: RawCityInfo[];
  recruit_type?: RawRecruitType;
  publish_time?: number;
  code?: string;
  job_subject?: RawJobSubject;
  job_post_info?: unknown;
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
  // Build work_cities: prefer city_list for multi-city; fall back to city_info
  const cityList = item.city_list ?? [];
  let work_cities: string;
  if (cityList.length > 1) {
    work_cities = cityList.map((c) => c.name ?? "").filter(Boolean).join(" / ");
  } else {
    work_cities = item.city_info?.name ?? (cityList[0]?.name ?? "");
  }
  return {
    post_id: id,
    title: item.title ?? "",
    project: item.job_category?.name ?? "",
    recruit_label: item.recruit_type?.name ?? "",
    bgs: "",
    work_cities,
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Filter by recruitment type. Default: ["201"] (正式/new-grad, matches site default tab).
   *  Use ["202"] for 实习 (intern, ~5767 posts).
   *  Pass [] or omit for all listings (~7824). */
  recruitmentIdList?: string[];
  /** Filter by job category IDs from /config/job/filters/campus → job_type_list.
   *  Parent IDs include all children. See header comment for full taxonomy.
   *  e.g. ["6704215862603155720"] = 研发/R&D only. */
  jobCategoryIdList?: string[];
  /** Filter by city location codes from /config/job/filters/campus → city_list.
   *  e.g. ["CT_11"] = 北京 only, ["CT_125","CT_128"] = 上海+深圳. */
  cityIdList?: string[];
  /** Filter by special program/subject IDs from /config/job/filters/campus → job_subject_list.
   *  Elite intern tracks (顶尖实习):
   *    "7624086888207862069" = 前沿技术领域人才实习招聘 (~122 posts)
   *    "7621018569480046853" = Seed大模型人才实习招聘 (~80 posts)
   *  Regular intern tracks:
   *    "7194661644654577981" = 日常实习 (~2468)
   *    "7194661126919358757" = ByteIntern (~3097)
   *  Elite new-grad tracks (Soaring Star Talent Program):
   *    "7624064258157889845" = 2027届前沿技术领域人才校招 (~127)
   *    "7621018151002507573" = 2027届Seed大模型人才校招 (~91)
   *    "7525009396952582407" = 2026届校园招聘 (~1839) */
  subjectIdList?: string[];
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * pageSize;
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  // Build optional filter arrays — undefined means "omit the key" (API returns
  // all for that dim). The ByteDance server is strict: it expects every entry
  // in *_id_list to be a string ("201", "CT_11", "7621018569480046853") and
  // 400s when a number sneaks through, which happens easily when the CLI flag
  // looks numeric. Stringify everything coming in.
  const asStringList = (v: unknown): string[] | undefined => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.map(String);
  };
  const recruitmentIdList = asStringList(opts.recruitmentIdList) ?? ["201"];

  const payload: Record<string, unknown> = {
    keyword,
    limit: pageSize,
    offset,
    portal_type: 3,
    portal_entrance: 1,
    language: "zh",
    // "201" = 正式 (campus / new-grad) — matches the default 校园招聘 tab on the website.
    // Without this filter the API returns ~7824 (campus + intern combined).
    recruitment_id_list: recruitmentIdList,
  };

  // Inject optional filters only when caller explicitly provides them
  const jobCategoryIdList = asStringList(opts.jobCategoryIdList);
  if (jobCategoryIdList?.length) {
    payload.job_category_id_list = jobCategoryIdList;
  }
  const cityIdList = asStringList(opts.cityIdList);
  if (cityIdList?.length) {
    payload.location_code_list = cityIdList;
  }
  const subjectIdList = asStringList(opts.subjectIdList);
  if (subjectIdList?.length) {
    payload.subject_id_list = subjectIdList;
  }

  const response = await call<RawSearchData>("/search/job/posts", payload);
  if (!response.ok || !response.data) {
    return {
      ok: false,
      message: response.message,
      source: "jobs.bytedance.com",
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.job_post_list ?? [];
  return {
    ok: true,
    source: "jobs.bytedance.com",
    query: payload,
    page,
    page_size: pageSize,
    total: response.data.count ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- RawFilterData ----------

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
  location_type?: number;
  py_name?: string;
  mdm_code?: string;
  node_status?: number;
}

interface RawFilterSubjectGroup {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
}

interface RawFilterSubject {
  id?: string;
  name?: { zh_cn?: string; en_us?: string | null; i18n?: string };
  limit_count?: number | null;
  active_status?: number;
  subject_group_info?: RawFilterSubjectGroup;
}

interface RawFilterData {
  job_type_list?: RawFilterJobType[];
  city_list?: RawFilterCity[];
  job_subject_list?: RawFilterSubject[];
  recruitment_type_list?: null;
  job_type_count_map?: null;
  city_count_map?: null;
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 5); // cap at 5 pages (500 posts)

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({
      ...opts,
      page,
      pageSize,
    });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        source: "jobs.bytedance.com",
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
    source: "jobs.bytedance.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
// ByteDance has no public per-post detail endpoint.
// We paginate the search at offset 0,100,200,... (up to 5 pages of 100)
// and filter by id to reconstruct a detail-like object.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "jobs.bytedance.com", message: "post_id is required" };

  const pageSize = 100;
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const offset = (page - 1) * pageSize;
    const payload = {
      keyword: "",
      limit: pageSize,
      offset,
      portal_type: 3,
      portal_entrance: 1,
      language: "zh",
      recruitment_id_list: ["201"],
    };
    const response = await call<RawSearchData>("/search/job/posts", payload);
    if (!response.ok || !response.data) break;

    const posts = response.data.job_post_list ?? [];
    const found = posts.find((p) => String(p.id) === id);
    if (found) {
      const summary = summarizePosition(found);
      return {
        ok: true,
        source: "jobs.bytedance.com",
        post_id: id,
        title: found.title ?? "",
        direction: found.sub_title ?? "",
        description: found.description ?? "",
        requirements: found.requirement ?? "",
        work_cities: found.city_list ?? (found.city_info ? [found.city_info] : []),
        recruit_cities: found.city_list ?? (found.city_info ? [found.city_info] : []),
        apply_url: summary.apply_url,
      };
    }
    // If this page returned fewer than pageSize, no more pages exist
    if (posts.length < pageSize) break;
  }

  return {
    ok: false,
    source: "jobs.bytedance.com",
    post_id: id,
    message: `post ${id} not found in public search results (searched up to ${maxPages * pageSize} posts)`,
  };
}

// ---------- fetchDictionaries ----------
// GET /api/v1/config/job/filters/campus returns the full filter taxonomy.
// The {id} path segment is ignored by the server — all values return the same data.
// We cache the result in-process so repeated calls (e.g. autocomplete + search) don't
// double-fetch.  Cache is valid for the lifetime of the Node process.

let _filterCache:
  | {
      ok: true;
      source: string;
      jobCategories: Array<{
        id: string;
        name: string;
        en_name: string;
        depth: number;
        parent_id: string | null;
        children: Array<{ id: string; name: string; en_name: string }>;
      }>;
      cities: Array<{ code: string; name: string; en_name: string }>;
      subjects: Array<{
        id: string;
        name: string;
        group: string;
        group_en: string;
      }>;
      recruitmentTypes: Array<{ id: string; name: string; note: string }>;
    }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_filterCache !== null) return _filterCache;

  const url = `${API_ROOT}/config/job/filters/campus`;
  let response: Response;
  try {
    response = await fetch(url, { headers: DEFAULT_HEADERS });
  } catch (err) {
    const r = {
      ok: false as const,
      source: "jobs.bytedance.com",
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
    _filterCache = r;
    return r;
  }

  if (!response.ok) {
    const r = {
      ok: false as const,
      source: "jobs.bytedance.com",
      message: `HTTP ${response.status}`,
    };
    _filterCache = r;
    return r;
  }

  let payload: { code?: number; data?: RawFilterData; message?: string };
  try {
    payload = await response.json();
  } catch (err) {
    const r = {
      ok: false as const,
      source: "jobs.bytedance.com",
      message: `bad JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
    _filterCache = r;
    return r;
  }

  if (payload.code !== 0 || !payload.data) {
    const r = {
      ok: false as const,
      source: "jobs.bytedance.com",
      message: payload.message ?? "upstream error",
    };
    _filterCache = r;
    return r;
  }

  const d = payload.data;

  // Normalise job_type_list (職位類別) into flat + hierarchical views
  const jobCategories = (d.job_type_list ?? []).map((cat) => ({
    id: cat.id ?? "",
    name: cat.name ?? "",
    en_name: cat.en_name ?? "",
    depth: cat.depth ?? 1,
    parent_id: cat.parent?.id ?? null,
    children: (cat.children ?? []).map((c) => ({
      id: c.id ?? "",
      name: c.name ?? "",
      en_name: c.en_name ?? "",
    })),
  }));

  // Normalise city_list
  const cities = (d.city_list ?? []).map((c) => ({
    code: c.code ?? "",
    name: c.name ?? "",
    en_name: c.en_name ?? "",
  }));

  // Normalise job_subject_list (项目 / special programs)
  const subjects = (d.job_subject_list ?? []).map((s) => ({
    id: s.id ?? "",
    name: s.name?.zh_cn ?? s.name?.i18n ?? "",
    group: s.subject_group_info?.name ?? "",
    group_en: s.subject_group_info?.en_name ?? s.subject_group_info?.i18n_name ?? "",
  }));

  // recruitment_type_list is null in the public response; expose as static known values
  const recruitmentTypes = [
    { id: "201", name: "正式", note: "campus / new-grad (~2057 posts)" },
    { id: "202", name: "实习", note: "intern (~5767 posts)" },
    { id: "301", name: "其他", note: "reserved, currently 0 active posts" },
  ];

  const result = {
    ok: true as const,
    source: "jobs.bytedance.com",
    jobCategories,
    cities,
    subjects,
    recruitmentTypes,
  };
  _filterCache = result;
  return result;
}

// ---------- stub notices ----------

const STUB_NOTICES = {
  ok: false as const,
  source: "jobs.bytedance.com",
  message: "ByteDance: no public notices endpoint",
};

export async function listNotices(): Promise<typeof STUB_NOTICES> {
  return STUB_NOTICES;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bytedance.com",
    message: "ByteDance: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bytedance.com",
    message: "ByteDance: no public notices endpoint",
  };
}

// ---------- matchResume ----------
// Mirror tencent's algorithm:
// 1. Extract signals from resume text.
// 2. Search with top-3 terms as keyword (description is already in search results).
// 3. Score each post against title + description + requirement + city + recruit_type blob.
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
      ok: false,
      source: "jobs.bytedance.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
  if (!list.ok) {
    return { ok: false, source: "jobs.bytedance.com", message: list.message, positions: [] };
  }

  // Re-fetch raw posts to access description + requirement fields
  const payload = {
    keyword,
    limit: 100,
    offset: 0,
    portal_type: 3,
    portal_entrance: 1,
    language: "zh",
    recruitment_id_list: ["201"],
  };
  const raw = await call<RawSearchData>("/search/job/posts", payload);
  const rawPosts: RawJobPost[] = raw.ok ? (raw.data?.job_post_list ?? []) : [];

  // Build a lookup from id → raw post for blob scoring
  const rawById = new Map<string, RawJobPost>();
  for (const p of rawPosts) {
    rawById.set(String(p.id ?? ""), p);
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
      p.work_cities,
      rp?.description ?? "",
      rp?.requirement ?? "",
    ].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({
        score,
        position: p,
        reasons,
        description: rp?.description,
        requirements: rp?.requirement,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    // Fall back: return first N positions with score 0
    shortlist = list.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
      description: rawById.get(position.post_id)?.description,
      requirements: rawById.get(position.post_id)?.requirement,
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
    source: "jobs.bytedance.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_bytedance } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_bytedance } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_bytedance } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "jobs.bytedance.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://jobs.bytedance.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "jobs.bytedance.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_bytedance({
      source: "jobs.bytedance.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://jobs.bytedance.com/api/v1/user/applications",
      submitKind: "feishu-3-step",
      endpointVerified: true,
      submitNotes:
        "ByteDance — POST /api/v1/user/applications. jobs.bytedance.com is an atsx-throne (Feishu) tenant, so it uses Feishu's 3-step apply flow: POST /api/v1/attachment/upload/tokens → PUT presigned URL → POST /api/v1/user/applications with { post_id, attachment_id, applicant_info }. Endpoint anon-probed → HTTP 405 (same route as Feishu adapters; verified in 1.0.62). CAPTCHA verification required for first-time applicants; session cookies via extension.",
    }),
  };
}
