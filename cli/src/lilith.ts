// 莉莉丝游戏 (Lilith Games) careers adapter — Feishu portal_type=6, direct HTTP.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16, re-probed 2026-07-11)
//
// Lilith's careers feed is hosted at `lilithgames.jobs.feishu.cn` (Feishu
// 招聘 / ATSX). When first probed (2026-05-16) the tenant rejected anonymous
// POST /api/v1/search/job/posts with HTTP 405 from ByteDance Tengine — the
// `_signature` anti-bot wall — which forced a browser-driven implementation.
// Re-probed 2026-07-11: plain HTTPS POSTs are accepted again (no signature,
// no cookie required), so direct fetch is now the primary path.
//
// CRITICAL channel finding (2026-07-11, curl against the live API):
//   - WITH `portal-channel: index` + `website-path: index` headers (what the
//     /index/ SPA itself sends): count=57 — a curated sub-portal storefront.
//     This is exactly the 57/110 under-enumeration shipped in ≤1.1.14.
//   - WITHOUT channel headers (or with empty values): count=110 — the full
//     tenant feed, matching the official site total. keyword=工程师 → 30
//     (vs 17 on the "index" sub-portal). The 53 extra posts include all the
//     测试/测试开发 roles, the 首尔 (CT_134) and 新加坡 (CT_163) positions,
//     AIGC工程师 (7526834407438158134), etc. A bare `Referer: …/index/`
//     without the channel headers still returns 110.
// So this adapter deliberately POSTs WITHOUT portal-channel/website-path.
//
// Pagination (probed 2026-07-11): standard limit/offset; limit=100 honored
// (offset=0 → 100 rows, offset=100 → 10 rows, 110 unique ids, count=110).
// Server-side filters honored: `keyword` (工程师 → count=30) and
// `location_code_list` (["CT_134"] → count=1, 韩国市场营销经理/首尔).
//
// The headless-browser machinery below survives ONLY as a fallback for the
// historically observed 405 signature wall: it opens the careers page and
// re-issues the same no-channel fetch from inside the page context (browser
// TLS fingerprint + cookies pass the WAF; our fetch does not inherit the
// SPA's channel headers). Force it with $JOB_PRO_LILITH_FORCE_BROWSER=1.

import { existsSync } from "node:fs";
import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

// ---------- minimal headless-browser helper (405-wall fallback only) ----------
//
// Why puppeteer-core (not puppeteer): we attach to the user's existing
// Chrome installation; no 100MB Chromium download.
//
// Lifecycle contract (fixes the ≤1.1.14 "CLI prints JSON then hangs forever"
// bug): every public verb that may launch Chrome runs inside
// `withBrowserCleanup`, which awaits `closeBrowserQuietly()` in a finally —
// the CDP websocket + child process otherwise keep the event loop alive and
// node never exits. As a belt-and-braces measure the Chrome child process is
// `unref()`ed right after launch, and exit/SIGINT/SIGTERM hooks best-effort
// close too.

interface BrowserPage {
  setUserAgent: (ua: string) => Promise<void>;
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  evaluate: (fn: (...args: never[]) => unknown, ...args: unknown[]) => Promise<unknown>;
  close: () => Promise<void>;
}
interface HeadlessBrowser {
  newPage: () => Promise<BrowserPage>;
  close: () => Promise<void>;
  process?: () => { unref?: () => void } | null;
}
type BrowserError =
  | { reason: "puppeteer-not-installed"; message: string }
  | { reason: "chrome-not-found"; message: string }
  | { reason: "launch-failed"; message: string };

