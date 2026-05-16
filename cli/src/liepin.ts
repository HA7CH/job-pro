// Generic 猎聘 (Liepin) aggregator factory for `job-pro`.
//
// ============================================================
// WHY THIS EXISTS
//
// Four of the 50 companies (hikvision / cicc / cainiao / webank) have no
// publicly reachable canonical job feed — see `docs/stub-unblock.md`.
// Liepin (https://www.liepin.com) is a major Chinese job aggregator
// whose public `pc-search-job` endpoint surfaces real, currently-open
// positions for every Chinese employer of consequence. It does NOT
// require authentication, just a one-time XSRF-TOKEN cookie that the
// liepin.com home page sets on first request.
//
// We use Liepin here as a fallback ONLY for the 4 adapters above. The
// other 46 adapters continue to talk to their company's own API. Every
// position surfaced through this factory has `source: "api-c.liepin.com"`
// in its envelope so consumers can tell it's a third-party feed.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16)
//
//   1. GET  https://www.liepin.com/                          → Set-Cookie: XSRF-TOKEN=<token>
//   2. POST https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job
//        Content-Type: application/json;charset=UTF-8
//        Origin:       https://www.liepin.com
//        X-Client-Type: web
//        X-Xsrf-Token: <token from cookie>
//        X-Fscp-Std-Info: {"client_id": "40108"}
//        X-Fscp-Version: 1.1
//        Body: { data: { mainSearchPcConditionForm: { key:"<co>", city:"410",
//                                                     dq:"410", currentPage:N,
//                                                     pageSize:M, … },
//                        passThroughForm: { scene:"init" } } }
//        Response: { flag:1, data:{ data:{ jobCardList:[{ comp, job, recruiter, … }],
//                                          compCard:{…} } } }
//
// `city:"410"` = 全国 (all of China). Per-city codes are documented in
// Liepin's filter taxonomy; left as future work.

import { randomUUID } from "node:crypto";
import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume, extractResumeSignals, scoreOverlap };

const HOME = "https://www.liepin.com";
const SEARCH_URL = "https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job";
const SOURCE = "api-c.liepin.com";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// ---------- canonical types ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

// ---------- raw shapes ----------

interface RawComp {
  compId?: number;
  compName?: string;
  compIndustry?: string;
  compScale?: string;
  compStage?: string;
  link?: string;
  compLogo?: string;
}

interface RawJob {
  jobId?: string;
  title?: string;
  dq?: string;
  salary?: string;
  jobKind?: string;
  requireWorkYears?: string;
  requireEduLevel?: string;
  link?: string;
  refreshTime?: string;
  pcOuterLink?: string;
}

interface RawJobCard {
  comp?: RawComp;
  job?: RawJob;
}

interface RawCompCard {
  compId?: number;
  compName?: string;
  industry?: string;
  scale?: string;
  compStage?: string;
  link?: string;
  superEmployer?: boolean;
  compCardTags?: string[];
}

interface RawSearchData {
  data?: {
    jobCardList?: RawJobCard[];
    compCard?: RawCompCard;
    compList?: unknown[];
  };
}

interface RawEnvelope {
  flag?: number;
  code?: string;
  msg?: string;
  data?: RawSearchData;
}

// ---------- shared XSRF-TOKEN cache ----------
// One token per Node process. Liepin's token is short-lived (~hour) but for a
// CLI process that finishes in seconds, refreshing on every invocation is
// fine. We still cache it within the process so multi-call workflows reuse it.

let _token: { value: string; cookieHeader: string; fetchedAt: number } | null = null;

