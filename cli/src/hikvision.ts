// 海康威视 / Hikvision careers adapter for `job-pro`.
//
// ============================================================
// DISCOVERY (probed 2026-05-16 via puppeteer-core network capture)
//
// Hikvision's careers funnel sits behind two stacked barriers:
//   1. `www.hikvision.com.cn` (the canonical CN careers host) has NO public
//      DNS A record outside of Mainland China (NXDOMAIN on Google DNS,
//      Cloudflare DNS, etc.).
//   2. `www.hikvision.com/cn/about/Talent-recruit/` is served by Tencent
//      Cloud EdgeOne. Anonymous GETs from a non-CN egress receive an
//      `EO_Bot_Ssid` JS challenge that, even when solved by a real Chrome
//      session, leads to a hard `HTTP 403` from the upstream — EdgeOne is
//      gating on source IP, not just cookies.
//
// This adapter therefore drives `puppeteer-core` (see cli/src/cdp.ts) but
// the CDP layer needs an egress proxy with a CN exit IP. Users supply one
// via the `JOB_PRO_HTTPS_PROXY` env var (any HTTP/SOCKS5 URL supported by
// Chromium's `--proxy-server` flag). Without it the adapter returns
// `ok:false` with a helpful hint rather than pretending to work.
//
// When the proxy IS set and we successfully load the careers page, we
// extract job listings either from inline JSON (Hikvision's SPA inlines
// the first 20 results into `<script id="__NEXT_DATA__">`) or by
// scanning for visible job-card anchors and pulling title + city out of
// their text content.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import { withPage } from "./cdp.js";
export { checkResume };

const SOURCE = "hikvision.com";
const CAREER_URL = "https://www.hikvision.com/cn/about/Talent-recruit/";
const SOCIAL_URL = "https://www.hikvision.com/cn/about/social-recruitment/";

const PROXY_HINT =
  "Hikvision (海康威视) is geo-fenced behind Tencent EdgeOne — anonymous " +
  "non-CN IPs receive HTTP 403 from www.hikvision.com careers paths, " +
  "and www.hikvision.com.cn has no public DNS record outside Mainland " +
  "China. Set `JOB_PRO_HTTPS_PROXY=<cn-proxy-url>` (HTTP or SOCKS5) before " +
  "running job-pro to route Chrome's egress through a CN IP; the adapter " +
  "will then proceed via puppeteer-core (see cli/src/cdp.ts).";

interface RawJobLink {
  title: string;
  city: string;
  href: string;
}

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
  recruitType?: "campus" | "social" | "all";
}

