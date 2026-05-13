// Thin client for Tencent's public campus-recruiting API at join.qq.com.
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

export async function fetchDictionaries() {
  const [projects, families, workCities, recruitCities, shared] = await Promise.all([
    call<unknown[]>("GET", "/position/getAllProject"),
    call<unknown[]>("GET", "/position/getPositionFamily?lang=zh-cn"),
    call<unknown[]>("GET", "/position/getPositionWorkCities?lang=zh-cn"),
    call<unknown[]>("GET", "/position/getRecruitCity?lang=zh-cn"),
    call<unknown>(
      "GET",
      "/dictionary/?types=RecruitType,BusinessGroup,RecruitProjectPostList"
    ),
  ]);
  return {
    ok: [projects, families, workCities, recruitCities, shared].every((r) => r.ok),
    source: "join.qq.com",
    projects: projects.data,
    position_families: families.data,
    work_cities: workCities.data,
    recruit_cities: recruitCities.data,
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
    bgList: [],
    workCountryType: 0,
    workCityList: [],
    recruitCityList: [],
    positionFidList: [],
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

export function extractResumeSignals(text: string): { terms: string[]; cities: string[] } {
  const lower = (text ?? "").toLowerCase();
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of TECH_VOCAB) {
    if (lower.includes(term) && !seen.has(term)) {
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
    if (hay.includes(t.toLowerCase())) {
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
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
  if (!list.ok) return { ok: false, message: list.message, positions: [] };

  type Pre = { score: number; position: PositionSummary; reasons: string[] };
  const pre: Pre[] = [];
  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.bgs, p.work_cities].join(" ");
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

  type Enriched = { score: number; row: PositionSummary & {
    title_detail?: string;
    direction?: string;
    description?: string;
    requirements?: string;
    match_reasons: string[];
  }};
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
    ok: true,
    source: "join.qq.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches: enriched.slice(0, topN).map((e) => e.row),
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

  const gradYear = /(20\d{2})\s*(?:年|\/|-)?\s*(?:6|7|9|June|July)/.test(text);
  const school = /(大学|学院|University|College)/.test(text);
  const major = /(专业|major|本科|硕士|博士|学士|bachelor|master|phd)/i.test(text);
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
