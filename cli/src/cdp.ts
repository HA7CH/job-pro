// Headless-browser helper for adapters whose upstream is gated by anti-bot
// signatures that the CLI can't reproduce from raw HTTP.
//
// Usage pattern:
//   1. `await getBrowser()` returns a process-singleton puppeteer-core Browser
//      attached to the user's system Chrome.
//   2. Call `viaBrowser(url, async page => …)` to navigate and run a fn in
//      the page context, then receive the return value.
//
// Why puppeteer-core (not puppeteer): we attach to the user's existing
// Chrome installation; no 100MB Chromium download. Trade-off: we need a
// working Chrome executable path.
//
// Failure modes:
//   * puppeteer-core not installed → ENOENT on dynamic import → caller
//     receives `{ ok:false, reason:"puppeteer-not-installed", message: … }`
//     and renders it as the canonical ok:false stub.
//   * No Chrome found at any well-known path → same error shape with
//     `reason:"chrome-not-found"`.
//   * Browser launch failed (sandbox, profile lock, …) → `reason:"launch-failed"`.

import { existsSync } from "node:fs";

// puppeteer-core is imported dynamically so the bundle stays importable
// even when the dep is missing (e.g. user did `--omit=optional`).
export interface AnyCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  url?: string;
}
type AnyBrowser = {
  newPage: () => Promise<AnyPage>;
  close: () => Promise<void>;
  setCookie: (...cookies: AnyCookie[]) => Promise<void>;
};
type AnyResponse = {
  url: () => string;
  status: () => number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  request: () => { resourceType: () => string };
};
export type AnyPage = {
  setUserAgent: (ua: string) => Promise<void>;
  setExtraHTTPHeaders: (h: Record<string, string>) => Promise<void>;
  setCookie: (...cookies: AnyCookie[]) => Promise<void>;
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  url: () => string;
  evaluate: <T, A extends unknown[]>(fn: (...args: A) => T | Promise<T>, ...args: A) => Promise<T>;
  waitForResponse: (
    predicate: (r: AnyResponse) => boolean,
    opts?: { timeout?: number }
  ) => Promise<AnyResponse>;
  waitForSelector: (sel: string, opts?: { timeout?: number; visible?: boolean }) => Promise<{ uploadFile?: (...paths: string[]) => Promise<void>; click?: () => Promise<void> } | null>;
  type: (sel: string, text: string, opts?: { delay?: number }) => Promise<void>;
  click: (sel: string) => Promise<void>;
  $: (sel: string) => Promise<{ uploadFile?: (...paths: string[]) => Promise<void>; click?: () => Promise<void> } | null>;
  screenshot: (opts?: { path?: string; fullPage?: boolean }) => Promise<unknown>;
  close: () => Promise<void>;
};
export type { AnyBrowser };

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

export type CdpError =
  | { reason: "puppeteer-not-installed"; message: string }
  | { reason: "chrome-not-found"; message: string }
  | { reason: "launch-failed"; message: string };

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// ---------- singleton browser ----------

let _browser: AnyBrowser | null = null;
let _browserError: CdpError | null = null;
let _launching: Promise<AnyBrowser | CdpError> | null = null;

async function loadPuppeteer(): Promise<
  | { ok: true; mod: { launch: (opts: unknown) => Promise<AnyBrowser> } }
  | { ok: false; error: CdpError }
> {
  try {
    // Dynamic import; if puppeteer-core was tree-shaken or uninstalled,
    // this rejects with ERR_MODULE_NOT_FOUND.
    const mod = (await import("puppeteer-core")) as unknown as {
      default: { launch: (opts: unknown) => Promise<AnyBrowser> };
    };
    return { ok: true, mod: mod.default };
  } catch (err) {
    return {
      ok: false,
      error: {
        reason: "puppeteer-not-installed",
        message:
          "`puppeteer-core` is not installed. Install it locally with " +
          "`npm i puppeteer-core` (or `pnpm add puppeteer-core`). " +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

function findChrome(): string | null {
  if (process.env.JOB_PRO_CHROME && existsSync(process.env.JOB_PRO_CHROME)) {
    return process.env.JOB_PRO_CHROME;
  }
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function launchOnce(): Promise<AnyBrowser | CdpError> {
  const pp = await loadPuppeteer();
  if (!pp.ok) return pp.error;
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
  // Optional egress proxy — useful for geo-fenced upstreams (e.g. hikvision
  // requires a CN-egress to pass its Tencent EdgeOne 403 check). Set
  // `$JOB_PRO_HTTPS_PROXY=http://user:pass@host:port` or `socks5://host:port`.
  const proxy = process.env.JOB_PRO_HTTPS_PROXY?.trim();
  const proxyArg = proxy ? [`--proxy-server=${proxy}`] : [];
  try {
    const browser = await pp.mod.launch({
      executablePath: chrome,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        ...proxyArg,
      ],
    });
    return browser;
  } catch (err) {
    return {
      reason: "launch-failed",
      message: `Chrome failed to launch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Get a process-singleton headless browser. Subsequent calls reuse it. */
export async function getBrowser(): Promise<{ ok: true; browser: AnyBrowser } | { ok: false; error: CdpError }> {
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

/** Close the singleton browser (call before process exit). */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try {
      await _browser.close();
    } catch {
      /* ignore */
    }
    _browser = null;
  }
}

// On Node exit, best-effort close the browser to avoid zombie processes.
let _exitHookInstalled = false;
function ensureExitHook(): void {
  if (_exitHookInstalled) return;
  _exitHookInstalled = true;
  const cleanup = () => {
    if (_browser) {
      try {
        // synchronous best-effort kill; puppeteer launches Chrome as a child
        // process tracked by the Browser object, so close() handles SIGTERM.
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

/** Open a page, run fn against it, and close the page. The singleton browser stays open. */
export async function withPage<T>(
  fn: (page: AnyPage) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: CdpError }> {
  ensureExitHook();
  const b = await getBrowser();
  if (!b.ok) return b;
  let page: AnyPage | null = null;
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
        await page.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Inject a set of captured cookies (from extension/) into the singleton
 * browser, so the next withPage call navigates as the logged-in user.
 * Cookies are scoped to the host they were captured from.
 */
export async function injectCookies(
  cookies: Array<{ name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; sameSite?: string; expiresAt?: number }>,
  defaultHost: string
): Promise<{ ok: true } | { ok: false; error: CdpError }> {
  const b = await getBrowser();
  if (!b.ok) return b;
  const toInject: AnyCookie[] = [];
  for (const c of cookies) {
    if (!c.name || !c.value) continue;
    const domain = c.domain ?? defaultHost;
    toInject.push({
      name: c.name,
      value: c.value,
      domain,
      path: c.path ?? "/",
      secure: c.secure ?? true,
      httpOnly: c.httpOnly ?? false,
      sameSite: (c.sameSite ?? "Lax") as "Strict" | "Lax" | "None",
      expires: typeof c.expiresAt === "number" ? c.expiresAt : undefined,
    });
  }
  try {
    if (toInject.length > 0) await b.browser.setCookie(...toInject);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: {
        reason: "launch-failed",
        message: `cookie injection failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}
