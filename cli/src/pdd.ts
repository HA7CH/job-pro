// Thin client for 拼多多 (PDD / Pinduoduo) campus-recruiting portal at careers.pinduoduo.com.
//
// ============================================================
// API discovery (re-probed 2026-05; bundles under pfile.pddpic.com/ei-pub):
//
// The frontend is a Next.js SPA hosted at careers.pinduoduo.com/campus/.
// All XHR calls go through a sourceSDK.wrappedRequest helper (module 96211)
// that prepends the prefix Fh = "api/careers/" to every relative URL, giving:
//
//   https://careers.pinduoduo.com/api/careers/<relative-url>
//
// ---- PUBLIC endpoints (no auth required, verified 2026-05) ----
//
// POST /api/careers/api/recruit/position/list
//      Body: { pageSize:<int>, page:<int> }   (keyword/recruitType IGNORED server-side)
//      Response: { success:true, result:{ list:[Position], total:"<int>" } }
//      Position: { id (uuid), name, code, workLocation, workLocationName,
//                  job (eng key), jobName (zh), releaseTime (ms),
//                  jobDuty (full JD HTML/text), labelList[], recruitTypeName }
//      Pagination: page size is FIXED at 10 regardless of pageSize param.
//      Total returned across all pages (e.g. 30 for grad, 7 for intern).
//
// POST /api/careers/api/recruit/position/train/list
//      Same shape as /list but only intern (实习生 / 2027届研发实习生) positions.
//
// POST /api/careers/api/recruit/position/detail/type
//      Body: {} → returns the job-type dictionary
//      Result: [{job:"technology", jobName:"技术"}, {job:"general", jobName:"职能"},
//               {job:"product", jobName:"产品"}, {job:"language", jobName:"语言"},
//               {job:"market", jobName:"市场营销"}, {job:"visual", jobName:"视觉类"},
//               {job:"investment", jobName:"运营"}, {job:"vegetable", jobName:"区域业务"}]
//
// POST /api/careers/api/campus/moment/list      (notices / 公告)
//      Body: { pageSize:<int>, page:<int> }
//      Response: { success:true, result:{ list:[MomentItem], total:<int> } }
//      MomentItem: { guid, momentTitle, momentLabel:[string], publishDate:<ms>, topFlag:bool }
//
// POST /api/careers/api/campus/moment/detail
//      Body: { guid:<string> }
//      Response: { success:true, result:{ guid, momentTitle, momentContent:<html> } }
//
// POST /api/careers/api/campus/trip/list        (校招行程 / on-campus events)
//      Body: {} → { tripList:null|[...], explainTrip:{ recruitmentTripType, tripContent:<html> } }
//
// POST /api/careers/api/recruit/qa/common/list  (FAQ)
//      Body: {} → [{ question, questionCode }] (only ~2 items publicly)
//
// POST /api/careers/api/campus/careers/enum     (enum map, empty for anon)
//
// ---- AUTH-REQUIRED endpoints (HTTP 401 without login token) ----
//   /api/recruit/position/queryPosition          (rich search with all filters)
//   /api/recruit/position/querySecondPosition
//   /api/recruit/site/query, /campus/area/full/list, /campus/education/major/query
//   /api/recruit/qa/list, /api/recruit/queryByShortLink
//
// ---- RecruitType taxonomy (from JS bundle, probed 2026-05) ----
//   headquarters    = 管培生 (headquarters management trainee)
//   region          = 区域业务管培生 (regional business management trainee)
//   technical_session = 技术专场 (technical session / R&D)
//   warehouse_trainee = 仓储类管培生 (warehouse management trainee)
//   yunhu_plan      = 云弧计划 (LLM / elite tech talent program)
//   intern          = 实习生 (intern, 2027届)
//
// ---- Campus batches active at time of probing (2026-05) ----
//   2026届春季校招 (grad, 2026 batch spring)      → route /grad
//   2027届研发实习生 (intern, 2027 batch)          → route /intern
//   云弧计划 (elite LLM/AI talent program, 2026) → route /grad?recruitType=yunhu_plan
//
// ============================================================
// IMPLEMENTATION NOTES
//   - searchPositions: uses /api/recruit/position/list (grad track). Server
//     ignores `keyword` and `pageSize`; we filter client-side by keyword and
//     slice the response to honour the requested pageSize. Server returns
//     fixed pages of 10.
//   - fetchAllPositions: paginates through both /list and /train/list to
//     surface every public position.
//   - fetchPositionDetail: there is no per-position detail endpoint; the
//     /list response already includes the full jobDuty. We scan the list to
//     locate the matching record by id.
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://careers.pinduoduo.com/api/careers";
const CAMPUS_PAGE = "https://careers.pinduoduo.com/campus";
const GRAD_PAGE = `${CAMPUS_PAGE}/grad`;
const INTERN_PAGE = `${CAMPUS_PAGE}/intern`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Referer: GRAD_PAGE,
  Origin: "https://careers.pinduoduo.com",
};

