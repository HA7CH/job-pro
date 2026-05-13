// Thin client for 拼多多 (PDD / Pinduoduo) campus-recruiting portal at careers.pinduoduo.com.
//
// ============================================================
// API discovery (probed 2026-05, Next.js bundle 4SRcl1zmo3aLPqQ_wcJ6T):
//
// The frontend is a Next.js SPA hosted at careers.pinduoduo.com/campus/.
// All XHR calls go through a sourceSDK.wrappedRequest helper (module 96211)
// that prepends the prefix Fh = "api/careers/" to every relative URL, giving:
//
//   https://careers.pinduoduo.com/api/careers/<relative-url>
//
// ---- Probed endpoints and their accessibility (2026-05) ----
//
// PUBLIC (no auth required):
//   POST /api/careers/api/campus/moment/list
//        Body: { pageSize:<int>, page:<int> }
//        Response: { success:true, result:{ list:[MomentItem], total:<int> } }
//        MomentItem: { guid, momentTitle, momentLabel:[string], publishDate:<ms>, topFlag:bool }
//
//   POST /api/careers/api/campus/moment/detail
//        Body: { guid:<string> }
//        Response: { success:true, result:{ guid, momentTitle, momentContent:<html> } }
//
//   POST /api/careers/api/recruit/qa/common/list
//        Body: {} (no params needed)
//        Response: { success:true, result:[{ question, questionCode }] }
//        Note: only 2 FAQ items are currently surfaced publicly (2026-05).
//
//   POST /api/careers/api/campus/careers/enum
//        Body: {} → { success:true, result:{ enumMap:{} } }  (empty in public response)
//
// AUTH-REQUIRED (401 Unauthorized without valid login token):
//   POST /api/careers/api/recruit/position/queryPosition   ← main job list
//   POST /api/careers/api/recruit/position/querySecondPosition
//   POST /api/careers/api/recruit/site/query
//   POST /api/careers/api/campus/area/full/list
//   POST /api/careers/api/campus/education/major/query
//   POST /api/careers/api/recruit/qa/list
//   POST /api/careers/api/recruit/queryByShortLink
//
// ANTI-BOT BLOCKED (403 without Anti-Content token):
//   The old /api/* paths (without /api/careers/ prefix) return 403
//   from PDD's yak/openresty CDN layer. These require a dynamically
//   generated Anti-Content header produced by PDD's JS risk-control SDK.
//
// ---- Conclusion ----
// The position search/detail APIs require a registered PDD account login
// token. There is no publicly accessible job listing endpoint. This adapter
// provides honest stubs for positions and implements real data for notices
// (moment/list) and the FAQ (qa/common/list).
//
// ---- RecruitType taxonomy (from JS bundle, probed 2026-05) ----
//   headquarters    = 管培生 (headquarters management trainee)
//   region          = 区域业务管培生 (regional business management trainee)
//   technical_session = 技术专场 (technical session / R&D)
//   warehouse_trainee = 仓储类管培生 (warehouse management trainee)
//   yunhu_plan      = 云弧计划 (LLM / elite tech talent program, equivalent to ByteDance 顶尖)
//   intern          = 实习生 (intern, 2027届)
//
// ---- Campus batches active at time of probing (2026-05) ----
//   2026届春季校招 (grad, 2026 batch spring)      → route /grad
//   2027届研发实习生 (intern, 2027 batch)          → route /intern
//   云弧计划 (elite LLM/AI talent program, 2026) → route /grad?recruitType=yunhu_plan
//
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

