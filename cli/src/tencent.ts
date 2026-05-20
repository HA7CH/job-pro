// Thin client for Tencent's public campus-recruiting API at join.qq.com.
//
// IMPORTANT: join.qq.com is a CAMPUS-ONLY portal (校园招聘). It exposes
// three recruit types — 应届生 (new graduates), 实习生 (interns), and 人才专项
// (talent programs such as 青云计划 and 技术研发提前批). There is NO social-hire /
// 社招 / experienced-hire endpoint on this domain; Tencent's social-hire jobs
// live at a separate site (careers.tencent.com).
//
// Filter taxonomy (all IDs are for the searchPosition POST body):
//
//   projectIdList  — leaf codes from getAllProject; controls recruit type
//     1   应届生
//     2   实习生
//     12  项目实习生
//     14  青云计划-应届生
//     16  技术研发提前批
//     20  青云计划-实习生
//
//   bgList  — BusinessGroup codes (data.count is accurate per BG)
//     953    CDG 企业发展事业群         ~100 positions
//     29294  CSIG 云与智慧产业事业群    ~206 positions
//     956    IEG 互动娱乐事业群         ~275 positions
//     29292  PCG 平台与内容事业群        ~89 positions
//     14129  WXG 微信事业群             ~152 positions
//     958    TEG 技术工程事业群          ~198 positions
//     78     S1 职能系统-职能线           ~36 positions
//     2233   S2 职能系统-财经线            ~6 positions
//     2234   S3 职能系统-HR与管理线       ~12 positions
//     955    其他                           ~0 positions
//
//   positionFidList  — sub-family "id" values from getPositionFamily
//     fid 2 技术: 75:软件开发类, 76:技术运营类, 77:安全技术类, 84:测试与质量管理类,
//              93:算法研究类, 231:解决方案与服务类, 250:硬件开发类
//     fid 3 产品: 79:产品经理培训生, 80:游戏产品类, 83:内容制作类, 94:通用产品类,
//              219:金融产品类, 253:项目管理类
//     fid 4 设计: 85:游戏美术类, 89:平面交互类
//     fid 5 市场: 78:战略投资类, 82:市场营销类, 96:公共关系类, 192:销售拓展类
//     fid 6 职能: 326:财经分析类, 327:人力资源类, 328:法律与公共策略类, 329:行政支持类
//
//   workCountryType  — 0=不限 (695), 1=国内 (593), 2=海外 (102)
//
//   workCityList  — city codes from getPositionWorkCities (key "1" = 国内, key "2" = 海外)
//     国内: 1:深圳 (~419), 2:北京 (~252), 3:上海 (~185), 5:广州 (~66),
//           6:武汉, 7:杭州, 8:成都, 11:南京, 14:重庆, 17:贵阳, 18:长沙,
//           29:厦门, 30:合肥, 31:天津, 37:中国香港, 190:芜湖, 276:韶关
//     海外: 138:贝尔维尤, 401:帕罗奥多, 407:洛杉矶, 501:阿姆斯特丹,
//           601:法兰克福, 701:首尔, 801:东京, 1001:曼谷, 1301:新加坡,
//           1401:伦敦, 1601:雅加达, 2301:巴黎, 3003:奥克兰
//
//   recruitCityList  — codes from getRecruitCity (interview city, not work city)
//     1:成都, 3:广州, 5:上海, 11:北京, 13:中国香港, 14:深圳, 27:武汉, 47:远程面试
//
// NOTE: data.count is unreliable when projectIdList is the ONLY filter
// (always returns 695). It IS accurate when bgList or positionFidList are set.
//
// All endpoints are unauthenticated; the server just checks Referer/Origin
// to discourage cross-site embedding. Endpoint inventory:
//
//   GET  /api/v1/position/getAllProject
//   GET  /api/v1/position/getPositionFamily?lang=zh-cn
//   GET  /api/v1/position/getPositionWorkCities?lang=zh-cn
//   GET  /api/v1/position/getRecruitCity?lang=zh-cn
//   GET  /api/v1/dictionary/?types=RecruitType,BusinessGroup,RecruitProjectPostList
//   POST /api/v1/position/searchPosition
//   GET  /api/v1/jobDetails/getJobDetailsByPostId?postId=<id>
//   GET  /api/v1/noticeDynamic/getNoticeDynamicList
//   GET  /api/v1/noticeDynamic/getNoticeDynamicById?id=<id>