// ---------- low-level call helper ----------

interface PddEnvelope<T> {
  success?: boolean;
  errorCode?: number;
  errorMsg?: string | null;
  result?: T;
}

async function call<T>(
  path: string,
  body: unknown
): Promise<{ ok: boolean; data?: T; message: string; httpStatus?: number }> {
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
    let errBody = "";
    try {
      errBody = await response.text();
    } catch (_) {
      // ignore
    }
    return {
      ok: false,
      httpStatus: response.status,
      message: `HTTP ${response.status}: ${response.statusText}${errBody ? " — " + errBody.slice(0, 120) : ""}`,
    };
  }

  let payload: PddEnvelope<T>;
  try {
    payload = (await response.json()) as PddEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  const ok = payload.success === true;
  return {
    ok,
    data: payload.result,
    message: ok ? "ok" : (payload.errorMsg || `errorCode ${payload.errorCode}`),
  };
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

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Recruit type filter.
   *  Known values: "headquarters" (管培生), "region" (区域业务管培生),
   *  "technical_session" (技术专场), "warehouse_trainee" (仓储类管培生),
   *  "yunhu_plan" (云弧计划 — LLM elite program), "intern" (实习生).
   *  Default: undefined (all types). */
  recruitType?: string;
}

// ---------- raw position shape (verified 2026-05) ----------

interface RawPosition {
  id?: string;
  name?: string;
  code?: string;
  workLocation?: string;
  workLocationName?: string;
  job?: string;
  jobName?: string;
  releaseTime?: number;
  jobDuty?: string;
  labelList?: string[];
  recruitTypeName?: string;
}

interface RawPositionList {
  list?: RawPosition[] | null;
  total?: string | number;
}

const DETAIL_URL = (id: string) =>
  `${GRAD_PAGE}?id=${encodeURIComponent(id)}`;

function summarizePosition(raw: RawPosition): PositionSummary {
  const id = raw.id ?? "";
  return {
    post_id: id,
    title: raw.name ?? "",
    project: raw.jobName ?? "",
    recruit_label: raw.recruitTypeName ?? "",
    bgs: (raw.labelList ?? []).join(" / "),
    work_cities: raw.workLocationName ?? raw.workLocation ?? "",
    apply_url: id ? DETAIL_URL(id) : GRAD_PAGE,
  };
}

// Server returns 10 items/page regardless of pageSize. Treat that as the upstream chunk.
const UPSTREAM_PAGE_SIZE = 10;

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ---------- searchPositions ----------
// Uses the public /api/recruit/position/list endpoint. The server ignores
// `keyword` and `pageSize` (always returns 10 items/page in releaseTime order),
// so we paginate upstream, then filter+slice client-side to honour the
// caller-requested keyword/pageSize.

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60).toLowerCase();
  const includeIntern = opts.recruitType === "intern";

  // Walk upstream until we have enough filtered rows to satisfy the requested page.
  const collected: RawPosition[] = [];
  let upstreamTotal = 0;
  const need = page * pageSize;
  const maxUpstreamPages = 10; // safety cap (10 pages × 10 = 100 positions)

  const endpoints = includeIntern
    ? ["/api/recruit/position/train/list"]
    : ["/api/recruit/position/list"];

  for (const path of endpoints) {
    for (let p = 1; p <= maxUpstreamPages; p++) {
      const response = await call<RawPositionList>(path, {
        pageSize: UPSTREAM_PAGE_SIZE,
        page: p,
      });
      if (!response.ok || !response.data) {
        // Surface auth-style failures as ok:false.
        if (collected.length === 0) {
          return {
            ok: false as const,
            source: "careers.pinduoduo.com",
            query: { pageSize, page, keyword: keyword || undefined, recruitType: opts.recruitType },
            page,
            page_size: pageSize,
            total: 0,
            positions: [] as PositionSummary[],
            message: response.message,
            apply_at: GRAD_PAGE,
          };
        }
        break;
      }
      upstreamTotal = Math.max(upstreamTotal, asNumber(response.data.total));
      const batch = response.data.list ?? [];
      if (!batch.length) break;
      for (const item of batch) {
        if (!keyword) {
          collected.push(item);
        } else {
          const hay = `${item.name ?? ""} ${item.recruitTypeName ?? ""} ${item.jobName ?? ""} ${item.workLocationName ?? ""} ${item.jobDuty ?? ""}`.toLowerCase();
          if (hay.includes(keyword)) collected.push(item);
        }
      }
      // Continue paginating until we have enough or exhausted the upstream pool.
      if (collected.length >= need && p * UPSTREAM_PAGE_SIZE >= upstreamTotal) break;
      if (batch.length < UPSTREAM_PAGE_SIZE) break;
    }
  }

  const start = (page - 1) * pageSize;
  const slice = collected.slice(start, start + pageSize);

  return {
    ok: true as const,
    source: "careers.pinduoduo.com",
    query: { pageSize, page, keyword: keyword || undefined, recruitType: opts.recruitType },
    page,
    page_size: pageSize,
    total: keyword ? collected.length : upstreamTotal || collected.length,
    positions: slice.map(summarizePosition),
    apply_at: GRAD_PAGE,
  };
}