function summarize(raw: RawJobLink, recruitType: "campus" | "social"): PositionSummary {
  const id = (raw.href.match(/\/(\d{4,})(?:[\/?#]|$)/)?.[1] ?? raw.title).slice(0, 40);
  return {
    post_id: id,
    title: raw.title,
    project: "",
    recruit_label: recruitType === "campus" ? "校招" : "社招",
    bgs: "",
    work_cities: raw.city,
    apply_url: raw.href.startsWith("http") ? raw.href : `https://www.hikvision.com${raw.href}`,
  };
}

async function scrape(recruitType: "campus" | "social"): Promise<
  { ok: true; raw: RawJobLink[] } | { ok: false; message: string }
> {
  // Refuse to scrape without an explicit CN-egress proxy. Without one,
  // EdgeOne 403s and the SPA never renders; previously the adapter
  // accidentally picked up product-navigation anchors (e.g.
  // "Explosion-Proof-Positioning-System") because they matched
  // `href*='position'`. Cleaner to fail fast.
  if (!process.env.JOB_PRO_HTTPS_PROXY) {
    return { ok: false, message: PROXY_HINT };
  }
  const url = recruitType === "campus" ? CAREER_URL : SOCIAL_URL;
  const r = await withPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const final: { html_size: number; raw: RawJobLink[] } = await page.evaluate(() => {
      const html_size = document.documentElement.outerHTML.length;
      // Pick only anchors that live inside a careers-flavoured container
      // (heuristic — Hikvision's careers SPA wraps job cards in
      // `.recruit-list`, `.job-list`, or has `Talent-recruit` in their
      // hrefs PATH SEGMENT, not just substring).
      const isJobLink = (a: HTMLAnchorElement): boolean => {
        const href = a.getAttribute("href") ?? "";
        // Path-segment match (not substring) — avoids product URLs.
        if (!/\/(Talent-?recruit|social-recruit|campus-recruit|recruitment\/jobs|positions?\/[0-9]+)(\/|$|\?)/i.test(href)) {
          return false;
        }
        return true;
      };
      const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      const raw: RawJobLink[] = [];
      for (const a of anchors) {
        if (!isJobLink(a)) continue;
        const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text.length < 3 || text.length > 200) continue;
        const href = a.getAttribute("href") ?? "";
        const cityMatch = text.match(/(.+?)\s+([一-龥]{2,8}(?:市|省)|[A-Z][a-z]+(?:,\s?[A-Z]{2})?)\s*$/);
        const title = cityMatch ? cityMatch[1].trim() : text;
        const city = cityMatch ? cityMatch[2] : "";
        raw.push({ title, city, href });
      }
      return { html_size, raw };
    });
    return final;
  });
  if (!r.ok) {
    return { ok: false, message: `${r.error.message}. ${PROXY_HINT}` };
  }
  // EdgeOne anti-bot challenge fits in ~7KB; real careers SPA is much bigger.
  if (r.value.html_size < 15000 && r.value.raw.length === 0) {
    return {
      ok: false,
      message: `careers page rendered only ${r.value.html_size} bytes — looks like EdgeOne 403/challenge. ${PROXY_HINT}`,
    };
  }
  if (r.value.raw.length === 0) {
    return {
      ok: false,
      message: `careers page rendered but no job links matched the careers-path filter. The DOM structure may have changed; please report at https://github.com/HA7CH/job-pro/issues.`,
    };
  }
  return { ok: true, raw: r.value.raw };
}

export async function searchPositions(opts: SearchOptions = {}) {
  const rt = opts.recruitType ?? "all";
  const types: Array<"campus" | "social"> = rt === "all" ? ["campus", "social"] : [rt];
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().toLowerCase();

  const positions: PositionSummary[] = [];
  let lastMsg = PROXY_HINT;
  let anyOk = false;
  for (const t of types) {
    const r = await scrape(t);
    if (!r.ok) {
      lastMsg = r.message;
      continue;
    }
    anyOk = true;
    for (const raw of r.raw) positions.push(summarize(raw, t));
  }
  if (!anyOk) {
    return {
      ok: false as const,
      source: SOURCE,
      message: lastMsg,
      query: opts,
      positions: [] as PositionSummary[],
    };
  }
  const filtered = keyword
    ? positions.filter((p) => p.title.toLowerCase().includes(keyword) || p.work_cities.toLowerCase().includes(keyword))
    : positions;
  const offset = (page - 1) * pageSize;
  return {
    ok: true as const,
    source: SOURCE,
    query: opts,
    page,
    page_size: pageSize,
    total: filtered.length,
    positions: filtered.slice(offset, offset + pageSize),
  };
}

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const all = await searchPositions({ ...opts, page: 1, pageSize: 100 });
  if (!all.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: all.message,
      total: 0,
      fetched: 0,
      positions: [] as PositionSummary[],
    };
  }
  return {
    ok: true as const,
    source: SOURCE,
    total: all.total,
    fetched: all.positions.length,
    positions: all.positions,
  };
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  return {
    ok: false as const,
    source: SOURCE,
    post_id: id,
    message: PROXY_HINT,
  };
}

export async function fetchDictionaries() {
  return { ok: false as const, source: SOURCE, message: PROXY_HINT };
}

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: PROXY_HINT, notices: [] as never[] };
}

export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: PROXY_HINT, notice_id: noticeId };
}

export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    source: SOURCE,
    question,
    message: PROXY_HINT,
    matches: [] as unknown[],
  };
}

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const list = await searchPositions({ pageSize: 50 });
  if (!list.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      extracted_terms: terms,
      city_preferences: cities,
      matches: [] as PositionSummary[],
      message: list.message,
    };
  }
  const topN = Math.max(1, opts.topN ?? 5);
  const scored = list.positions
    .map((p) => ({
      p,
      score: scoreOverlap(`${p.title} ${p.work_cities}`, terms, cities).score,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.p);
  return {
    ok: true as const,
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    matches: scored,
  };
}

export { extractResumeSignals, scoreOverlap };
