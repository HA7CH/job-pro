// Thin client for 宇树科技 (Unitree Robotics) campus recruiting.
//
// ============================================================
// API DISCOVERY (probed 2026-05)
//
// Infrastructure:
//   https://www.unitree.com/position/ (and /cn/position/) →
//     Nuxt 3 SPA that inlines all job listings in the server-rendered HTML.
//     The apiBase revealed in window.__NUXT__.config is:
//       https://api.unitree.com/website
//     with routes GET_JOB_LIST: "/job/list" and GET_JOB_DETAIL: "/job/info"
//     (found in /_nuxt/Cd6-Y0rS.js bundle, 2026-05).
//
// Dead ends probed:
//   career.unitree.com        — resolves to 198.18.x.x (IANA reserved / unreachable)
//   unitree.app.mokahr.com    — same IANA block; no Moka tenant
//   https://api.unitree.com/website/job/list (GET or POST, any headers) →
//     HTTP 567 "请求已被站点的安全策略拦截" from Tencent Cloud EdgeOne WAF.
//     The WAF blocks all non-browser clients regardless of UA/Referer/Origin spoofing.
//     The endpoint is real (the SPA uses it from a browser context) but is entirely
//     inaccessible to server-side HTTP clients.
//
// WORKING APPROACH — parse SSR HTML from www.unitree.com/position/:
//   The Nuxt SPA is configured with ssr:false in its __NUXT_DATA__ state
//   (serverRendered:false), yet the site's CDN pre-renders the page HTML via
//   a build-time static pass. The full position list (typically ~20-25 jobs)
//   is embedded verbatim in the returned HTML, including job IDs, titles, city,
//   category, department, and hot/urgent flags.
//
//   HTML job entry format (stripped from tags):
//     {Title}({JobCode}) 热招 [急招] {City} | {Category} | {Department} {JD text...}
//   Some newer listings omit the job code:
//     {Title} 热招 [急招] {City} | {Category} | {Department} {JD text...}
//
//   Job detail deep-links use SPA routing at /position/{JobCode} or /cn/position/{JobCode}.
//   These return 404 from the CDN (SPA-only routes) but are still the canonical apply URLs.
//
// ============================================================
// PositionSummary field mapping (canonical keys — matches all other adapters):
//   post_id       — job code (e.g. "J10034") or a slug derived from the title
//   title         — position title (Chinese)
//   project       — job category (e.g. "技术类" / "销售类")
//   recruit_label — "热招" / "热招|急招" / "" depending on status flags
//   bgs           — department (e.g. "研发部" / "销售服务体系")
//   work_cities   — work location (e.g. "杭州市")
//   apply_url     — deep link to the SPA position page
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "unitree.com";
const POSITION_PAGE = "https://www.unitree.com/position/";
const POSITION_PAGE_CN = "https://www.unitree.com/cn/position/";
const DETAIL_URL = (jobCode: string) =>
  `https://www.unitree.com/position/${encodeURIComponent(jobCode)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

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
}

// ---------- HTML parser ----------

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

function slugify(title: string): string {
  // Build a stable stub ID for un-coded listings
  return title
    .replace(/[^\w一-鿿]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function parsePositions(html: string): PositionSummary[] {
  const text = stripTags(html);
  const positions: PositionSummary[] = [];

  // ---- Pass 1: jobs with explicit job-code like (J10034) ----
  // Context before the (Jxxxxx) anchor is the title; after it are the status / city / category / dept.
  const idPattern = /\(J(\d+)\)/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((m = idPattern.exec(text)) !== null) {
    const jobCode = `J${m[1]}`;
    if (seen.has(jobCode)) continue;
    seen.add(jobCode);

    // Title: scan backwards from the match start for a Chinese/ASCII job title.
    // Titles immediately precede the job code in the stripped text.
    // Note: some titles include full-width parentheses, e.g. 嵌入式软件工程师（Linux）
    // so we must not treat （ as a hard word boundary.
    const beforeSlice = text.slice(Math.max(0, m.index - 140), m.index);
    // Take the last "word" cluster that looks like a job title.
    // Allow full-width （）inside the title but stop at half-width ( and common separators.
    const titleMatch = beforeSlice.match(
      /([A-Za-z+#（）一-鿿][^\s·|。；：(]{1,50}(?:\/[^\s|·。；：(]{2,20})?)\s*$/
    );
    const rawTitle = titleMatch ? titleMatch[1].trim() : "";
    // Strip any description text that bled in (heuristic: keep last segment after 。 or ；)
    const title = rawTitle.split(/[。；]\s*/).pop()?.trim() ?? rawTitle;

    // Status / city / category / dept: scan forward from end of job code
    const afterSlice = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const isHot = afterSlice.slice(0, 30).includes("热招");
    const isUrgent = afterSlice.slice(0, 30).includes("急招");

    const metaMatch = afterSlice.match(
      /([一-鿿]{2,6}市)\s*\|\s*([^|]{2,20}?)\s*\|\s*([^\s|·。]{2,30})/
    );
    const city = metaMatch ? metaMatch[1].trim() : "杭州市";
    const category = metaMatch ? metaMatch[2].trim() : "";
    const dept = metaMatch ? metaMatch[3].trim() : "";

    const recruitParts: string[] = [];
    if (isHot) recruitParts.push("热招");
    if (isUrgent) recruitParts.push("急招");
    const recruit_label = recruitParts.join("|");

    positions.push({
      post_id: jobCode,
      title: title || jobCode,
      project: category,
      recruit_label,
      bgs: dept,
      work_cities: city,
      apply_url: DETAIL_URL(jobCode),
    });
  }

  // ---- Pass 2: jobs without a (Jxxxxx) code ----
  // Pattern: ChineseTitle 热招 [急招] City | Category | Dept
  const noIdPattern =
    /([^\s·|：；。]{3,30}(?:工程师|设计师|经理|专员|研究员|架构师|科学家|运营|专家|分析师|顾问))\s+热招(?!\s*\()(\s*急招)?\s+([一-鿿]{2,6}市)\s*\|\s*([^|]{2,20}?)\s*\|\s*([^\s|·。]{2,30})/g;

  let m2: RegExpExecArray | null;
  while ((m2 = noIdPattern.exec(text)) !== null) {
    const title = m2[1].trim();
    const slug = slugify(title);
    if (seen.has(slug)) continue;
    seen.add(slug);

    const isUrgent = Boolean(m2[2]?.trim());
    const city = m2[3].trim();
    const category = m2[4].trim();
    const dept = m2[5].trim();
    const recruit_label = isUrgent ? "热招|急招" : "热招";

    positions.push({
      post_id: slug,
      title,
      project: category,
      recruit_label,
      bgs: dept,
      work_cities: city,
      apply_url: POSITION_PAGE,
    });
  }

  return positions;
}

// ---------- fetch helper ----------

async function fetchPositionHtml(): Promise<{
  ok: boolean;
  html?: string;
  message: string;
}> {
  let response: Response;
  try {
    response = await fetch(POSITION_PAGE, { headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }
  let html: string;
  try {
    html = await response.text();
  } catch (err) {
    return {
      ok: false,
      message: `body read error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, html, message: "ok" };
}