const API_ROOT = "https://join.qq.com/api/v1";
const POSTS_PAGE = "https://join.qq.com/post.html";
const NOTICE_PAGE = "https://join.qq.com/notice.html";
const DETAIL_PAGE = (postId: string) =>
  `https://join.qq.com/post_detail.html?postid=${encodeURIComponent(postId)}`;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: "https://join.qq.com",
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
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_ROOT}${path}${sep}timestamp=${Date.now()}`;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    Referer: opts.referer ?? POSTS_PAGE,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json;charset=UTF-8";
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

  return {
    ok: payload.status === 0,
    data: payload.data,
    message: payload.message || (payload.status === 0 ? "ok" : "upstream error"),
  };
}

// ---------- dictionaries ----------

/** Retrieve the full filter catalog for join.qq.com, including live position
 *  counts per BusinessGroup and per PositionFamily sub-category.
 *
 *  Counts are fetched in parallel (one POST per BG / family sub-id).
 *  The projectIdList used for count probes is the full set [1,2,12,14,16,20]
 *  so counts reflect the whole campus pool.
 *
 *  Note: counts under recruit_types are NOT probed here because
 *  data.count is unreliable when projectIdList is the sole filter
 *  (always returns 695 regardless of which projects are listed).
 */
import type { PositionScope } from "./adapter.js";

// join.qq.com is campus-only (see file header). Social-hire lives at
// careers.tencent.com which we don't scrape; declare campus/intern/all so
// dispatcher fails fast on `--scope social`.
export const supportedScopes: ReadonlyArray<PositionScope> = ["campus", "intern", "all"] as const;

export async function fetchDictionaries() {
  const [projects, families, workCities, recruitCities, shared] = await Promise.all([
    call<unknown[]>("GET", "/position/getAllProject"),
    call<unknown>("GET", "/position/getPositionFamily?lang=zh-cn"),
    call<unknown>("GET", "/position/getPositionWorkCities?lang=zh-cn"),
    call<unknown[]>("GET", "/position/getRecruitCity?lang=zh-cn"),
    call<unknown>(
      "GET",
      "/dictionary/?types=RecruitType,BusinessGroup,RecruitProjectPostList"
    ),
  ]);

  const allProjectIds = [1, 2, 12, 14, 16, 20];

  // Helper: call searchPosition with a single extra filter, return count.
  async function countWith(extra: Record<string, unknown>): Promise<number> {
    const body = {
      projectIdList: allProjectIds,
      keyword: "",
      bgList: [],
      workCountryType: 0,
      workCityList: [],
      recruitCityList: [],
      positionFidList: [],
      pageIndex: 1,
      pageSize: 1,
      ...extra,
    };
    const r = await call<{ count?: number }>("POST", "/position/searchPosition", { body });
    return r.data?.count ?? 0;
  }

  // BG codes from shared.BusinessGroup
  const bgEntries = ((shared.data as { BusinessGroup?: Array<{ name: string; code: string }> })
    ?.BusinessGroup ?? []).filter((e) => e.code && e.code !== "955");

  // positionFidList sub-ids from families data
  type FamilyEntry = { id: number; fid: number; title: string };
  const familySubIds: FamilyEntry[] = [];
  const familyData = families.data as Record<string, FamilyEntry[]> | undefined;
  if (familyData) {
    for (const entries of Object.values(familyData)) {
      for (const e of entries) {
        if (e.id) familySubIds.push(e);
      }
    }
  }

  // Fire all count probes in parallel
  const [bgCounts, familyCounts] = await Promise.all([
    Promise.all(bgEntries.map((bg) => countWith({ bgList: [Number(bg.code)] }))),
    Promise.all(familySubIds.map((f) => countWith({ positionFidList: [f.id] }))),
  ]);

  const bg_counts: Record<string, { name: string; code: number; count: number }> = {};
  for (let i = 0; i < bgEntries.length; i++) {
    const bg = bgEntries[i];
    bg_counts[bg.code] = { name: bg.name, code: Number(bg.code), count: bgCounts[i] };
  }

  const family_counts: Record<string, { id: number; fid: number; title: string; count: number }> = {};
  for (let i = 0; i < familySubIds.length; i++) {
    const f = familySubIds[i];
    family_counts[f.id] = { ...f, count: familyCounts[i] };
  }

  return {
    ok: [projects, families, workCities, recruitCities, shared].every((r) => r.ok),
    source: "join.qq.com",
    api_host: API_ROOT,
    verified_at: new Date().toISOString(),
    campus_only: true,
    recruit_types: (shared.data as { RecruitType?: unknown[] })?.RecruitType ?? [],
    recruit_project_post_list:
      (shared.data as { RecruitProjectPostList?: unknown[] })?.RecruitProjectPostList ?? [],
    business_groups:
      (shared.data as { BusinessGroup?: unknown[] })?.BusinessGroup ?? [],
    bg_counts,
    position_families: families.data,
    family_counts,
    work_cities: workCities.data,
    recruit_cities: recruitCities.data,
    projects: projects.data,
    shared: shared.data,
  };
}

interface ProjectNode {
  code?: number | string;
  subDictionary?: ProjectNode[];
}

export async function collectAllProjectIds(): Promise<number[]> {
  const response = await call<ProjectNode[]>("GET", "/position/getAllProject");
  if (!response.ok || !response.data) return [];
  const leaves: number[] = [];
  const walk = (nodes: ProjectNode[]) => {
    for (const node of nodes) {
      const kids = node.subDictionary ?? [];
      if (kids.length) {
        walk(kids);
      } else if (node.code !== undefined) {
        const id = Number(node.code);
        if (!Number.isNaN(id)) leaves.push(id);
      }
    }
  };
  walk(response.data);
  return [...new Set(leaves)].sort((a, b) => a - b);
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

interface RawPositionListEntry {
  postId?: string | number;
  positionTitle?: string;
  projectName?: string;
  recruitLabelName?: string;
  bgs?: string;
  workCities?: string;
}

function summarizePosition(item: RawPositionListEntry): PositionSummary {
  const postId = String(item.postId ?? "");
  return {
    post_id: postId,
    title: item.positionTitle ?? "",
    project: item.projectName ?? "",
    recruit_label: item.recruitLabelName ?? "",
    bgs: (item.bgs ?? "").trim(),
    work_cities: (item.workCities ?? "").trim(),
    apply_url: postId ? DETAIL_PAGE(postId) : POSTS_PAGE,
  };
}

export interface SearchOptions {
  keyword?: string;
  projectIds?: number[];
  /** BG (事业群) codes, e.g. 953=CDG, 29294=CSIG, 956=IEG, 29292=PCG, 14129=WXG, 958=TEG */
  bgIds?: number[];
  /** Sub-family ids from getPositionFamily, e.g. 75=软件开发类, 93=算法研究类, 85=游戏美术类 */
  positionFamilyIds?: number[];
  /** Work-city codes from getPositionWorkCities, e.g. 1=深圳, 2=北京, 3=上海 */
  workCityIds?: number[];
  /** Recruit-city codes from getRecruitCity (interview city), e.g. 14=深圳, 11=北京 */
  recruitCityIds?: number[];
  /** 0=不限 (default), 1=国内, 2=海外 */
  workCountryType?: 0 | 1 | 2;
  page?: number;
  pageSize?: number;
}

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const projectIds = opts.projectIds ?? (await collectAllProjectIds());
  const body = {
    projectIdList: projectIds,
    keyword: (opts.keyword ?? "").trim().slice(0, 30),
    bgList: opts.bgIds ?? [],
    workCountryType: opts.workCountryType ?? 0,
    workCityList: opts.workCityIds ?? [],
    recruitCityList: opts.recruitCityIds ?? [],
    positionFidList: opts.positionFamilyIds ?? [],
    pageIndex: page,
    pageSize,
  };

  const response = await call<{ positionList?: RawPositionListEntry[]; count?: number }>(
    "POST",
    "/position/searchPosition",
    { body }
  );
  if (!response.ok || !response.data) {
    return {
      ok: false,
      message: response.message,
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = response.data.positionList ?? [];
  return {
    ok: true,
    source: "join.qq.com",
    query: body,
    page,
    page_size: pageSize,
    total: response.data.count ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 20);
  const projectIds = await collectAllProjectIds();

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({
      keyword: opts.keyword,
      projectIds,
      page,
      pageSize,
    });
    if (!result.ok) {
      return { ok: false, message: result.message, fetched: bucket.length, positions: bucket };
    }
    if (total === undefined) total = result.total;
    if (!result.positions.length) break;
    bucket.push(...result.positions);
    if (total !== undefined && bucket.length >= total) break;
  }
  return {
    ok: true,
    source: "join.qq.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

interface RawJobDetail {
  postId?: string | number;
  title?: string;
  tidName?: string;
  projectName?: string;
  recruitLabelName?: string;
  desc?: string;
  topicDetail?: string;
  introduction?: string;
  request?: string;
  topicRequirement?: string;
  workCityList?: unknown[];
  recruitCityList?: unknown[];
  isQingyun?: boolean;
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, message: "post_id is required" as const };
  const response = await call<RawJobDetail>(
    "GET",
    `/jobDetails/getJobDetailsByPostId?postId=${encodeURIComponent(id)}`,
    { referer: DETAIL_PAGE(id) }
  );
  if (!response.ok || !response.data) {
    return { ok: false, message: response.message || "no detail returned", post_id: id };
  }
  const raw = response.data;
  const first = (...keys: (keyof RawJobDetail)[]) => {
    for (const key of keys) {
      const v = raw[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  return {
    ok: true,
    source: "join.qq.com",
    post_id: String(raw.postId ?? id),
    title: raw.title ?? "",
    direction: raw.tidName ?? "",
    project: raw.projectName ?? "",
    recruit_label: raw.recruitLabelName ?? "",
    description: first("desc", "topicDetail", "introduction"),
    requirements: first("request", "topicRequirement"),
    work_cities: raw.workCityList ?? [],
    recruit_cities: raw.recruitCityList ?? [],
    is_qingyun: Boolean(raw.isQingyun),
    apply_url: DETAIL_PAGE(String(raw.postId ?? id)),
  };
}

// ---------- announcements ----------

interface RawNotice {
  id?: number;
  title?: string;
  noticeTag?: string;
  // upstream field is misspelled — `publisheTime` (extra e). Surface a
  // clean `publish_time` so callers never see the typo.
  publisheTime?: string;
  publisheTimeTxt?: string;
  cont?: string;
}

export async function listNotices() {
  const response = await call<{ list?: RawNotice[] }>(
    "GET",
    "/noticeDynamic/getNoticeDynamicList",
    { referer: NOTICE_PAGE }
  );
  if (!response.ok) return { ok: false, message: response.message, notices: [] };
  const items = response.data?.list ?? [];
  return {
    ok: true,
    source: "join.qq.com",
    count: items.length,
    notices: items.map((n) => ({
      id: n.id,
      title: n.title ?? "",
      publish_time: n.publisheTimeTxt || n.publisheTime || "",
      tag: n.noticeTag ?? "",
      detail_url: `https://join.qq.com/detail.html?id=${n.id}`,
    })),
  };
}

