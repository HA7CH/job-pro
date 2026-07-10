// Thin client for 宇树科技 (Unitree Robotics) campus recruiting.
//
// ============================================================
// API DISCOVERY (probed 2026-05, re-verified 2026-07)
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
//   a build-time static pass. The full position list (26 jobs as of 2026-07-11)
//   is embedded verbatim in the returned HTML, including numeric job ids, titles,
//   city, category, department, hot/urgent flags, and a JD preview per job.
//
//   Each job is one self-contained anchor block (verified 2026-07-11 against the
//   live page — 26 blocks, one per job, no other /position/<digits> links):
//     <a href="/position/<numericId>" ... class="link">
//       <p class="title">{Title}[({JobCode})] [<span class="icon hot">热招</span>]
//                        [<span class="icon urgent">急招</span>]</p>
//       <p class="base-info">{City} | {Category} | {Department}</p>
//       <div class="duty"><p>…JD lines…</p>…</div>
//     </a>
//   Parsing block-by-block (instead of regex-scanning the tag-stripped page text)
//   keeps every job regardless of title codepoints and bounds each JD at its own
//   entry — no bleed into neighbouring jobs or the page's product-catalog footer.
//
//   CODEPOINT QUIRK (dumped 2026-07-11): several newer titles/JDs mix Kangxi
//   Radical codepoints into otherwise-normal CJK text, e.g. 具⾝智能软件⼯程师
//   uses ⾝=U+2F9D and ⼯=U+2F2F instead of 身=U+8EAB / 工=U+5DE5. We NFKC-fold
//   those radical-block chars so titles/search behave like normal CJK
//   (see normalizeRadicals).
//
//   Job detail deep-links use SPA routing at /position/{numericId}. These return
//   404 from the CDN for non-browser clients (SPA-only routes) but are still the
//   canonical apply URLs.
//
// SEARCH SEMANTICS: the only server-side search would be api.unitree.com/website
// /job/list, which is WAF-blocked (HTTP 567, see above). Keyword filtering is
// therefore client-side over the bounded full enumeration — the single SSR page
// embeds every open position, so the filter runs over the complete corpus.
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
import type { PositionScope } from "./adapter.js";
export { checkResume };

// Unitree exposes a single mixed listing (social + campus interleaved).
// Cannot server-side filter by scope; declare all four so dispatcher
// accepts the flag and the adapter returns the same union regardless.
export const supportedScopes: ReadonlyArray<PositionScope> = ["social", "campus", "intern", "all"] as const;

const SOURCE = "unitree.com";
const POSITION_PAGE = "https://www.unitree.com/position/";
// Nuxt only mounts `/position/<numericSnowflakeId>` (e.g. /position/1569894802328125440).
// `/position/<JobCode>` (e.g. /position/J10126) returns HTTP 404. Each list-page
// anchor block carries the numeric id in its href, so every parsed job (with or
// without a visible JobCode) gets its canonical deep link.
const DETAIL_URL = (numericId: string) =>
  `https://www.unitree.com/position/${encodeURIComponent(numericId)}`;

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

