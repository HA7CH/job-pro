// 莉莉丝游戏 (Lilith Games) careers adapter — Feishu portal_type=6 via CDP.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16)
//
// Lilith's careers feed is hosted at `lilithgames.jobs.feishu.cn` (Feishu
//招聘 / ATSX). It looks like a standard Feishu tenant on the surface, BUT
// the `/api/v1/search/job/posts` POST is rejected with `HTTP 405` from
// ByteDance Tengine for any anonymous caller — Lilith's tenant is one of
// the few that requires the in-browser `_signature` anti-bot token. The
// signature is computed by `verifycenter` (`lf-cdn-tos.bytescm.com/.../rc-verifycenter`)
// at runtime and appended to the URL query string + headers; it's
// session-bound and short-lived.
//
// Reverse-engineering verifycenter is non-trivial. We work around it by
// using `puppeteer-core` to drive the user's real Chrome (see cli/src/cdp.ts):
// navigate to the careers page, wait for the SPA's own `search/job/posts`
// XHR, and read the JSON straight off the network response. Same data
// shape as `cli/src/feishu.ts`, just sourced through a real browser.
//
// Probed 2026-05-16: portal_type=6, channel id 7055353811552127239, default
// limit=10. The career page filters by `location_code_list` query string;
// we pass through search options the same way.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import { withPage } from "./cdp.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Lilith Games supports all four scopes (1.1.0+).
 *
 * `lilithgames.jobs.feishu.cn` is a single-portal mixed Feishu tenant —
 * one `/career/` URL serves both 社招 and 校招/实习 posts side-by-side
 * (no separate `portal-channel` value to swap). The mixed feed cannot be
 * server-side filtered without the runtime-minted `_signature` token, so
 * the scope flag does not change the upstream call — the adapter returns
 * the same mixed feed regardless. Callers can filter the result client-
 * side on `recruit_label` if needed.
 *
 * Per the design doc's "single-portal mixed" recipe (§5 row 11): declare
 * all four scopes so the dispatcher does not reject any call; merge/filter
 * is the caller's responsibility.
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

const SOURCE = "lilithgames.jobs.feishu.cn";
const HOST = "https://lilithgames.jobs.feishu.cn";
const CAREER_PAGE = `${HOST}/career/`;
const DETAIL_PAGE = (id: string) => `${HOST}/career/${encodeURIComponent(id)}/detail`;

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
  /** Feishu location code (e.g. CT_11=北京, CT_22=成都, CT_75=旧金山). */
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
    "Lilith Games (莉莉丝): feishu portal_type=6 requires a browser-minted " +
    "`_signature` ByteDance anti-bot token. " +
    `Could not run the browser fallback: ${reason}. ` +
    "Install Google Chrome (or set $JOB_PRO_CHROME=/path/to/chrome) and " +
    "ensure puppeteer-core is installed (it ships with this CLI by default)."
  );
}

// ---------- core via CDP ----------

type SearchResult = {
  ok: true;
  total: number;
  positions: PositionSummary[];
  rawJobs: RawJobPost[];
};

async function searchViaBrowser(opts: SearchOptions): Promise<
  { ok: true; result: SearchResult } | { ok: false; message: string }
> {
  const limit = Math.max(1, Math.min(50, opts.pageSize ?? 10));
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const cityCode = (opts.cityCode ?? "").trim();

  // The career page URL itself drives the SPA's initial XHR with the
  // matching filters baked in. We construct a URL that yields the desired
  // search response without needing post-load interactions.
  const params = new URLSearchParams({
    keywords: keyword,
    location: cityCode,
    project: "",
    type: "",
    category: "",
    current: String(opts.page ?? 1),
    limit: String(limit),
    functionCategory: "",
  });
  const targetUrl = `${CAREER_PAGE}?${params.toString()}`;

  const r = await withPage(async (page) => {
    // We arm a response waiter BEFORE goto so we don't miss the XHR.
    // The Feishu SPA fires multiple identical XHRs (one for filters, one
    // for the actual search); we filter to the one that includes
    // `search/job/posts` in the URL AND has non-zero content-length.
    const responsePromise = page.waitForResponse(
      (resp) => {
        const u = resp.url();
        return resp.status() === 200 && /\/api\/v1\/search\/job\/posts/.test(u);
      },
      { timeout: 25000 }
    );
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const resp = await responsePromise;
    return (await resp.json()) as RawSearchEnvelope;
  });

  if (!r.ok) {
    return { ok: false, message: STUB_MESSAGE(r.error.message) };
  }
  const env = r.value;
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
  const r = await searchViaBrowser(opts);
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
    page_size: opts.pageSize ?? 10,
    total: r.result.total,
    positions: r.result.positions,
  };
}

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const limit = Math.max(1, Math.min(50, opts.pageSize ?? 30));
  const maxPages = Math.max(1, opts.maxPages ?? 20);
  const bucket: PositionSummary[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const r = await searchViaBrowser({ ...opts, page, pageSize: limit });
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
      break;
    }
    if (page === 1) total = r.result.total;
    if (!r.result.positions.length) break;
    bucket.push(...r.result.positions);
    if (bucket.length >= total) break;
  }
  return {
    ok: true as const,
    source: SOURCE,
    total,
    fetched: bucket.length,
    positions: bucket,
  };
}

// fetchPositionDetail: Feishu has no per-id REST endpoint; scan via search.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };
  const limit = 50;
  const maxPages = 10;
  for (let page = 1; page <= maxPages; page++) {
    const r = await searchViaBrowser({ page, pageSize: limit });
    if (!r.ok) return { ok: false as const, source: SOURCE, post_id: id, message: r.message };
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
    if (r.result.rawJobs.length < limit) break;
  }
  return {
    ok: false as const,
    source: SOURCE,
    post_id: id,
    message: `post ${id} not found in browser-driven search (scanned up to ${maxPages * limit} posts)`,
  };
}

// fetchDictionaries: synthesize from one page of results.

let _dictCache:
  | { ok: true; source: string; total: number; sample_categories: string[]; sample_cities: string[] }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_dictCache !== null) return _dictCache;
  const r = await searchViaBrowser({ pageSize: 50 });
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
  const keyword = terms.slice(0, 3).join(" ");
  const r = await searchViaBrowser({ keyword, pageSize: 50 });
  if (!r.ok) {
    return { ok: false as const, source: SOURCE, message: r.message, positions: [] };
  }
  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];
  for (const p of r.result.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = r.result.positions.slice(0, candidates).map((position) => ({ score: 0, position, reasons: [] }));
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
}

export { extractResumeSignals, scoreOverlap };


// ---------- Phase 2: fetchApplicationSchema ----------
import { makeFeishuApplyFn } from "./feishu.js";

export const fetchApplicationSchema = makeFeishuApplyFn({
  host: "lilithgames.jobs.feishu.cn",
  source: "lilithgames.jobs.feishu.cn",
  channel: "career",
  applyUrlPrefix: "https://lilithgames.jobs.feishu.cn/career/position",
  fetchTitle: (id) => fetchPositionDetail(id),
  submitKind: "cdp-real-browser",
});