export async function getNotice(noticeId: string) {
  const id = String(noticeId ?? "").trim();
  if (!id) return { ok: false, message: "notice_id is required" as const };
  const response = await call<RawNotice>(
    "GET",
    `/noticeDynamic/getNoticeDynamicById?id=${encodeURIComponent(id)}`,
    { referer: NOTICE_PAGE }
  );
  if (!response.ok || !response.data) {
    return { ok: false, message: response.message || "no notice returned" };
  }
  const raw = response.data;
  return {
    ok: true,
    source: "join.qq.com",
    id: raw.id ?? Number(id),
    title: raw.title ?? "",
    publish_time: raw.publisheTimeTxt || raw.publisheTime || "",
    tag: raw.noticeTag ?? "",
    content_html: raw.cont ?? "",
    detail_url: `https://join.qq.com/detail.html?id=${raw.id ?? id}`,
  };
}

// ---------- flow (question-aware notice retrieval) ----------

function tokenizeQuestion(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const trimmed = (text ?? "").trim();
  if (!trimmed) return out;

  for (const m of trimmed.match(/[A-Za-z0-9]{2,}/g) ?? []) {
    const k = m.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  for (const run of trimmed.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!seen.has(bigram)) {
        seen.add(bigram);
        out.push(bigram);
      }
      if (out.length >= 40) return out;
    }
  }
  return out;
}

function parseQuestionTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const candidates = [v, v.replace(" ", "T"), `${v}T00:00:00`];
  for (const candidate of candidates) {
    const ts = Date.parse(candidate);
    if (!Number.isNaN(ts)) return ts;
  }
  return undefined;
}

export async function findNoticesByQuestion(
  question: string,
  opts: { questionTime?: string; topK?: number } = {}
) {
  const listing = await listNotices();
  if (!listing.ok) return { ok: false, message: listing.message, matches: [] };

  const cutoff = parseQuestionTime(opts.questionTime);
  const tokens = tokenizeQuestion(question);
  const topK = Math.max(1, opts.topK ?? 3);

  type Scored = { score: number; notice: (typeof listing.notices)[number] };
  const scored: Scored[] = [];
  for (const notice of listing.notices) {
    const haystack = `${notice.title} ${notice.tag}`.toLowerCase();
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    if (!hits) continue;
    let score = hits * 10;
    const publishedAt = parseQuestionTime(notice.publish_time);
    if (cutoff !== undefined && publishedAt !== undefined) {
      if (publishedAt <= cutoff) {
        const monthsBefore = (cutoff - publishedAt) / (86_400_000 * 30);
        score += Math.max(0, 5 - monthsBefore);
      } else {
        score -= 1;
      }
    }
    scored.push({ score, notice });
  }
  scored.sort((a, b) => b.score - a.score);

  const stripHtml = (html: string) =>
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);

  const matches = [];
  for (const { notice } of scored.slice(0, topK)) {
    const full = await getNotice(String(notice.id));
    const excerpt = full.ok ? stripHtml(full.content_html ?? "") : "";
    matches.push({ ...notice, excerpt });
  }

  return {
    ok: true,
    source: "join.qq.com",
    question,
    question_time: opts.questionTime,
    matched_tokens: tokens,
    matches,
  };
}