// ---------- fetchAllPositions ----------
// Walks both grad (/list) and intern (/train/list) tracks until exhaustion.

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 50));
  const maxPages = Math.max(1, opts.maxPages ?? 20);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60).toLowerCase();

  const bucket: RawPosition[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const path of ["/api/recruit/position/list", "/api/recruit/position/train/list"]) {
    let pathTotal = 0;
    for (let p = 1; p <= maxPages; p++) {
      const response = await call<RawPositionList>(path, {
        pageSize: UPSTREAM_PAGE_SIZE,
        page: p,
      });
      if (!response.ok || !response.data) break;
      pathTotal = Math.max(pathTotal, asNumber(response.data.total));
      const batch = response.data.list ?? [];
      if (!batch.length) break;
      for (const item of batch) {
        const id = item.id ?? "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (keyword) {
          const hay = `${item.name ?? ""} ${item.jobName ?? ""} ${item.recruitTypeName ?? ""} ${item.workLocationName ?? ""} ${item.jobDuty ?? ""}`.toLowerCase();
          if (!hay.includes(keyword)) continue;
        }
        bucket.push(item);
      }
      if (batch.length < UPSTREAM_PAGE_SIZE) break;
    }
    total += pathTotal;
    if (bucket.length >= pageSize * maxPages) break;
  }

  return {
    ok: true as const,
    source: "careers.pinduoduo.com",
    total: keyword ? bucket.length : total || bucket.length,
    fetched: bucket.length,
    positions: bucket.map(summarizePosition),
    apply_at: GRAD_PAGE,
  };
}

// ---------- fetchPositionDetail ----------
// There is no per-position detail endpoint; the list response already carries
// the full jobDuty. We scan grad + intern lists for the matching uuid.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return {
      ok: false as const,
      source: "careers.pinduoduo.com",
      message: "post_id is required",
    };
  }

  for (const path of ["/api/recruit/position/list", "/api/recruit/position/train/list"]) {
    for (let p = 1; p <= 10; p++) {
      const response = await call<RawPositionList>(path, {
        pageSize: UPSTREAM_PAGE_SIZE,
        page: p,
      });
      if (!response.ok || !response.data) break;
      const batch = response.data.list ?? [];
      if (!batch.length) break;
      const hit = batch.find((row) => row.id === id);
      if (hit) {
        const summary = summarizePosition(hit);
        return {
          ok: true as const,
          source: "careers.pinduoduo.com",
          ...summary,
          description: hit.jobDuty ?? "",
          requirements: "",
          work_cities: hit.workLocationName ? [hit.workLocationName] : [],
          release_time: hit.releaseTime
            ? new Date(hit.releaseTime).toISOString().slice(0, 10)
            : "",
          code: hit.code ?? "",
          labels: hit.labelList ?? [],
        };
      }
      if (batch.length < UPSTREAM_PAGE_SIZE) break;
    }
  }

  return {
    ok: false as const,
    source: "careers.pinduoduo.com",
    post_id: id,
    apply_url: GRAD_PAGE,
    message:
      "Position not found in current public list. The position may have been " +
      "closed or moved to an auth-only track. " +
      `Visit ${GRAD_PAGE} to browse current openings.`,
  };
}