// Internal parse result: summary + the JD preview text embedded in the block.
interface ParsedPosition extends PositionSummary {
  description: string;
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

// ---------- HTML / text helpers ----------

/**
 * Fold Kangxi Radical (U+2F00–U+2FDF) and CJK Radicals Supplement
 * (U+2E80–U+2EFF) codepoints to their CJK unified ideographs via NFKC.
 *
 * Measured on the live page 2026-07-11: 4 of 26 titles (具⾝智能软件⼯程师 /
 * 数据管线⼯程师 / AI Infra ⼯程师 / 具身数据评估⼯程师) and their JD text mix
 * radical codepoints (⼯=U+2F2F, ⾝=U+2F9D, ⼈=U+2F08 …) into normal CJK.
 * We deliberately normalize ONLY chars inside the two radical blocks — a
 * whole-string NFKC would also fold fullwidth parens （）→() and corrupt
 * titles like 嵌入式软件工程师（Linux）.
 */
function normalizeRadicals(s: string): string {
  return s.replace(/[\u2E80-\u2FDF]/g, (c) => c.normalize("NFKC"));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** Strip tags to a single collapsed line (titles / meta rows). */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

/** Strip tags to readable multi-line text (JD blocks): one line per <p>/<br>. */
function blockToText(html: string): string {
  const withBreaks = html.replace(/<\/p\s*>|<br\s*\/?>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function slugify(title: string): string {
  // Build a stable stub ID for un-coded listings
  return title
    .replace(/[^\w一-鿿]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ---------- HTML parser ----------

function parsePositions(html: string): ParsedPosition[] {
  // One match per job entry; the non-greedy body ends at the entry's own </a>,
  // so everything extracted below is bounded to a single job.
  const blockPattern = /<a[^>]*href="\/position\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  const positions: ParsedPosition[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = blockPattern.exec(html)) !== null) {
    const numericId = m[1];
    const block = m[2];

    const titleHtml =
      block.match(/<p[^>]*class="title"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    // The visible title precedes any status <span class="icon …"> badges.
    const rawTitle = normalizeRadicals(stripTags(titleHtml.split(/<span/i)[0])).trim();
    if (!rawTitle) continue;

    // Coded titles end with the visible JobCode, e.g. 解决方案工程师(J10126).
    const codeMatch = rawTitle.match(/\((J\d+)\)\s*$/);
    const title = codeMatch
      ? rawTitle.slice(0, codeMatch.index).trim()
      : rawTitle;
    const postId = codeMatch ? codeMatch[1] : slugify(title);
    if (!postId || seen.has(postId)) continue;
    seen.add(postId);

    const baseInfo = normalizeRadicals(
      stripTags(
        block.match(/<p[^>]*class="base-info"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ""
      )
    ).trim();
    const [city = "", category = "", dept = ""] = baseInfo
      .split("|")
      .map((part) => part.trim());

    const recruitParts: string[] = [];
    if (/class="icon hot"/.test(block)) recruitParts.push("热招");
    if (/class="icon urgent"/.test(block)) recruitParts.push("急招");

    // The duty <div> is the last element of the block (verified 2026-07-11);
    // capture from its opening tag to the end of the block — the </a> boundary
    // already guarantees no bleed into the next job or the page footer.
    const dutyHtml = block.match(/<div[^>]*class="duty"[^>]*>([\s\S]*)$/)?.[1] ?? "";
    const description = normalizeRadicals(blockToText(dutyHtml));

    positions.push({
      post_id: postId,
      title,
      project: category,
      recruit_label: recruitParts.join("|"),
      bgs: dept,
      work_cities: city,
      apply_url: DETAIL_URL(numericId),
      description,
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

let _posCache: { positions: ParsedPosition[]; fetchedAt: number } | null = null;

async function getAllPositions(): Promise<{
  ok: boolean;
  positions: ParsedPosition[];
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
  if (!positions.length) {
    // Fail loudly instead of reporting a misleading empty list: the page has
    // always embedded the full list (26 entries as of 2026-07-11), so zero
    // parsed blocks means the markup changed or we got a stub/WAF page.
    const hasTitleMarkup = /class="title"/.test(result.html);
    return {
      ok: false,
      positions: [],
      total: 0,
      message:
        `parsed 0 job blocks from ${POSITION_PAGE} (HTML ${result.html.length} bytes` +
        (hasTitleMarkup ? ", title markup present — parser/page mismatch" : "") +
        ") — refusing to report an empty list as a real zero",
    };
  }
  _posCache = { positions, fetchedAt: now };
  return { ok: true, positions, message: "ok", total: positions.length };
}

// ---------- keyword filter (client-side; see SEARCH SEMANTICS above) ----------

function keywordFilter(
  positions: ParsedPosition[],
  keyword: string
): ParsedPosition[] {
  if (!keyword) return positions;
  return positions.filter((p) => {
    const blob = [p.title, p.project, p.bgs, p.work_cities, p.post_id, p.description]
      .join(" ")
      .toLowerCase();
    return blob.includes(keyword);
  });
}

function toSummary(p: ParsedPosition): PositionSummary {
  const { description: _description, ...summary } = p;
  return summary;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  // Normalize the keyword the same way parsed text is normalized, so a query
  // containing a radical codepoint still matches the folded corpus.
  const keyword = normalizeRadicals((opts.keyword ?? "").trim()).toLowerCase();

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

  const filtered = keywordFilter(pool.positions, keyword);
  const offset = (page - 1) * pageSize;
  const paginated = filtered.slice(offset, offset + pageSize).map(toSummary);

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
// The single SSR page embeds the complete list, so "all" is always exhaustive
// (no pagination, no truncation) and post_id-deduped by the parser.

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const keyword = normalizeRadicals((opts.keyword ?? "").trim()).toLowerCase();
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

  const positions = keywordFilter(pool.positions, keyword).map(toSummary);

  return {
    ok: true as const,
    source: SOURCE,
    total: positions.length,
    fetched: positions.length,
    positions,
  };
}

// ---------- fetchPositionDetail ----------
// Returns the JD preview embedded in the position's own list-page block.
// KNOWN LIMITATION: the block only carries the 职责 (duty) section — the
// full-JD endpoint api.unitree.com/website/job/info is EdgeOne-WAF-blocked
// (HTTP 567), so a richer description is not reachable server-side.

const DETAIL_NOTE =
  "description is the JD preview embedded in the list page (职责 section only); " +
  "the full-JD API (api.unitree.com/website/job/info) is blocked by Tencent Cloud " +
  "EdgeOne WAF (HTTP 567) for non-browser clients.";

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return { ok: false as const, source: SOURCE, message: "post_id is required" };
  }

  const pool = await getAllPositions();
  if (!pool.ok) {
    return { ok: false as const, source: SOURCE, post_id: id, message: pool.message };
  }

  const needle = normalizeRadicals(id);
  const pos = pool.positions.find(
    (p) =>
      p.post_id === needle ||
      // also accept the numeric snowflake id from apply_url deep links
      (/^\d+$/.test(needle) && p.apply_url === DETAIL_URL(needle)) ||
      p.title === needle
  );
  if (!pos) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `post ${id} not found in current page snapshot (${pool.total} open positions)`,
    };
  }

  return {
    ok: true as const,
    source: SOURCE,
    post_id: pos.post_id,
    title: pos.title,
    project: pos.project,
    bgs: pos.bgs,
    recruit_label: pos.recruit_label,
    description: pos.description,
    work_cities: pos.work_cities,
    apply_url: pos.apply_url,
    note: DETAIL_NOTE,
  };
}

// ---------- fetchDictionaries ----------
// Unitree does not expose a filter catalog; derive the taxonomy from the
// scraped position list instead of hardcoding it.

export async function fetchDictionaries() {
  const pool = await getAllPositions();
  const uniq = (values: string[]) => [...new Set(values.filter(Boolean))];
  return {
    ok: pool.ok,
    source: SOURCE,
    scrape_url: POSITION_PAGE,
    note:
      "Unitree's ATS API (api.unitree.com/website) is protected by Tencent Cloud EdgeOne WAF " +
      "(HTTP 567) and is inaccessible from server-side clients. " +
      "Job listings are parsed from the SSR HTML of www.unitree.com/position/ instead.",
    positions_scraped: pool.total,
    categories: uniq(pool.positions.map((p) => p.project)),
    departments: uniq(pool.positions.map((p) => p.bgs)),
    cities: uniq(pool.positions.map((p) => p.work_cities)),
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
    // Score against the JD preview too — it carries the actual tech keywords.
    const blob = [p.title, p.project, p.bgs, p.work_cities, p.recruit_label, p.description].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: toSummary(p), reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = pool.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position: toSummary(position),
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