// ---------- resume matching ----------

const TECH_VOCAB = new Set([
  // languages
  "python", "java", "go", "golang", "c", "c++", "cpp", "rust", "kotlin",
  "swift", "scala", "javascript", "typescript", "php", "ruby", "lua",
  // web / mobile
  "react", "vue", "angular", "next", "nuxt", "webpack", "vite", "tailwind",
  "flutter", "android", "ios", "react-native",
  // backend
  "spring", "springboot", "django", "flask", "fastapi", "express", "nestjs",
  "grpc", "rest", "graphql", "websocket",
  // data / db
  "mysql", "postgresql", "postgres", "redis", "mongodb", "kafka",
  "rabbitmq", "elasticsearch", "spark", "hadoop", "flink", "clickhouse",
  "hive", "presto",
  // infra
  "docker", "kubernetes", "k8s", "linux", "aws", "gcp", "azure",
  "terraform", "nginx", "envoy",
  // ml / ai
  "pytorch", "tensorflow", "huggingface", "llm", "rag", "transformer",
  "bert", "gpt", "diffusion", "cv", "nlp", "embedding",
  // chinese stack terms
  "后台", "后端", "前端", "服务端", "客户端", "测试", "运维", "安全", "算法",
  "推荐", "搜索", "大模型", "微服务", "分布式", "高并发", "数据库", "数据",
  "机器学习", "深度学习", "强化学习", "多模态", "计算机视觉", "自然语言",
]);

const CITY_VOCAB = new Set([
  "深圳", "北京", "上海", "广州", "杭州", "成都", "武汉", "南京", "苏州",
  "西安", "合肥", "天津", "厦门", "香港", "remote", "远程",
]);

// Match a vocab term against haystack with word-style boundaries for Latin
// terms (e.g. "rust" must not fire on "Trustworthy", "lua" must not fire on
// "evaluation"). CJK terms keep substring matching since Chinese has no
// inter-character boundary concept and false-positive risk is much lower.
function termMatches(haystack: string, term: string): boolean {
  // Any CJK character → substring (Chinese vocab like "大模型", "多模态")
  if (/[一-鿿]/.test(term)) return haystack.includes(term);
  // Latin / digits / punctuation → enforce word boundary on both sides.
  // Allows "c++" to match "C++ developer" but not "TypeScript", and "rust"
  // to NOT match "Trustworthy" / "Robustness".
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").test(haystack);
}