// ---------- fetchDictionaries ----------
// The /api/careers/api/campus/careers/enum endpoint is publicly accessible
// but returns an empty enumMap. Recruit types are documented in the header
// comment above (extracted from the JS bundle). Live job-type dictionary is
// pulled from /api/recruit/position/detail/type.

interface JobType {
  job?: string;
  jobName?: string;
}

export async function fetchDictionaries() {
  const [enumResp, typeResp] = await Promise.all([
    call<{ enumMap?: Record<string, unknown> }>("/api/campus/careers/enum", {}),
    call<JobType[]>("/api/recruit/position/detail/type", {}),
  ]);

  return {
    ok: enumResp.ok || typeResp.ok,
    source: "careers.pinduoduo.com",
    api_host: API_ROOT,
    verified_at: new Date().toISOString(),
    campus_only: true,
    // Static taxonomy extracted from JS bundle (2026-05)
    recruit_types: [
      { value: "headquarters", label: "管培生", note: "Headquarters management trainee" },
      { value: "region", label: "区域业务管培生", note: "Regional business management trainee" },
      { value: "technical_session", label: "技术专场", note: "Technical session / R&D" },
      { value: "warehouse_trainee", label: "仓储类管培生", note: "Warehouse management trainee" },
      { value: "yunhu_plan", label: "云弧计划", note: "LLM/AI elite talent program (≈ ByteDance 顶尖实习)" },
      { value: "intern", label: "实习生", note: "Intern (2027届)" },
    ],
    job_types: (typeResp.data ?? []).map((t) => ({ value: t.job ?? "", label: t.jobName ?? "" })),
    current_batch: "2026届春季校招 / 2027届研发实习生",
    grad_page: GRAD_PAGE,
    intern_page: INTERN_PAGE,
    enum_map: enumResp.data?.enumMap ?? {},
    note: "Position list is public via /api/recruit/position/list — see header comment.",
  };
}

// ---------- Notices (campus/moment) ----------
// The moment/list and moment/detail endpoints are publicly accessible.

interface RawMomentItem {
  guid?: string;
  momentTitle?: string;
  momentLabel?: string[];
  publishDate?: number;
  topFlag?: boolean;
}

interface RawMomentDetail extends RawMomentItem {
  momentContent?: string;
}

interface RawMomentList {
  list?: RawMomentItem[];
  total?: number;
}

function formatNotice(item: RawMomentItem) {
  const publish_time = item.publishDate
    ? new Date(item.publishDate).toISOString().replace("T", " ").slice(0, 10)
    : "";
  return {
    id: item.guid ?? "",
    title: item.momentTitle ?? "",
    publish_time,
    tags: item.momentLabel ?? [],
    top: Boolean(item.topFlag),
    detail_url: item.guid
      ? `${CAMPUS_PAGE}/announcements?guid=${item.guid}`
      : `${CAMPUS_PAGE}/announcements`,
  };
}

export async function listNotices() {
  const response = await call<RawMomentList>("/api/campus/moment/list", {
    pageSize: 50,
    page: 1,
  });
  if (!response.ok || !response.data) {
    return { ok: false, source: "careers.pinduoduo.com", message: response.message, notices: [] };
  }
  const items = response.data.list ?? [];
  return {
    ok: true,
    source: "careers.pinduoduo.com",
    total: response.data.total ?? items.length,
    count: items.length,
    notices: items.map(formatNotice),
  };
}

export async function getNotice(noticeId: string) {
  const guid = (noticeId ?? "").trim();
  if (!guid) return { ok: false, source: "careers.pinduoduo.com", message: "notice_id (guid) is required" };

  const response = await call<RawMomentDetail>("/api/campus/moment/detail", { guid });
  if (!response.ok || !response.data) {
    return { ok: false, source: "careers.pinduoduo.com", message: response.message };
  }
  const raw = response.data;
  const base = formatNotice(raw);
  return {
    ok: true,
    source: "careers.pinduoduo.com",
    ...base,
    content_html: raw.momentContent ?? "",
  };
}

// ---------- findNoticesByQuestion ----------

function tokenizeQuestion(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const trimmed = (text ?? "").trim();
  if (!trimmed) return out;
  for (const m of trimmed.match(/[A-Za-z0-9]{2,}/g) ?? []) {
    const k = m.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  for (const run of trimmed.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!seen.has(bigram)) { seen.add(bigram); out.push(bigram); }
      if (out.length >= 40) return out;
    }
  }
  return out;
}

function parseQuestionTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  for (const candidate of [v, v.replace(" ", "T"), `${v}T00:00:00`]) {
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
  if (!listing.ok) {
    return { ok: false, source: "careers.pinduoduo.com", message: (listing as { message?: string }).message, matches: [] };
  }

  const cutoff = parseQuestionTime(opts.questionTime);
  const tokens = tokenizeQuestion(question);
  const topK = Math.max(1, opts.topK ?? 3);

  type Scored = { score: number; notice: (typeof listing.notices)[number] };
  const scored: Scored[] = [];
  for (const notice of listing.notices) {
    const haystack = `${notice.title} ${notice.tags.join(" ")}`.toLowerCase();
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
    const full = await getNotice(notice.id);
    const excerpt = full.ok ? stripHtml((full as { content_html?: string }).content_html ?? "") : "";
    matches.push({ ...notice, excerpt });
  }

  return {
    ok: true,
    source: "careers.pinduoduo.com",
    question,
    question_time: opts.questionTime,
    matched_tokens: tokens,
    matches,
  };
}

// ---------- matchResume ----------
// Pulls every public position (grad + intern), scores each against the resume's
// extracted terms and city preferences, and returns the top-N matches.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const topN = Math.max(1, opts.topN ?? 5);

  if (!terms.length) {
    return {
      ok: false as const,
      source: "careers.pinduoduo.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const all = await fetchAllPositions({ maxPages: 10, pageSize: UPSTREAM_PAGE_SIZE });
  if (!all.ok) {
    return {
      ok: false as const,
      source: "careers.pinduoduo.com",
      extracted_terms: terms,
      city_preferences: cities,
      matches: [] as PositionSummary[],
      message: (all as { message?: string }).message ?? "failed to fetch positions",
      apply_at: GRAD_PAGE,
    };
  }

  // Score against the raw positions we already have via fetchAllPositions's caller.
  // Re-pull as raw to retain jobDuty for scoring.
  const rawCorpus: RawPosition[] = [];
  for (const path of ["/api/recruit/position/list", "/api/recruit/position/train/list"]) {
    for (let p = 1; p <= 10; p++) {
      const response = await call<RawPositionList>(path, {
        pageSize: UPSTREAM_PAGE_SIZE,
        page: p,
      });
      if (!response.ok || !response.data) break;
      const batch = response.data.list ?? [];
      if (!batch.length) break;
      rawCorpus.push(...batch);
      if (batch.length < UPSTREAM_PAGE_SIZE) break;
    }
  }

  type Scored = { raw: RawPosition; score: number; matched_terms: string[]; city_match: boolean };
  const scored: Scored[] = [];
  for (const raw of rawCorpus) {
    const hay = `${raw.name ?? ""} ${raw.jobName ?? ""} ${raw.recruitTypeName ?? ""} ${raw.jobDuty ?? ""}`.toLowerCase();
    const matched = terms.filter((t) => hay.includes(t.toLowerCase()));
    const overlap = scoreOverlap(hay, terms, cities).score;
    const city_match = cities.length === 0 ? false :
      cities.some((c) => (raw.workLocationName ?? raw.workLocation ?? "").includes(c));
    if (!matched.length && !city_match) continue;
    const score = overlap * 100 + matched.length * 5 + (city_match ? 8 : 0);
    scored.push({ raw, score, matched_terms: matched, city_match });
  }
  scored.sort((a, b) => b.score - a.score);

  const matches = scored.length
    ? scored.slice(0, topN).map((s) => ({
        ...summarizePosition(s.raw),
        score: s.score,
        matched_terms: s.matched_terms,
        city_match: s.city_match,
      }))
    : rawCorpus.slice(0, topN).map((r) => summarizePosition(r));

  return {
    ok: true as const,
    source: "careers.pinduoduo.com",
    extracted_terms: terms,
    city_preferences: cities,
    total_scanned: rawCorpus.length,
    matches,
    apply_at: GRAD_PAGE,
  };
}

export { extractResumeSignals, scoreOverlap };


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_pdd } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_pdd } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_pdd } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "careers.pinduoduo.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://careers.pinduoduo.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "careers.pinduoduo.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_pdd({
      source: "careers.pinduoduo.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://careers.pinduoduo.com/api/recruit/v1/position/apply",
      submitKind: "multipart-session",
      endpointVerified: true,
      submitNotes:
        "PDD — POST /api/recruit/v1/position/apply with session cookie. Endpoint anon-probed → returns {error_code: 40003} (real business error, not 404) — route confirmed; body shape still needs validation.",
    }),
  };
}