// ---------- In-process cache ----------
// The position list rarely changes; one fetch per Node process is enough.

let _posCache: { positions: PositionSummary[]; fetchedAt: number } | null = null;

async function getAllPositions(): Promise<{
  ok: boolean;
  positions: PositionSummary[];
  message: string;
  total: number;
}> {
  const now = Date.now();
  // Cache valid for 5 minutes
  if (_posCache && now - _posCache.fetchedAt < 5 * 60 * 1000) {
    return { ok: true, positions: _posCache.positions, message: "ok (cached)", total: _posCache.positions.length };
  }

  const result = await fetchPositionHtml();
  if (!result.ok || !result.html) {
    return { ok: false, positions: [], message: result.message, total: 0 };
  }

  const positions = parsePositions(result.html);
  _posCache = { positions, fetchedAt: now };
  return { ok: true, positions, message: "ok", total: positions.length };
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().toLowerCase();

  const pool = await getAllPositions();
  if (!pool.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: pool.message,
      apply_url: POSITION_PAGE,
      positions: [] as PositionSummary[],
    };
  }

  let filtered = pool.positions;
  if (keyword) {
    filtered = filtered.filter((p) => {
      const blob = [p.title, p.project, p.bgs, p.work_cities, p.post_id]
        .join(" ")
        .toLowerCase();
      return blob.includes(keyword);
    });
  }

  const offset = (page - 1) * pageSize;
  const paginated = filtered.slice(offset, offset + pageSize);

  return {
    ok: true as const,
    source: SOURCE,
    page,
    page_size: pageSize,
    total: filtered.length,
    positions: paginated,
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const keyword = (opts.keyword ?? "").trim().toLowerCase();
  const pool = await getAllPositions();
  if (!pool.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: pool.message,
      apply_url: POSITION_PAGE,
      fetched: 0,
      positions: [] as PositionSummary[],
    };
  }

  const positions = keyword
    ? pool.positions.filter((p) => {
        const blob = [p.title, p.project, p.bgs, p.work_cities, p.post_id]
          .join(" ")
          .toLowerCase();
        return blob.includes(keyword);
      })
    : pool.positions;

  return {
    ok: true as const,
    source: SOURCE,
    total: positions.length,
    fetched: positions.length,
    positions,
  };
}