export function extractResumeSignals(text: string): { terms: string[]; cities: string[] } {
  const lower = (text ?? "").toLowerCase();
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of TECH_VOCAB) {
    if (termMatches(lower, term) && !seen.has(term)) {
      terms.push(term);
      seen.add(term);
    }
  }
  // Latin tokens not already captured by the vocab
  for (const tok of text.match(/[A-Za-z][A-Za-z0-9+#.\-]{1,15}/g) ?? []) {
    const norm = tok.toLowerCase();
    if (seen.has(norm) || terms.length >= 30) continue;
    if (norm.length < 3) continue;
    const stop = new Set(["the", "and", "for", "with", "via", "from", "able", "this", "that", "have"]);
    if (stop.has(norm)) continue;
    terms.push(tok);
    seen.add(norm);
  }
  const cities: string[] = [];
  for (const c of CITY_VOCAB) {
    if (text.includes(c)) cities.push(c);
    if (cities.length >= 6) break;
  }
  return { terms: terms.slice(0, 30), cities };
}

export function scoreOverlap(haystack: string, terms: string[], cities: string[]) {
  const hay = haystack.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  for (const t of terms) {
    if (!t) continue;
    if (termMatches(hay, t.toLowerCase())) {
      score += t.length > 2 ? 3 : 1;
      if (reasons.length < 4) reasons.push(`matched: ${t}`);
    }
  }
  for (const c of cities) {
    if (haystack.includes(c)) {
      score += 2;
      if (reasons.length < 4) reasons.push(`city: ${c}`);
    }
  }
  return { score, reasons };
}

// Terms too common to be useful as search queries — appear on most engineering
// resumes and would just dilute fan-out with off-topic candidates. We keep
// them for scoring (so a "Python" hit in a JD still counts), but skip them
// when picking which keywords to fire as API queries.
const GENERIC_SEARCH_TERMS = new Set([
  "python", "java", "c", "c++", "cpp", "javascript", "typescript", "go", "golang",
  "docker", "kubernetes", "k8s", "linux", "aws", "gcp", "azure", "nginx",
  "mysql", "postgresql", "postgres", "redis", "mongodb",
  "ai", "ml", "cv", "nlp", "算法",
]);

export function pickDistinctiveTerms(terms: string[], max: number): string[] {
  const picked: string[] = [];
  for (const t of terms) {
    if (picked.length >= max) break;
    if (GENERIC_SEARCH_TERMS.has(t.toLowerCase())) continue;
    picked.push(t);
  }
  return picked;
}

// ---------- degree requirement detection ----------

export type DegreeLevel = "bachelor" | "master" | "phd";
const DEGREE_RANK: Record<DegreeLevel, number> = { bachelor: 1, master: 2, phd: 3 };

/**
 * Parse a JD's requirements text (Chinese campus recruiting) and infer the
 * MINIMUM degree the role accepts. Returns null when nothing degree-related
 * is detected (in which case we don't filter — assume bachelor+).
 *
 * Ordering matters: we check the most-permissive patterns first so
 * "本科及以上" beats a stray "硕士" mention elsewhere in the requirements.
 */
export function extractJobDegreeRequirement(text: string): DegreeLevel | null {
  if (!text) return null;
  const t = text;
  // Most permissive — bachelor explicitly accepted
  if (/本科及以上|学士及以上|本科\s*同学|应届本科/.test(t)) return "bachelor";
  // Master or PhD (the "硕士 OR 博士" pattern)
  if (
    /硕士及以上|硕士\s*\/\s*博士|硕士\s*[、,，]\s*博士|硕士\s*或\s*博士|硕士\s*和\s*博士|优秀硕士|硕士\s*同学|应届硕士/.test(
      t
    )
  )
    return "master";
  // PhD only / explicitly required
  if (/博士及以上|博士在读|博士应届|博士\s*同学|博士学位|PhD/i.test(t)) return "phd";
  // Bare mentions — least confident, ordered by exclusivity
  if (/博士/.test(t)) return "phd";
  if (/硕士/.test(t)) return "master";
  if (/本科/.test(t)) return "bachelor";
  return null;
}

/**
 * Returns true when a candidate's highest degree satisfies a job's minimum
 * requirement. Both args optional — null/undefined on either side defaults
 * to "don't filter" (true), since we'd rather show a possibly-irrelevant
 * job than silently hide a relevant one over guessed metadata.
 */
export function userMeetsDegreeRequirement(
  userDegree: DegreeLevel | undefined,
  jobRequires: DegreeLevel | null
): boolean {
  if (!jobRequires) return true;
  if (!userDegree) return true;
  return DEGREE_RANK[userDegree] >= DEGREE_RANK[jobRequires];
}

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number; userDegree?: DegreeLevel } = {}
) {
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 20);
  const userDegree = opts.userDegree;
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false,
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  // Multi-query fan-out: prior versions ANDed the top-3 terms into a single
  // keyword (e.g. "python rust lua") which gave 0–2 hits because few jobs
  // mention all three. Now we fire one search per distinctive term in
  // parallel and dedupe the union by post_id.
  const queries = pickDistinctiveTerms(terms, 5);
  if (queries.length === 0) queries.push(...terms.slice(0, 3));

  const lists = await Promise.all(
    queries.map((q) => searchPositions({ keyword: q, page: 1, pageSize: 100 }))
  );
  const seen = new Set<string>();
  const merged: PositionSummary[] = [];
  let lastErr: string | undefined;
  for (const l of lists) {
    if (!l.ok) {
      lastErr = l.message;
      continue;
    }
    for (const p of l.positions) {
      if (seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      merged.push(p);
    }
  }
  if (merged.length === 0) {
    return { ok: false, message: lastErr ?? "no positions returned across any query", positions: [] };
  }

  type Pre = { score: number; position: PositionSummary; reasons: string[] };
  const pre: Pre[] = [];
  for (const p of merged) {
    const blob = [p.title, p.project, p.recruit_label, p.bgs, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) pre.push({ score, position: p, reasons });
  }
  pre.sort((a, b) => b.score - a.score);

  let shortlist = pre.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = merged.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  type Enriched = {
    score: number;
    meets: boolean;
    row: PositionSummary & {
      title_detail?: string;
      direction?: string;
      description?: string;
      requirements?: string;
      match_reasons: string[];
      degree_required: DegreeLevel | null;
      meets_degree_requirement: boolean;
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
    if (!combined.length) combined.push("no specific keyword overlap — surfaced from initial keyword search");
    const degree_required = extractJobDegreeRequirement(detail.requirements ?? "");
    const meets = userMeetsDegreeRequirement(userDegree, degree_required);
    enriched.push({
      score: baseScore + extraScore,
      meets,
      row: {
        ...position,
        title_detail: detail.title,
        direction: detail.direction,
        description: detail.description,
        requirements: detail.requirements,
        match_reasons: combined,
        degree_required,
        meets_degree_requirement: meets,
      },
    });
  }
  // Sort: qualifying matches first (high→low score), then unqualifying
  // (high→low score). Doesn't drop anything when userDegree is set — we
  // want the user to see what's out there, just clearly flagged.
  enriched.sort((a, b) => {
    if (a.meets !== b.meets) return a.meets ? -1 : 1;
    return b.score - a.score;
  });

  const top = enriched.slice(0, topN);
  const filteredOut = top.filter((e) => !e.meets).length;

  return {
    ok: true,
    source: "join.qq.com",
    extracted_terms: terms,
    city_preferences: cities,
    user_degree: userDegree ?? null,
    matches: top.map((e) => e.row),
    degree_filter_note: userDegree
      ? `sorted by qualifying-first (your degree: ${userDegree}); ${filteredOut} of top ${top.length} require a higher degree`
      : undefined,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}

// ---------- resume self-check ----------

const PUFFERY = [
  "精通", "唯一", "完美", "顶尖", "领先", "100%",
  "expert", "perfect", "world-class", "best in class",
];

interface Check {
  name: string;
  status: "pass" | "warn" | "fail";
  hint: string;
}

export function checkResume(text: string) {
  if (!text || !text.trim()) {
    return { ok: false, message: "empty resume text", checks: [] as Check[] };
  }
  const checks: Check[] = [];

  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text);
  const phone = /(?:\+?86[-\s]?)?1[3-9]\d{9}/.test(text);
  if (email || phone) {
    const seen = [email && "email", phone && "phone"].filter(Boolean).join(", ");
    checks.push({ name: "contact-info", status: "pass", hint: `found: ${seen}` });
  } else {
    checks.push({
      name: "contact-info",
      status: "fail",
      hint: "no email or 中国大陆 mobile number found — recruiters can't reach you",
    });
  }

  // gradYear: three accept patterns — strict month suffix, "graduated/毕业"
  // proximity, or a school/degree token within ~80 chars of a 20xx year (so
  // a one-liner like "BS Tsinghua 2026" still counts as an education entry).
  const gradYear =
    /\b20\d{2}\s*(?:年|届|6|7|9|June|July)/i.test(text) ||
    /(?:graduat\w*|毕业|grad)[^]{0,30}\b20\d{2}\b/i.test(text) ||
    /(?:Bachelor|BSc?|BA|Master|MSc?|MA|PhD|本科|硕士|博士|学士|大学|学院|University|College|Tsinghua|Peking|Fudan|Zhejiang|Jiao\s*Tong|USTC|SJTU|PKU|HKU)[^]{0,80}\b20\d{2}\b/i.test(text);
  const school = /(大学|学院|University|College|Tsinghua|Peking|Fudan|Zhejiang|Jiao\s*Tong|USTC|SJTU|PKU|HKU)/i.test(text);
  const major = /(专业|major|本科|硕士|博士|学士|bachelor|master|phd|\bBSc?\b|\bMSc?\b|\bBA\b|\bMA\b|\bMBA\b|\bMEng\b|\bMPhil\b)/i.test(text);
  const eduOk = Number(school) + Number(major) + Number(gradYear);
  if (eduOk === 3) {
    checks.push({
      name: "education",
      status: "pass",
      hint: "school, major, graduation year all present",
    });
  } else if (eduOk >= 1) {
    const missing = [
      !school && "school",
      !major && "major",
      !gradYear && "graduation year",
    ].filter(Boolean).join(", ");
    checks.push({ name: "education", status: "warn", hint: `missing: ${missing}` });
  } else {
    checks.push({
      name: "education",
      status: "fail",
      hint: "no school / major / graduation year detectable",
    });
  }

  const exp = /(项目|项目经历|实习|实习经历|工作经历|project|internship|experience)/i.test(text);
  if (exp) {
    checks.push({
      name: "experience",
      status: "pass",
      hint: "at least one project or internship section found",
    });
  } else {
    checks.push({
      name: "experience",
      status: "fail",
      hint: "no project / internship / experience header — even fresh grads need something here",
    });
  }

  const quant = (text.match(/\d+(?:\.\d+)?\s*(?:%|倍|w|万|k|qps|ms|百万|million|users)/gi) ?? [])
    .length;
  if (quant >= 2) {
    checks.push({
      name: "quantitative-evidence",
      status: "pass",
      hint: `${quant} measurable outcomes found`,
    });
  } else if (quant === 1) {
    checks.push({
      name: "quantitative-evidence",
      status: "warn",
      hint: "only one quantified result — recruiters want numbers (latency, QPS, users, savings)",
    });
  } else {
    checks.push({
      name: "quantitative-evidence",
      status: "fail",
      hint: "no numeric outcomes — every bullet should answer 'how much / how many / how fast'",
    });
  }

  const flagged = PUFFERY.filter((w) => text.includes(w));
  if (flagged.length) {
    checks.push({
      name: "puffery",
      status: "warn",
      hint: `vague superlatives detected: ${flagged.slice(0, 5).join(", ")} — replace with concrete evidence or remove`,
    });
  } else {
    checks.push({ name: "puffery", status: "pass", hint: "no obvious superlative claims" });
  }

  const order = { fail: 0, warn: 1, pass: 2 } as const;
  checks.sort((a, b) => order[a.status] - order[b.status]);

  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) summary[c.status]++;

  return {
    ok: true,
    summary,
    checks,
    note: "Heuristics only — they don't judge content quality, just whether the skeleton is intact.",
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_tencent } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_tencent } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_tencent } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "join.qq.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://join.qq.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "join.qq.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_tencent({
      source: "join.qq.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://join.qq.com/api/v1/resume/bindResume",
      submitKind: "multipart-session",
      endpointVerified: true,
      submitNotes:
        "Tencent join.qq.com — POST /api/v1/resume/bindResume with session cookie + CSRF. Endpoint extracted from join.qq.com's p_zh-cn_post_detail.build.js bundle (sibling action endpoints /openResume, /saveResumeInfo, /uploadFile all probed → 200 + {message:\"未登录或登录已过期\",status:401}). bindResume is the route that binds a saved resume to a specific post = the apply action. Body shape still needs validation against a real candidate session.",
    }),
  };
}