// ---------- searchPositions ----------
// PDD's position search API (queryPosition) requires a logged-in user token.
// All calls return HTTP 401 without a valid session. This stub documents the
// attempted endpoint and returns ok:false so callers can degrade gracefully.

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const payload: Record<string, unknown> = {
    pageSize,
    page,
    ...(keyword ? { keyword } : {}),
    ...(opts.recruitType ? { recruitType: opts.recruitType } : {}),
  };

  // Attempt the real API — expected to return 401 without auth token.
  const response = await call<unknown>("/api/recruit/position/queryPosition", payload);

  // If the server starts accepting unauthenticated requests in the future,
  // this block will handle the data. For now it always falls through to the
  // stub error return below.
  if (response.ok && response.data) {
    // Future-proofing: if API becomes public, parse and return positions.
    return {
      ok: true,
      source: "careers.pinduoduo.com",
      query: payload,
      page,
      page_size: pageSize,
      total: 0,
      positions: [] as PositionSummary[],
      note: "Position data returned by server but field mapping not yet implemented — please file an issue.",
    };
  }

  const isAuth = response.httpStatus === 401;
  return {
    ok: false,
    source: "careers.pinduoduo.com",
    query: payload,
    page,
    page_size: pageSize,
    total: 0,
    positions: [] as PositionSummary[],
    message: isAuth
      ? "PDD position API requires a registered account login token (HTTP 401). " +
        "The endpoint POST /api/careers/api/recruit/position/queryPosition was reached " +
        "but rejected unauthenticated requests. Apply at: " + GRAD_PAGE
      : response.message,
    apply_at: GRAD_PAGE,
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  // Delegates to searchPositions; inherits the auth stub.
  const result = await searchPositions(opts);
  return {
    ok: result.ok,
    source: "careers.pinduoduo.com",
    total: result.total ?? 0,
    fetched: 0,
    positions: [] as PositionSummary[],
    message: (result as { message?: string }).message,
    apply_at: GRAD_PAGE,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return {
      ok: false,
      source: "careers.pinduoduo.com",
      message: "post_id is required",
    };
  }

  // There is no public detail endpoint; queryPosition (which lists with detail)
  // also requires auth. Return a stub with the closest apply URL.
  return {
    ok: false,
    source: "careers.pinduoduo.com",
    post_id: id,
    description: "",
    requirements: "",
    work_cities: [],
    apply_url: GRAD_PAGE,
    message:
      "PDD position detail API requires account auth (HTTP 401). " +
      `Visit ${GRAD_PAGE} to browse positions.`,
  };
}

// ---------- fetchDictionaries ----------
// The /api/careers/api/campus/careers/enum endpoint is publicly accessible
// but returns an empty enumMap. Recruit types are documented in the header
// comment above (extracted from the JS bundle).

export async function fetchDictionaries() {
  const response = await call<{ enumMap?: Record<string, unknown> }>(
    "/api/campus/careers/enum",
    {}
  );

  return {
    ok: response.ok,
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
    ],
    current_batch: "2026届春季校招 / 2027届研发实习生",
    grad_page: GRAD_PAGE,
    intern_page: INTERN_PAGE,
    enum_map: response.data?.enumMap ?? {},
    note: "Position search requires account login; dict shows static bundle data + live enum endpoint.",
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
// Mirrors bytedance.ts/tencent.ts algo but acknowledges that position data
// is unavailable. Returns extracted signals and the apply URL for the user
// to manually browse matching positions.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false,
      source: "careers.pinduoduo.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  // We cannot search positions (auth required), so we return a best-effort
  // recommendation: which PDD recruit type best matches the resume signals,
  // with a direct link to the appropriate page.
  const isTechnical = terms.some((t) =>
    ["python", "java", "go", "golang", "c++", "cpp", "rust", "typescript",
     "javascript", "react", "vue", "spring", "pytorch", "tensorflow",
     "kubernetes", "docker", "linux", "llm", "rag", "transformer",
     "后端", "前端", "算法", "推荐", "搜索", "大模型", "测试", "运维", "安全"].includes(t.toLowerCase())
  );
  const isLLM = terms.some((t) =>
    ["llm", "rag", "transformer", "bert", "gpt", "diffusion", "大模型", "强化学习", "多模态"].includes(t.toLowerCase())
  );

  type SuggestedTrack = { recruitType: string; label: string; url: string; reason: string };
  const suggested: SuggestedTrack[] = [];
  if (isLLM) {
    suggested.push({
      recruitType: "yunhu_plan",
      label: "云弧计划 (LLM Elite)",
      url: `${GRAD_PAGE}?recruitType=yunhu_plan`,
      reason: "LLM/AI signals detected: " + terms.filter((t) =>
        ["llm", "rag", "transformer", "bert", "gpt", "diffusion", "大模型"].includes(t.toLowerCase())
      ).slice(0, 3).join(", "),
    });
  }
  if (isTechnical) {
    suggested.push({
      recruitType: "technical_session",
      label: "技术专场 (R&D)",
      url: `${GRAD_PAGE}?recruitType=technical_session`,
      reason: "Technical signals detected: " + terms.slice(0, 3).join(", "),
    });
  }
  suggested.push({
    recruitType: "headquarters",
    label: "管培生 (Management Trainee)",
    url: `${GRAD_PAGE}?recruitType=headquarters`,
    reason: "General campus track",
  });

  return {
    ok: true,
    source: "careers.pinduoduo.com",
    extracted_terms: terms,
    city_preferences: cities,
    note:
      "PDD position search API requires account auth — cannot rank individual JDs. " +
      "Suggested tracks are derived from resume signals against static recruit-type taxonomy.",
    suggested_tracks: suggested.slice(0, opts.topN ?? 3),
    matches: [] as PositionSummary[],
    apply_at: GRAD_PAGE,
  };
}

export { extractResumeSignals, scoreOverlap };