// ---------- fetchPositionDetail ----------
// The SSR HTML contains the JD text for each position but does not expose it
// in a clean structured field. We extract a best-effort description snippet.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return { ok: false as const, source: SOURCE, message: "post_id is required" };
  }

  const result = await fetchPositionHtml();
  if (!result.ok || !result.html) {
    return { ok: false as const, source: SOURCE, post_id: id, message: result.message };
  }

  const text = stripTags(result.html);

  // Find the job code anchor or slug and extract surrounding JD text
  const anchor = id.startsWith("J") ? `(${id})` : id.replace(/-/g, "");
  const idx = text.indexOf(anchor);
  if (idx === -1) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `post ${id} not found in current page snapshot`,
    };
  }

  // Extract up to 600 chars of JD text following the city|category|dept line
  const after = text.slice(idx, idx + 800);
  const descMatch = after.match(
    /[一-鿿]{2,5}市\s*\|\s*[^|]+\|\s*[^\s|]+\s+(.{50,600})/
  );
  const description = descMatch ? descMatch[1].trim() : "";

  const pool = await getAllPositions();
  const pos = pool.positions.find((p) => p.post_id === id);

  return {
    ok: true as const,
    source: SOURCE,
    post_id: id,
    title: pos?.title ?? id,
    project: pos?.project ?? "",
    bgs: pos?.bgs ?? "",
    recruit_label: pos?.recruit_label ?? "",
    description,
    work_cities: pos?.work_cities ?? "",
    apply_url: pos?.apply_url ?? DETAIL_URL(id),
  };
}

// ---------- fetchDictionaries ----------
// Returns the known static taxonomy (Unitree does not expose a filter catalog).

export async function fetchDictionaries() {
  const pool = await getAllPositions();
  return {
    ok: pool.ok,
    source: SOURCE,
    scrape_url: POSITION_PAGE,
    note:
      "Unitree's ATS API (api.unitree.com/website) is protected by Tencent Cloud EdgeOne WAF " +
      "(HTTP 567) and is inaccessible from server-side clients. " +
      "Job listings are parsed from the SSR HTML of www.unitree.com/position/ instead.",
    positions_scraped: pool.total,
    categories: ["技术类", "销售类"],
    departments: ["研发部", "销售服务体系"],
    cities: ["杭州市"],
    message: pool.message,
  };
}

// ---------- notices (no public endpoint) ----------

const NOTICES_STUB = {
  ok: false as const,
  source: SOURCE,
  message: "Unitree: no public notices or announcement endpoint available",
};

export async function listNotices(): Promise<typeof NOTICES_STUB> {
  return NOTICES_STUB;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return NOTICES_STUB;
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return NOTICES_STUB;
}

// ---------- matchResume ----------
// Extract technical signals from resume text, filter the scraped position list,
// and return top N by keyword overlap score.

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

  const pool = await getAllPositions();
  if (!pool.ok) {
    return { ok: false as const, source: SOURCE, message: pool.message, positions: [] };
  }

  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];

  for (const p of pool.positions) {
    const blob = [p.title, p.project, p.bgs, p.work_cities, p.recruit_label].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = pool.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  const matches = shortlist.slice(0, topN).map((s) => {
    const mr =
      s.reasons.length > 0
        ? s.reasons.slice(0, 5)
        : ["no specific keyword overlap — surfaced from full position list"];
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
}

export { extractResumeSignals, scoreOverlap };
export type { SearchOptions as UnitreeSearchOptions };