async function getToken(): Promise<{ ok: true; xsrf: string; cookie: string } | { ok: false; message: string }> {
  if (_token && Date.now() - _token.fetchedAt < 30 * 60 * 1000) {
    return { ok: true, xsrf: _token.value, cookie: _token.cookieHeader };
  }
  let response: Response;
  try {
    response = await fetch(HOME, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9" },
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  // getSetCookie() is the Node-undici-canonical API for multi-Set-Cookie headers.
  const headersAny = response.headers as unknown as { getSetCookie?: () => string[] };
  const setCookies: string[] = typeof headersAny.getSetCookie === "function"
    ? headersAny.getSetCookie.call(response.headers) ?? []
    : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/);

  let xsrf = "";
  const cookieParts: string[] = [];
  for (const c of setCookies) {
    const kv = c.split(";")[0].trim();
    cookieParts.push(kv);
    if (kv.startsWith("XSRF-TOKEN=")) xsrf = kv.slice("XSRF-TOKEN=".length);
  }
  if (!xsrf) {
    return { ok: false, message: "liepin.com did not set an XSRF-TOKEN cookie" };
  }
  _token = { value: xsrf, cookieHeader: cookieParts.join("; "), fetchedAt: Date.now() };
  return { ok: true, xsrf, cookie: _token.cookieHeader };
}

// ---------- summarise ----------

function summarize(card: RawJobCard): PositionSummary {
  const comp = card.comp ?? {};
  const job = card.job ?? {};
  return {
    post_id: String(job.jobId ?? ""),
    title: (job.title ?? "").trim(),
    project: "",
    recruit_label: job.jobKind === "1" ? "全职" : job.jobKind === "2" ? "社招" : "",
    bgs: (comp.compIndustry ?? "").trim(),
    work_cities: (job.dq ?? "").trim(),
    apply_url: job.link ?? job.pcOuterLink ?? (job.jobId ? `https://www.liepin.com/job/${encodeURIComponent(String(job.jobId))}.shtml` : HOME),
  };
}

// ---------- core: search for a single page ----------

async function searchOnePage(
  companyName: string,
  keyword: string,
  page: number,
  pageSize: number
): Promise<
  | { ok: true; total: number; jobs: RawJobCard[]; compCard?: RawCompCard }
  | { ok: false; message: string }
> {
  const tok = await getToken();
  if (!tok.ok) return tok;
  const fullKey = [companyName, keyword].filter(Boolean).join(" ").trim();
  const body = {
    data: {
      mainSearchPcConditionForm: {
        city: "410",
        dq: "410",
        pubTime: "",
        currentPage: Math.max(0, page - 1),
        pageSize: Math.max(1, Math.min(40, pageSize)),
        key: fullKey,
        suggestTag: "",
        workYearCode: "",
        compId: "",
        compName: companyName,
        compTag: "",
        industry: "",
        salaryCode: "",
        jobKind: "",
        compScale: "",
        compKind: "",
        compStage: "",
        eduLevel: "",
        salaryLow: "",
        salaryHigh: "",
      },
      passThroughForm: { scene: "init", skId: "", fkId: "", ckId: "", suggest: null },
    },
  };
  let response: Response;
  try {
    response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "User-Agent": USER_AGENT,
        Origin: HOME,
        Referer: `${HOME}/zhaopin/?key=${encodeURIComponent(fullKey)}`,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "X-Client-Type": "web",
        "X-Requested-With": "XMLHttpRequest",
        "X-Fscp-Std-Info": '{"client_id": "40108"}',
        "X-Fscp-Version": "1.1",
        "X-Fscp-Trace-Id": randomUUID(),
        "X-Xsrf-Token": tok.xsrf,
        Cookie: tok.cookie,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }
  let env: RawEnvelope;
  try {
    env = (await response.json()) as RawEnvelope;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  if (env.flag !== 1 || !env.data?.data) {
    return { ok: false, message: env.msg ?? `flag=${env.flag} code=${env.code ?? "?"}` };
  }
  const inner = env.data.data;
  const jobs = inner.jobCardList ?? [];
  // Filter to the actual target company (Liepin's relevance ranker leaks
  // adjacent employers when there's no exact match).
  const exact = jobs.filter((c) => (c.comp?.compName ?? "") === companyName);
  return {
    ok: true,
    total: exact.length === 0 ? jobs.length : exact.length,
    jobs: exact.length === 0 ? jobs : exact,
    compCard: inner.compCard,
  };
}

// ---------- factory ----------

export interface LiepinAdapterConfig {
  /** Exact compName as it appears on Liepin (e.g. "海康威视", "微众银行"). */
  companyName: string;
  /** Human-readable label for source / error fields. */
  label: string;
}

export function createAdapter(cfg: LiepinAdapterConfig) {
  const ATTRIBUTION = `via Liepin (api-c.liepin.com) — official portal not publicly accessible`;

  async function searchPositions(opts: SearchOptions = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.max(1, Math.min(40, opts.pageSize ?? 20));
    const r = await searchOnePage(cfg.companyName, (opts.keyword ?? "").trim(), page, pageSize);
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        company: cfg.companyName,
        attribution: ATTRIBUTION,
        message: r.message,
        query: opts,
        positions: [] as PositionSummary[],
      };
    }
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      attribution: ATTRIBUTION,
      comp_card: r.compCard,
      query: opts,
      page,
      page_size: pageSize,
      total: r.total,
      positions: r.jobs.map(summarize),
    };
  }

  async function fetchAllPositions(opts: SearchOptions & { maxPages?: number } = {}) {
    const pageSize = Math.max(1, Math.min(40, opts.pageSize ?? 40));
    const maxPages = Math.max(1, opts.maxPages ?? 10);
    const bucket: PositionSummary[] = [];
    let total = 0;
    let lastMsg = "ok";
    let anyOk = false;
    for (let page = 1; page <= maxPages; page++) {
      const r = await searchOnePage(cfg.companyName, (opts.keyword ?? "").trim(), page, pageSize);
      if (!r.ok) {
        lastMsg = r.message;
        break;
      }
      anyOk = true;
      total = r.total;
      if (!r.jobs.length) break;
      for (const c of r.jobs) bucket.push(summarize(c));
      if (r.jobs.length < pageSize) break;
    }
    if (!anyOk) {
      return {
        ok: false as const,
        source: SOURCE,
        company: cfg.companyName,
        attribution: ATTRIBUTION,
        message: lastMsg,
        total: 0,
        fetched: 0,
        positions: [] as PositionSummary[],
      };
    }
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      attribution: ATTRIBUTION,
      total,
      fetched: bucket.length,
      positions: bucket,
    };
  }

  async function fetchPositionDetail(postId: string) {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };
    // Liepin's detail page is `/job/{id}.shtml` — non-API, HTML-only. We
    // surface the deep-link rather than pretend to fetch a JSON detail.
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      attribution: ATTRIBUTION,
      post_id: id,
      apply_url: `https://www.liepin.com/job/${encodeURIComponent(id)}.shtml`,
      message: "Liepin position detail is HTML-only; visit apply_url for the full JD.",
    };
  }

  async function fetchDictionaries() {
    // Surface the compCard payload (industry / scale / tags) as the closest
    // thing to a "taxonomy" we can offer from a third-party aggregator.
    const r = await searchOnePage(cfg.companyName, "", 1, 5);
    if (!r.ok) {
      return { ok: false as const, source: SOURCE, message: r.message };
    }
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      attribution: ATTRIBUTION,
      comp_card: r.compCard ?? null,
      note:
        "Liepin doesn't expose a per-company filter taxonomy; comp_card holds " +
        "the company profile (industry, scale, stage, tags).",
    };
  }

  const NOTICES_MSG = `${cfg.label}: surfaced via Liepin aggregator; no notices endpoint available.`;
  async function listNotices() {
    return { ok: false as const, source: SOURCE, message: NOTICES_MSG, notices: [] as never[] };
  }
  async function getNotice(noticeId: string) {
    return { ok: false as const, source: SOURCE, message: NOTICES_MSG, notice_id: noticeId };
  }
  async function findNoticesByQuestion(
    question: string,
    _opts: { questionTime?: string; topK?: number } = {}
  ) {
    return { ok: false as const, source: SOURCE, question, message: NOTICES_MSG, matches: [] as unknown[] };
  }

  // matchResume reuses extractResumeSignals / scoreOverlap from tencent.ts
  // so the contract matches every other adapter.
  async function matchResume(
    text: string,
    opts: { topN?: number; candidates?: number } = {}
  ) {
    const topN = Math.max(1, opts.topN ?? 5);
    const candidates = Math.max(topN, opts.candidates ?? 20);
    const { terms, cities } = extractResumeSignals(text ?? "");
    if (!terms.length) {
      return {
        ok: false as const,
        source: SOURCE,
        message: "could not extract any technical signals from the text",
        preview: (text ?? "").slice(0, 120),
      };
    }
    const keyword = terms.slice(0, 3).join(" ");
    const list = await searchPositions({ keyword, page: 1, pageSize: 40 });
    if (!list.ok) {
      return { ok: false as const, source: SOURCE, message: list.message, positions: [] };
    }
    type Scored = { score: number; position: PositionSummary; reasons: string[] };
    const scored: Scored[] = [];
    for (const p of list.positions) {
      const blob = [p.title, p.bgs, p.work_cities, p.recruit_label].join(" ");
      const { score, reasons } = scoreOverlap(blob, terms, cities);
      if (score > 0) scored.push({ score, position: p, reasons });
    }
    scored.sort((a, b) => b.score - a.score);
    let shortlist = scored.slice(0, Math.max(topN, candidates));
    if (!shortlist.length) {
      shortlist = list.positions.slice(0, candidates).map((position) => ({ score: 0, position, reasons: [] }));
    }
    const matches = shortlist.slice(0, topN).map((s) => {
      const mr =
        s.reasons.length > 0
          ? s.reasons.slice(0, 5)
          : ["no specific keyword overlap — surfaced from Liepin search"];
      return { ...s.position, match_reasons: mr };
    });
    return {
      ok: true as const,
      source: SOURCE,
      attribution: ATTRIBUTION,
      extracted_terms: terms,
      city_preferences: cities,
      matches,
      note:
        "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
        "The only authority on selection is HR.",
    };
  }

  return {
    searchPositions,
    fetchAllPositions,
    fetchPositionDetail,
    fetchDictionaries,
    listNotices,
    getNotice,
    findNoticesByQuestion,
    matchResume,
    checkResume,
  };
}
