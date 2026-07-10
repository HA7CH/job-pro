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
// API DISCOVERY (probed 2026-05-16, re-probed 2026-07-11)
//
//   1. GET  https://www.liepin.com/                          → Set-Cookie: XSRF-TOKEN=<token>
//   2. POST https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job
//        Content-Type: application/json;charset=UTF-8
//        Origin:       https://www.liepin.com
//        X-Client-Type: web
//        X-Xsrf-Token: <token from cookie>
//        X-Fscp-Std-Info: {"client_id": "40108"}
//        X-Fscp-Version: 1.1
//        Body: { data: { mainSearchPcConditionForm: { key:"<kw>", compId:"<id>",
//                                                     city:"410", dq:"410",
//                                                     currentPage:N, pageSize:M, … },
//                        passThroughForm: { scene:"init" } } }
//        Response: { flag:1, data:{ pagination:{ totalCounts, totalPage,
//                                                currentPage, pageSize },
//                                   data:{ jobCardList:[{ comp, job, … }],
//                                          compCard:{…} } } }
//
// Findings that shape this adapter (all verified against the live API
// 2026-07-11):
//
//   * `compId` in the request form IS honored server-side. Passing the
//     company's numeric Liepin id scopes both the result set AND
//     `pagination.totalCounts` to that company (e.g. CICC compId=4580900:
//     totalCounts=76 vs ~800 fuzzy hits for key="中金公司"). This is the
//     moka-style fix: server-side filtering first, no fuzzy-name matching.
//   * Even with `compId` set, each response appends ~2 "recommended"
//     cards from OTHER companies at the tail. A strict client-side
//     `comp.compId === cfg.compId` filter strips them.
//   * `pageSize` in the request is IGNORED — the server always returns
//     its own fixed page of 40 matches (+pads). `--page-size` is
//     therefore honored by client-side slicing.
//   * `pagination.totalCounts` is the upstream's true match count for
//     the (compId, keyword) query; `pagination.totalPage` caps how many
//     pages the API will actually serve (observed max 10 → ~400 rows).
//     When totalCounts > 40*totalPage the tail is unreachable without a
//     narrowing keyword; we report `truncated: true` + a note.
//   * Requesting a page >= totalPage either returns 0 cards (large
//     companies) or replays the full result set (small companies), so
//     pagination stops at totalPage AND when a page yields no new
//     post_ids (dedup by post_id).
//   * Canonical job URLs carry a "19" prefix over the card's jobId:
//     jobId 83872769 ↔ https://www.liepin.com/job/1983872769.shtml
//     (the raw-id URL 404s). detail must add the prefix.
//   * https://m.liepin.com/job/19<id>.shtml is server-rendered plain
//     HTML (no anti-bot transit for direct fetches) and embeds the full
//     JD in a `job-describe` section → detail scrapes it for a real
//     `description`. A missing job returns HTTP 404 → clean error.
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
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// Liepin returns a fixed server-side page of 40 matches regardless of the
// requested pageSize (verified: pageSize 5 and 100 both → 40 company rows).
const UPSTREAM_PAGE_ROWS = 40;
// Liepin never serves more than 10 pages per query (page >= totalPage is
// empty or a replay). 12 is a defensive ceiling above the observed max.
const HARD_MAX_UPSTREAM_PAGES = 12;
// Be polite between page fetches — Liepin's WAF 405s rapid-fire clients.
const PAGE_DELAY_MS = 250;
const RETRY_DELAYS_MS = [800, 2400];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

interface RawPagination {
  totalCounts?: number;
  totalPage?: number;
  currentPage?: number;
  pageSize?: number;
  hasNext?: boolean;
}

interface RawSearchData {
  pagination?: RawPagination;
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

/** Canonical public job URL: Liepin prefixes the card jobId with "19". */
function canonicalJobUrl(jobId: string): string {
  // Card post_ids are currently 8 digits (e.g. 83872769 → /job/1983872769.shtml).
  // Accept an already-prefixed long id (pasted from a URL) as-is.
  const linkId = /^19\d{8,}$/.test(jobId) ? jobId : `19${jobId}`;
  return `${HOME}/job/${encodeURIComponent(linkId)}.shtml`;
}

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
    apply_url: job.link ?? job.pcOuterLink ?? (job.jobId ? canonicalJobUrl(String(job.jobId)) : HOME),
  };
}