const CHROME_PATHS = [
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  // Windows (when running under WSL / Git Bash)
  "/c/Program Files/Google/Chrome/Application/chrome.exe",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

let _browser: HeadlessBrowser | null = null;
let _browserError: BrowserError | null = null;
let _launching: Promise<HeadlessBrowser | BrowserError> | null = null;

function findChrome(): string | null {
  if (process.env.JOB_PRO_CHROME && existsSync(process.env.JOB_PRO_CHROME)) {
    return process.env.JOB_PRO_CHROME;
  }
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function launchOnce(): Promise<HeadlessBrowser | BrowserError> {
  let launch: (opts: unknown) => Promise<HeadlessBrowser>;
  try {
    // Dynamic import; if puppeteer-core was tree-shaken or uninstalled,
    // this rejects with ERR_MODULE_NOT_FOUND.
    const mod = (await import("puppeteer-core")) as unknown as {
      default: { launch: (opts: unknown) => Promise<HeadlessBrowser> };
    };
    launch = mod.default.launch.bind(mod.default);
  } catch (err) {
    return {
      reason: "puppeteer-not-installed",
      message:
        "`puppeteer-core` is not installed. Install it locally with " +
        "`npm i puppeteer-core` (or `pnpm add puppeteer-core`). " +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const chrome = findChrome();
  if (!chrome) {
    return {
      reason: "chrome-not-found",
      message:
        "No Chrome/Chromium executable found. Tried: " +
        CHROME_PATHS.join(", ") +
        ". Set $JOB_PRO_CHROME=/path/to/chrome to override.",
    };
  }
  // Optional egress proxy — useful for geo-fenced upstreams. Set
  // `$JOB_PRO_HTTPS_PROXY=http://user:pass@host:port` or `socks5://host:port`.
  const proxy = process.env.JOB_PRO_HTTPS_PROXY?.trim();
  const proxyArg = proxy ? [`--proxy-server=${proxy}`] : [];
  try {
    const browser = await launch({
      executablePath: chrome,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        ...proxyArg,
      ],
    });
    // unref the Chrome child so a missed close can never pin node's exit —
    // the primary guarantee is still closeBrowserQuietly() in the verbs'
    // finally blocks (the CDP websocket alone would keep the loop alive).
    try {
      browser.process?.()?.unref?.();
    } catch {
      /* ignore */
    }
    return browser;
  } catch (err) {
    return {
      reason: "launch-failed",
      message: `Chrome failed to launch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function getBrowser(): Promise<
  { ok: true; browser: HeadlessBrowser } | { ok: false; error: BrowserError }
> {
  if (_browser) return { ok: true, browser: _browser };
  if (_browserError) return { ok: false, error: _browserError };
  if (!_launching) {
    _launching = launchOnce();
  }
  const result = await _launching;
  _launching = null;
  if ("reason" in result) {
    _browserError = result;
    return { ok: false, error: result };
  }
  _browser = result;
  return { ok: true, browser: result };
}

/** Close the singleton browser (if any) so the event loop can drain. */
async function closeBrowserQuietly(): Promise<void> {
  // Settle any in-flight launch first so we never orphan a Chrome that
  // finishes launching after cleanup ran.
  if (_launching) {
    const settled = await _launching.catch(() => null);
    _launching = null;
    if (settled && !("reason" in settled) && !_browser) _browser = settled;
  }
  const b = _browser;
  _browser = null;
  if (b) {
    try {
      await withTimeout(b.close(), 5000, "browser close");
    } catch {
      /* ignore — child was unref()ed at launch, so node can exit anyway */
    }
  }
}

/** Run a verb body, always releasing the fallback browser afterwards. */
async function withBrowserCleanup<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await closeBrowserQuietly();
  }
}

// On abnormal exit, best-effort close the browser to avoid zombie processes.
let _exitHookInstalled = false;
function ensureExitHook(): void {
  if (_exitHookInstalled) return;
  _exitHookInstalled = true;
  const cleanup = () => {
    if (_browser) {
      try {
        void _browser.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}

/** Reject `p` if it hasn't settled within `ms`. The watchdog timer is
 *  unref()ed so it can never itself keep the process alive. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    t.unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Open a page, run fn against it, and close the page. The singleton browser stays open. */
async function withPage<T>(
  fn: (page: BrowserPage) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: BrowserError }> {
  ensureExitHook();
  const b = await getBrowser();
  if (!b.ok) return b;
  let page: BrowserPage | null = null;
  try {
    page = await b.browser.newPage();
    await page.setUserAgent(USER_AGENT);
    const value = await fn(page);
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: {
        reason: "launch-failed",
        message: `page operation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  } finally {
    if (page) {
      try {
        await withTimeout(page.close(), 5000, "page close");
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * The full no-channel feed is 110 posts and every one of them is
 * recruit_type=全职 social hire (verified across all 110 rows, 2026-07-11) —
 * the tenant exposes no campus/intern channel (`portal-channel: social` and
 * friends return -9000003 "site not exist"). So only social/all are real.
 */
export const supportedScopes = ["social", "all"] as const satisfies ReadonlyArray<PositionScope>;

const SOURCE = "lilithgames.jobs.feishu.cn";
const HOST = "https://lilithgames.jobs.feishu.cn";
const CAREER_PAGE = `${HOST}/index/`;
const SEARCH_PATH = "/api/v1/search/job/posts";
const SEARCH_API = `${HOST}${SEARCH_PATH}`;
const FETCH_TIMEOUT_MS = 20_000;
// Feishu's standard SSR route is `/index/position/:id/detail`. The previous
// `/career/:id/detail` form returned a generic SPA shell (title "加入莉莉丝")
// for every id including bogus ones — same xiaohongshu-class bug as 1.1.4.
const DETAIL_PAGE = (id: string) => `${HOST}/index/position/${encodeURIComponent(id)}/detail`;

// ---------- raw shapes (subset of Feishu envelope) ----------

interface RawCity {
  code?: string;
  name?: string;
  en_name?: string;
}

interface RawJobCategory {
  id?: string;
  name?: string;
  parent?: RawJobCategory | null;
}

interface RawJobPost {
  id?: string | number;
  title?: string;
  city_info?: RawCity | null;
  city_list?: RawCity[];
  recruit_type?: { id?: string; name?: string };
  job_category?: RawJobCategory | null;
  job_function?: RawJobCategory | null;
  description?: string;
  requirement?: string;
  code?: string;
}

interface RawSearchEnvelope {
  code?: number;
  message?: string;
  data?: {
    job_post_list?: RawJobPost[];
    count?: number;
  };
}

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
  /** Feishu location code (live feed 2026-07-11: CT_125=上海, CT_134=首尔,
   *  CT_163=新加坡). Passed server-side as `location_code_list`. */
  cityCode?: string;
}

function summarize(item: RawJobPost): PositionSummary {
  const id = String(item.id ?? "");
  const cityList = item.city_list ?? [];
  const work_cities =
    cityList.length > 1
      ? cityList.map((c) => c.name ?? "").filter(Boolean).join(" / ")
      : cityList[0]?.name ?? item.city_info?.name ?? "";
  const project = item.job_category?.name ?? item.job_function?.name ?? "";
  return {
    post_id: id,
    title: item.title ?? "",
    project,
    recruit_label: item.recruit_type?.name ?? "",
    bgs: "",
    work_cities,
    apply_url: id ? DETAIL_PAGE(id) : CAREER_PAGE,
  };
}

function STUB_MESSAGE(reason: string): string {
  return (
    "Lilith Games (莉莉丝): direct HTTP hit the ByteDance anti-bot (signature) " +
    `wall and the browser fallback also failed: ${reason}. ` +
    "Install Google Chrome (or set $JOB_PRO_CHROME=/path/to/chrome) and " +
    "ensure puppeteer-core is installed (it ships with this CLI by default)."
  );
}

// ---------- upstream call (direct HTTP first, browser on signature wall) ----------

interface SearchBody {
  keyword: string;
  limit: number;
  offset: number;
  portal_type: number;
  portal_entrance: number;
  language: string;
  location_code_list?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Once the signature wall is seen, every later call in this process goes
// straight to the browser (no point re-poking a WAF that just rejected us).
let _signatureWalled = false;

async function callSearchApi(body: SearchBody): Promise<
  { ok: true; env: RawSearchEnvelope } | { ok: false; message: string; signatureWall: boolean }
> {
  // WAF etiquette: bounded retries with backoff on transient failures
  // (network error / 429 / 5xx / bad JSON). A 405/403 is the Tengine
  // signature wall — report it immediately instead of hammering, so the
  // caller can fall back to the browser.
  const backoffsMs = [0, 1500, 4000];
  let lastMessage = "unknown error";
  for (const backoff of backoffsMs) {
    if (backoff > 0) await sleep(backoff);
    let response: Response;
    try {
      response = await fetch(SEARCH_API, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          // Deliberately NO portal-channel / website-path headers: the
          // "index" channel is a 57-post sub-portal; the bare endpoint
          // serves the full 110-post tenant feed (probed 2026-07-11).
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastMessage = `network error: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    if (response.status === 405 || response.status === 403) {
      return {
        ok: false,
        signatureWall: true,
        message: `HTTP ${response.status} — ByteDance Tengine anti-bot (signature) wall`,
      };
    }
    if (!response.ok) {
      lastMessage = `HTTP ${response.status}: ${response.statusText}`;
      if (response.status === 429 || response.status >= 500) continue;
      return { ok: false, signatureWall: false, message: lastMessage };
    }
    try {
      return { ok: true, env: (await response.json()) as RawSearchEnvelope };
    } catch (err) {
      lastMessage = `bad JSON: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
  }
  return { ok: false, signatureWall: false, message: lastMessage };
}

async function callSearchApiViaBrowser(body: SearchBody): Promise<
  { ok: true; env: RawSearchEnvelope } | { ok: false; message: string }
> {
  const r = await withPage(async (page) => {
    // domcontentloaded is enough — we only need a same-origin document so the
    // in-page fetch rides the browser's TLS fingerprint + cookies past the
    // WAF. Our own fetch does NOT inherit the SPA's portal-channel headers,
    // so it hits the same full no-channel feed as the direct path.
    await page.goto(CAREER_PAGE, { waitUntil: "domcontentloaded", timeout: FETCH_TIMEOUT_MS });
    const env = await withTimeout(
      page.evaluate(
        async (path: string, payload: string) => {
          const resp = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          });
          if (!resp.ok) throw new Error(`in-page HTTP ${resp.status}`);
          return (await resp.json()) as unknown;
        },
        SEARCH_PATH,
        JSON.stringify(body)
      ),
      FETCH_TIMEOUT_MS,
      "in-page search fetch"
    );
    return env as RawSearchEnvelope;
  });
  if (!r.ok) return { ok: false, message: STUB_MESSAGE(r.error.message) };
  return { ok: true, env: r.value };
}

// ---------- core search ----------

type SearchResult = {
  ok: true;
  total: number;
  positions: PositionSummary[];
  rawJobs: RawJobPost[];
};

async function searchOnce(opts: SearchOptions): Promise<
  { ok: true; result: SearchResult } | { ok: false; message: string }
> {
  const limit = Math.max(1, Math.min(100, opts.pageSize ?? 10));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const cityCode = (opts.cityCode ?? "").trim();

  const body: SearchBody = {
    keyword,
    limit,
    offset: (page - 1) * limit,
    portal_type: 6,
    portal_entrance: 1,
    language: "zh",
  };
  if (cityCode) body.location_code_list = [cityCode];

  let call: { ok: true; env: RawSearchEnvelope } | { ok: false; message: string };
  if (_signatureWalled || process.env.JOB_PRO_LILITH_FORCE_BROWSER === "1") {
    call = await callSearchApiViaBrowser(body);
  } else {
    const direct = await callSearchApi(body);
    if (!direct.ok && direct.signatureWall) {
      _signatureWalled = true;
      call = await callSearchApiViaBrowser(body);
    } else {
      call = direct;
    }
  }
  if (!call.ok) return { ok: false, message: call.message };

  const env = call.env;
  if (env.code !== 0 || !env.data) {
    return {
      ok: false,
      message: `upstream returned code=${env.code} (${env.message ?? "unknown"})`,
    };
  }
  const rawJobs = env.data.job_post_list ?? [];
  return {
    ok: true,
    result: {
      ok: true,
      total: env.data.count ?? rawJobs.length,
      positions: rawJobs.map(summarize),
      rawJobs,
    },
  };
}

// ---------- public API ----------

export async function searchPositions(opts: SearchOptions = {}) {
  return withBrowserCleanup(async () => {
    const r = await searchOnce(opts);
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        message: r.message,
        query: opts,
        positions: [] as PositionSummary[],
      };
    }
    return {
      ok: true as const,
      source: SOURCE,
      query: opts,
      page: opts.page ?? 1,
      page_size: Math.max(1, Math.min(100, opts.pageSize ?? 10)),
      total: r.result.total,
      positions: r.result.positions,
    };
  });
}

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  return withBrowserCleanup(async () => {
    const limit = Math.max(1, Math.min(100, opts.pageSize ?? 100));
    const maxPages = Math.max(1, opts.maxPages ?? 10);
    const seen = new Set<string>();
    const bucket: PositionSummary[] = [];
    let total = 0;
    for (let page = 1; page <= maxPages; page++) {
      const r = await searchOnce({ ...opts, page, pageSize: limit });
      if (!r.ok) {
        if (bucket.length === 0) {
          return {
            ok: false as const,
            source: SOURCE,
            message: r.message,
            total: 0,
            fetched: 0,
            positions: [] as PositionSummary[],
          };
        }
        break; // keep the partial bucket; truncated flag below tells the truth
      }
      total = r.result.total;
      let added = 0;
      for (const p of r.result.positions) {
        if (!p.post_id || seen.has(p.post_id)) continue;
        seen.add(p.post_id);
        bucket.push(p);
        added += 1;
      }
      if (bucket.length >= total) break;
      if (r.result.positions.length < limit) break; // short page — upstream exhausted
      if (added === 0) break; // nothing new — upstream ignoring offset; stop instead of looping
    }
    return {
      ok: true as const,
      source: SOURCE,
      total,
      fetched: bucket.length,
      truncated: bucket.length < total,
      positions: bucket,
    };
  });
}

// fetchPositionDetail: Feishu has no per-id REST endpoint; scan the FULL
// no-channel feed (110 posts as of 2026-07-11 → 2 pages at limit=100;
// maxPages=10 leaves ~10x headroom before we'd ever truncate the scan).

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };
  return withBrowserCleanup(async () => {
    const limit = 100;
    const maxPages = 10;
    const seen = new Set<string>();
    let total = 0;
    for (let page = 1; page <= maxPages; page++) {
      const r = await searchOnce({ page, pageSize: limit });
      if (!r.ok) return { ok: false as const, source: SOURCE, post_id: id, message: r.message };
      total = r.result.total;
      const found = r.result.rawJobs.find((p) => String(p.id) === id);
      if (found) {
        const summary = summarize(found);
        return {
          ok: true as const,
          source: SOURCE,
          post_id: id,
          title: found.title ?? "",
          project: summary.project,
          recruit_label: summary.recruit_label,
          description: found.description ?? "",
          requirements: found.requirement ?? "",
          work_cities: found.city_list ?? (found.city_info ? [found.city_info] : []),
          apply_url: summary.apply_url,
        };
      }
      let added = 0;
      for (const p of r.result.rawJobs) {
        const pid = String(p.id ?? "");
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          added += 1;
        }
      }
      if (r.result.rawJobs.length < limit || seen.size >= total || added === 0) break;
    }
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `post ${id} not found among ${total} open positions on the full portal feed (scanned ${seen.size})`,
    };
  });
}

// fetchDictionaries: synthesize from one full-size page of results.

let _dictCache:
  | { ok: true; source: string; total: number; sample_categories: string[]; sample_cities: string[] }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_dictCache !== null) return _dictCache;
  return withBrowserCleanup(async () => {
    const r = await searchOnce({ pageSize: 100 });
    if (!r.ok) {
      const result = { ok: false as const, source: SOURCE, message: r.message };
      _dictCache = result;
      return result;
    }
    const cats = new Set<string>();
    const cities = new Set<string>();
    for (const j of r.result.rawJobs) {
      const name = j.job_category?.name ?? j.job_function?.name;
      if (name) cats.add(name);
      for (const c of j.city_list ?? []) if (c.name) cities.add(c.name);
      if (j.city_info?.name) cities.add(j.city_info.name);
    }
    const result = {
      ok: true as const,
      source: SOURCE,
      total: r.result.total,
      sample_categories: [...cats].sort(),
      sample_cities: [...cities].sort(),
    };
    _dictCache = result;
    return result;
  });
}