// ---------- core: search for a single upstream page ----------

interface PageResult {
  ok: true;
  /** Raw card count BEFORE the compId filter (0 ⇒ upstream page range exhausted). */
  rawCount: number;
  /** Cards strictly belonging to cfg.compId (recommendation pads stripped). */
  cards: RawJobCard[];
  /** Upstream's true match count for this (compId, keyword) query. */
  totalCounts: number;
  /** How many pages upstream will actually serve (observed cap: 10). */
  totalPage: number;
  compCard?: RawCompCard;
}

async function searchOnePage(
  // `null` = no company scoping (used only to look up compCard by name —
  // compId-scoped responses never carry a compCard).
  compId: number | null,
  keyword: string,
  upstreamPage: number
): Promise<PageResult | { ok: false; message: string }> {
  const tok = await getToken();
  if (!tok.ok) return tok;
  const body = {
    data: {
      mainSearchPcConditionForm: {
        city: "410",
        dq: "410",
        pubTime: "",
        currentPage: Math.max(0, upstreamPage),
        pageSize: UPSTREAM_PAGE_ROWS,
        key: keyword,
        suggestTag: "",
        workYearCode: "",
        // Server-side company scoping (verified 2026-07-11): with compId set,
        // jobCardList and pagination.totalCounts are restricted to this
        // company (plus ~2 recommendation pads we strip below).
        compId: compId === null ? "" : String(compId),
        compName: "",
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

  let lastMessage = "unknown error";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let response: Response;
    try {
      response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "User-Agent": USER_AGENT,
          Origin: HOME,
          Referer: `${HOME}/zhaopin/?key=${encodeURIComponent(keyword)}`,
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
      lastMessage = `network error: ${err instanceof Error ? err.message : err}`;
      continue; // transient — retry with backoff
    }
    if (!response.ok) {
      // Liepin's WAF answers 405 to rapid-fire clients — back off and retry.
      lastMessage = `HTTP ${response.status}: ${response.statusText}`;
      continue;
    }
    let env: RawEnvelope;
    try {
      env = (await response.json()) as RawEnvelope;
    } catch (err) {
      lastMessage = `bad JSON: ${err instanceof Error ? err.message : err}`;
      continue;
    }
    if (env.flag !== 1 || !env.data?.data) {
      // Application-level rejection — not transient, don't hammer the WAF.
      return { ok: false, message: env.msg ?? `flag=${env.flag} code=${env.code ?? "?"}` };
    }
    const inner = env.data.data;
    const pagination = env.data.pagination ?? {};
    const jobs = inner.jobCardList ?? [];
    // STRICT company filter: even with compId scoping, Liepin appends ~2
    // "recommended" cards from unrelated companies per page (verified:
    // e.g. CICC page of 42 = 40×compId 4580900 + 2 pads). Anything not
    // carrying our exact compId is dropped — no fuzzy-name fallback.
    const mine = compId === null ? jobs : jobs.filter((c) => c.comp?.compId === compId);
    return {
      ok: true,
      rawCount: jobs.length,
      cards: mine,
      totalCounts: pagination.totalCounts ?? mine.length,
      totalPage: pagination.totalPage ?? (jobs.length ? 1 : 0),
      compCard: inner.compCard,
    };
  }
  return { ok: false, message: lastMessage };
}

// ---------- core: collect unique company rows across upstream pages ----------

interface Collected {
  ok: true;
  positions: PositionSummary[];
  /** Upstream-reported true match count for the (compId, keyword) query. */
  totalCounts: number;
  totalPage: number;
  compCard?: RawCompCard;
  /** True when upstream has nothing further to serve for this query. */
  exhausted: boolean;
  pagesFetched: number;
  /** Set when a mid-sweep page failed after retries (partial result). */
  failureMessage?: string;
}

/**
 * Fetch upstream pages 0..N, dedup by post_id, until either `needed` unique
 * rows are collected, upstream is exhausted (totalPage reached / empty page /
 * page with no new ids), or `maxUpstreamPages` is hit.
 */
async function collectUnique(
  compId: number,
  keyword: string,
  needed: number,
  maxUpstreamPages: number
): Promise<Collected | { ok: false; message: string }> {
  const pageCap = Math.max(1, Math.min(HARD_MAX_UPSTREAM_PAGES, maxUpstreamPages));
  const seen = new Set<string>();
  const positions: PositionSummary[] = [];
  let totalCounts = 0;
  let totalPage = 0;
  let compCard: RawCompCard | undefined;
  let exhausted = false;
  let failureMessage: string | undefined;
  let page = 0;

  for (;;) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    const r = await searchOnePage(compId, keyword, page);
    if (!r.ok) {
      if (page === 0) return r; // total failure — nothing to report
      failureMessage = r.message; // mid-sweep failure — return the partial sweep
      break;
    }
    if (page === 0) {
      totalCounts = r.totalCounts;
      totalPage = r.totalPage;
      compCard = r.compCard ?? compCard;
    }
    let fresh = 0;
    for (const card of r.cards) {
      const s = summarize(card);
      if (!s.post_id || seen.has(s.post_id)) continue;
      seen.add(s.post_id);
      positions.push(s);
      fresh++;
    }
    page++;
    if (r.rawCount === 0 || (fresh === 0 && r.rawCount > 0)) {
      // Empty page, or a page that only replayed known ids (small companies:
      // out-of-range pages replay the full set) — upstream is exhausted.
      exhausted = true;
      break;
    }
    if (page >= totalPage) {
      exhausted = true; // consumed every page upstream will serve
      break;
    }
    if (totalCounts > 0 && positions.length >= totalCounts) {
      exhausted = true;
      break;
    }
    if (positions.length >= needed) break; // caller's window satisfied
    if (page >= pageCap) break; // our cap — result may be truncated
  }

  return { ok: true, positions, totalCounts, totalPage, compCard, exhausted, pagesFetched: page, failureMessage };
}

// ---------- detail-page JD scrape (m.liepin.com) ----------

function stripHtml(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ScrapedDetail {
  title?: string;
  salary?: string;
  requirements?: string[];
  description?: string;
}

/**
 * m.liepin.com/job/19<id>.shtml is server-rendered HTML (verified 2026-07-11:
 * direct fetch → HTTP 200, ~80KB, full JD in a `job-describe` section; a
 * missing job → HTTP 404). This is the only public path to the JD text —
 * api-c.liepin.com has no detail endpoint.
 */
async function scrapeMobileDetail(
  linkUrl: string
): Promise<{ ok: true; detail: ScrapedDetail } | { ok: false; status: number | null; message: string }> {
  const mobileUrl = linkUrl.replace("https://www.liepin.com/", "https://m.liepin.com/");
  let lastStatus: number | null = null;
  let lastMessage = "unknown error";
  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[0]);
    let response: Response;
    try {
      response = await fetch(mobileUrl, {
        headers: {
          "User-Agent": MOBILE_USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        redirect: "follow",
      });
    } catch (err) {
      lastMessage = `network error: ${err instanceof Error ? err.message : err}`;
      lastStatus = null;
      continue;
    }
    lastStatus = response.status;
    if (response.status === 404) {
      return { ok: false, status: 404, message: "position not found on Liepin (HTTP 404)" };
    }
    if (!response.ok) {
      lastMessage = `HTTP ${response.status}: ${response.statusText}`;
      continue;
    }
    const html = await response.text();
    // Nonexistent/removed jobs answer HTTP 200 with a small "出错了" page
    // ("很抱歉，页面不存在或者已删除") — only the unprefixed URL form 404s.
    if (html.includes("页面不存在或者已删除")) {
      return { ok: false, status: 404, message: "position not found on Liepin (页面不存在或者已删除)" };
    }
    const detail: ScrapedDetail = {};
    const nameMatch = /<span class="job-name">([\s\S]*?)<\/span>/.exec(html);
    if (nameMatch) detail.title = stripHtml(nameMatch[1]);
    const salaryMatch = /<p>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/.exec(html);
    if (salaryMatch) detail.salary = stripHtml(salaryMatch[1]);
    const reqMatch = /<p class="clearfix">([\s\S]*?)<\/p>/.exec(html);
    if (reqMatch) {
      const spans = [...reqMatch[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
        .map((m) => stripHtml(m[1]))
        .filter(Boolean);
      if (spans.length) detail.requirements = spans;
    }
    const descStart = html.indexOf("job-describe");
    if (descStart !== -1) {
      const sectionEnd = html.indexOf("</section>", descStart);
      const chunk = html.slice(descStart, sectionEnd !== -1 ? sectionEnd : descStart + 20000);
      const text = stripHtml(chunk.replace(/^[^>]*>/, ""));
      if (text) detail.description = text;
    }
    if (!detail.description && !detail.title) {
      // Anti-bot interstitial or layout drift — treat as a fetch failure.
      lastMessage = "page fetched but no job content found (anti-bot page or layout change)";
      continue;
    }
    return { ok: true, detail };
  }
  return { ok: false, status: lastStatus, message: lastMessage };
}

// ---------- factory ----------

export interface LiepinAdapterConfig {
  /** Display name stamped on every response (e.g. "海康威视", "中金公司"). */
  companyName: string;
  /**
   * The company's numeric Liepin id (the `/company/<id>/` page id). Passed
   * server-side in mainSearchPcConditionForm.compId AND enforced client-side
   * card-by-card — this is the strict anti-pollution filter.
   */
  compId: number;
  /**
   * Exact compName as it appears on Liepin job cards. Documentation +
   * dictionary lookups only — never used for fuzzy result filtering.
   * NB: this often differs from the display name (CICC is
   * "中国国际金融股份有限公司", Cainiao is "浙江菜鸟供应链管理有限公司").
   */
  liepinCompName: string;
  /** Human-readable label for source / error fields. */
  label: string;
  /** Per-tenant attribution override (defaults to "portal not accessible"). */
  attribution?: string;
}

export function createAdapter(cfg: LiepinAdapterConfig) {
  const ATTRIBUTION =
    cfg.attribution ?? `via Liepin (api-c.liepin.com) — official portal not publicly accessible`;

  /** Note attached when upstream refuses to serve the full match set. */
  function serveCapNote(totalCounts: number, totalPage: number): string {
    // Liepin caps pagination.totalCounts at 800 (observed: distinct queries
    // both report exactly 800 while organic counts are 741/105/76/…).
    const claim = totalCounts >= 800 ? "800+ (count capped by Liepin)" : String(totalCounts);
    return (
      `Liepin serves at most ${totalPage} pages (~${totalPage * UPSTREAM_PAGE_ROWS} rows) per query ` +
      `but reports ${claim} matches; narrow with a keyword to reach the rest.`
    );
  }

  /** pagination.totalCounts saturates at 800 — flag it so `total` stays honest. */
  function totalCapFields(totalCounts: number) {
    return totalCounts >= 800
      ? { total_note: "Liepin caps the reported match count at 800 — treat total as 800+." }
      : {};
  }

  async function searchPositions(opts: SearchOptions = {}) {
    const page = Math.max(1, opts.page ?? 1);
    // Upstream ignores pageSize (fixed 40-row pages) — we honor it by
    // slicing the deduped stream client-side.
    const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const keyword = (opts.keyword ?? "").trim();
    const r = await collectUnique(cfg.compId, keyword, end, HARD_MAX_UPSTREAM_PAGES);
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
    const window = r.positions.slice(start, end);
    const unreachableTail = r.exhausted && r.positions.length < r.totalCounts;
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      comp_id: cfg.compId,
      attribution: ATTRIBUTION,
      ...(r.compCard ? { comp_card: r.compCard } : {}),
      query: opts,
      page,
      page_size: pageSize,
      // Upstream's own match count for this (company, keyword) query —
      // NOT the row count of the returned page.
      total: r.totalCounts,
      ...totalCapFields(r.totalCounts),
      positions: window,
      ...(unreachableTail && end > r.positions.length
        ? { note: serveCapNote(r.totalCounts, r.totalPage) }
        : {}),
      ...(r.failureMessage ? { truncated: true as const, message: `partial sweep: ${r.failureMessage}` } : {}),
    };
  }

  async function fetchAllPositions(opts: SearchOptions & { maxPages?: number } = {}) {
    const maxPages = Math.max(1, opts.maxPages ?? HARD_MAX_UPSTREAM_PAGES);
    const keyword = (opts.keyword ?? "").trim();
    const r = await collectUnique(cfg.compId, keyword, Number.POSITIVE_INFINITY, maxPages);
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        company: cfg.companyName,
        attribution: ATTRIBUTION,
        message: r.message,
        total: 0,
        fetched: 0,
        positions: [] as PositionSummary[],
      };
    }
    // Honest counts: `total` is upstream's totalCounts for the query;
    // `fetched` is the number of unique post_ids actually harvested.
    // They disagree only when upstream's page cap (or our maxPages /
    // a mid-sweep failure) makes the tail unreachable → truncated: true.
    const truncated = r.positions.length < r.totalCounts || !r.exhausted || Boolean(r.failureMessage);
    const note = r.failureMessage
      ? `partial sweep: ${r.failureMessage}`
      : !r.exhausted
        ? `stopped at maxPages=${maxPages} before exhausting upstream; raise --max-pages.`
        : r.positions.length < r.totalCounts
          ? serveCapNote(r.totalCounts, r.totalPage)
          : undefined;
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      comp_id: cfg.compId,
      attribution: ATTRIBUTION,
      total: r.totalCounts,
      ...totalCapFields(r.totalCounts),
      fetched: r.positions.length,
      pages_fetched: r.pagesFetched,
      ...(truncated ? { truncated: true as const } : {}),
      ...(note ? { note } : {}),
      positions: r.positions,
    };
  }

  async function fetchPositionDetail(postId: string) {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };
    // Canonical public URL carries a "19" prefix over the card post_id
    // (verified: /job/83872769.shtml → 404, /job/1983872769.shtml → 200).
    const applyUrl = canonicalJobUrl(id);
    const scraped = await scrapeMobileDetail(applyUrl);
    if (!scraped.ok && scraped.status === 404) {
      return {
        ok: false as const,
        source: SOURCE,
        company: cfg.companyName,
        post_id: id,
        message: `position not found on Liepin (HTTP 404) — check the post_id (expected the numeric id from search results)`,
      };
    }
    if (!scraped.ok) {
      // JD page unreachable (WAF / network) — still return the fixed link.
      return {
        ok: true as const,
        source: SOURCE,
        company: cfg.companyName,
        attribution: ATTRIBUTION,
        post_id: id,
        apply_url: applyUrl,
        message:
          `Liepin has no public JSON detail endpoint and the HTML JD page could not be fetched right now ` +
          `(${scraped.message}); open apply_url in a browser for the full JD.`,
      };
    }
    const d = scraped.detail;
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      attribution: ATTRIBUTION,
      post_id: id,
      ...(d.title ? { title: d.title } : {}),
      ...(d.salary ? { salary: d.salary } : {}),
      ...(d.requirements ? { requirements: d.requirements } : {}),
      ...(d.description ? { description: d.description } : {}),
      apply_url: applyUrl,
      message: d.description
        ? "JD scraped from the m.liepin.com HTML page (Liepin exposes no JSON detail API); apply via apply_url."
        : "Liepin position detail is HTML-only and the JD section was empty; visit apply_url for the full JD.",
    };
  }

  async function fetchDictionaries() {
    // Surface the compCard payload (industry / scale / tags) as the closest
    // thing to a "taxonomy" we can offer from a third-party aggregator.
    // The compId-scoped query already carries compCard on page 0.
    const r = await searchOnePage(cfg.compId, "", 0);
    if (!r.ok) {
      return { ok: false as const, source: SOURCE, message: r.message };
    }
    let compCard = r.compCard ?? null;
    if (!compCard) {
      // compId-scoped responses never carry a compCard — Liepin only attaches
      // it to name-keyed searches. Look it up by the exact legal name.
      await sleep(PAGE_DELAY_MS);
      const byName = await searchOnePage(null, cfg.liepinCompName, 0);
      if (byName.ok) compCard = byName.compCard ?? null;
    }
    if (compCard && compCard.compId !== undefined && compCard.compId !== cfg.compId) {
      compCard = null; // never surface another company's card
    }
    return {
      ok: true as const,
      source: SOURCE,
      company: cfg.companyName,
      comp_id: cfg.compId,
      attribution: ATTRIBUTION,
      comp_card: compCard,
      open_positions: r.totalCounts,
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
    // Liepin is a social-hire aggregator — the 4 Tier-3 companies routed
    // through this factory (hikvision/cicc/cainiao/webank) have no
    // campus/intern channel here; dispatcher refuses those scopes.
    supportedScopes: ["social", "all"] as const,
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