const NOTICES_MSG = "Lilith Games (莉莉丝): no public notices endpoint on Feishu tenant";

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: NOTICES_MSG, notices: [] as never[] };
}

export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: NOTICES_MSG, notice_id: noticeId };
}

export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return { ok: false as const, source: SOURCE, question, message: NOTICES_MSG, matches: [] as unknown[] };
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
      ok: false as const,
      source: SOURCE,
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }
  return withBrowserCleanup(async () => {
    const keyword = terms.slice(0, 3).join(" ");
    const r = await searchOnce({ keyword, pageSize: 100 });
    if (!r.ok) {
      return { ok: false as const, source: SOURCE, message: r.message, positions: [] };
    }
    type Scored = { score: number; position: PositionSummary; reasons: string[] };
    const scored: Scored[] = [];
    for (const raw of r.result.rawJobs) {
      const p = summarize(raw);
      const blob = [
        p.title,
        p.project,
        p.recruit_label,
        p.work_cities,
        raw.description ?? "",
        raw.requirement ?? "",
      ].join(" ");
      const { score, reasons } = scoreOverlap(blob, terms, cities);
      if (score > 0) scored.push({ score, position: p, reasons });
    }
    scored.sort((a, b) => b.score - a.score);
    let shortlist = scored.slice(0, Math.max(topN, candidates));
    if (!shortlist.length) {
      shortlist = r.result.positions
        .slice(0, candidates)
        .map((position) => ({ score: 0, position, reasons: [] }));
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
      source: SOURCE,
      extracted_terms: terms,
      city_preferences: cities,
      matches,
      note:
        "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
        "The only authority on selection is HR.",
    };
  });
}

export { extractResumeSignals, scoreOverlap };
