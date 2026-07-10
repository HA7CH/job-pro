// Generic Moka (北森外 — `app.mokahr.com` 招聘) adapter factory.
//
// Moka is a SaaS ATS used by many Chinese tech companies (Megvii, DeepSeek,
// Galaxy Universal, StepFun, Cambricon, Geely, …). Each tenant publishes a
// public portal at one of these URL shapes:
//
//   https://app.mokahr.com/campus-recruitment/<orgSlug>/<siteId>
//   https://app.mokahr.com/campus_apply/<orgSlug>/<siteId>
//   https://app.mokahr.com/social-recruitment/<orgSlug>/<siteId>
//   https://app.mokahr.com/recommendation-recruitment/<orgSlug>/<siteId>
//
// The SSR HTML always embeds an `<input id="init-data" value="<HTML-escaped JSON>">`
// containing the first jobs + an `aesIv` constant. The init-data list is
// only a prefix of the full board (e.g. high-flyer embeds 15 of 36 jobs),
// so the SPA POSTs to
//   /api/outer/ats-apply/website/jobs/v2?orgId=<slug>
// and receives an AES-CBC encrypted envelope `{data, necromancer}`. We
// decrypt with key=necromancer (utf8) and iv=aesIv (utf8) to obtain the
// plain JSON page. Body params (recovered from the SPA bundle
// recruitmentWeb-20260706-*.js, verified against high-flyer 2026-07-11):
// `limit` / `offset` (NOT pageNum/pageSize — those are silently ignored
// and the server falls back to limit=10 offset=0), plus optional
// `keyword` for server-side matching. `limit` is capped upstream: 50 is
// accepted, 100 returns code 102 参数错误. With `keyword` set,
// `jobStats.total` is the *filtered* count. Encrypted jobs carry
// `jobDescription` (the SSR init-data jobs do not).
//
// Single-job detail uses the SPA's
//   POST /api/outer/ats-apply/website/job  {orgId, siteId, jobId, locale}
// — same AES envelope, anonymous, returns the full job incl. description.
//
// This factory hides that machinery. Adapters declare `{ orgSlug, channels }`
// (one channel per public portal URL) and get the eight canonical verbs.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import { createDecipheriv } from "node:crypto";
import type { PositionScope } from "./adapter.js";
export { checkResume };
export type { PositionScope };

// ---------- adapter config ----------

export interface MokaChannel {
  /** Numeric site id from the URL (the `<siteId>` after the slug). */
  siteId: number;
  /** URL kind: campus-recruitment / campus_apply / social-recruitment. */
  kind: "campus-recruitment" | "campus_apply" | "social-recruitment" | "recommendation-recruitment";
  /** Recruit label for display: "campus" / "social" / "referral". */
  recruitType: "campus" | "social" | "referral";
}

export interface MokaAdapterConfig {
  /** Moka org slug — the `<orgSlug>` segment in the portal URL. */
  orgSlug: string;
  /** Human-readable label for source / error fields. */
  label: string;
  /** Public portals to merge into the unified job feed. */
  channels: MokaChannel[];
  /**
   * Default channel kind for matchResume / dictionaries when caller omits one.
   *
   * @deprecated Prefer `defaultScope` (the canonical CLI axis). Still honored
   * for 1.0.93 callers that pass `defaultRecruitType: "social" | "campus" |
   * "referral"`. When both are set, `defaultScope` wins.
   */
  defaultRecruitType?: "campus" | "social" | "referral";
  /**
   * Caller-side canonical scope used when no scope is supplied at call time.
   * One of `"social" | "campus" | "intern" | "all"`. Translated to a channel
   * via `pickChannelForScope`. If omitted, falls back to `defaultRecruitType`
   * (legacy) and finally to the first channel.
   */
  defaultScope?: PositionScope;
}

// ---------- raw Moka shapes ----------

interface MokaJob {
  id: string;
  title: string;
  hireMode?: number;
  commitment?: string;
  /** Present on jobs/v2 (encrypted) and /website/job responses; absent in SSR init-data. */
  jobDescription?: string;
  zhineng?: { id?: number; name?: string };
  department?: { id?: number; name?: string };
  locations?: Array<{
    id?: number;
    cityId?: number | null;
    cityName?: string;
    country?: string;
    address?: string;
  }>;
  location?: { id?: number; cityId?: number | null; country?: string };
}

interface MokaLocationGroup {
  id?: string;
  label?: string;
  cityId?: number | null;
  jobCount?: number;
}

interface MokaInitData {
  org?: { id?: string; siteId?: number; type?: string };
  siteId?: number;
  mode?: string;
  aesIv?: string;
  jobs?: MokaJob[];
  jobStats?: { orgId?: string; total?: number };
  jobsGroupedByLocation?: MokaLocationGroup[];
}

// ---------- canonical PositionSummary ----------

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
  /** "campus" / "social" / "referral" → routes to the matching channel.
   *  Omit to use the adapter's defaultRecruitType. */
  recruitType?: "campus" | "social" | "referral";
  /**
   * Canonical CLI scope axis. Overrides `recruitType` when set.
   * `"all"` triggers a parallel fetch across every configured channel and
   * merges the results (de-duplicated by `post_id`).
   */
  scope?: PositionScope;
}

// ---------- shared headers ----------

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const API_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
const DETAIL_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/job";

/** Upstream rejects limit > 50 with code 102 ("参数错误"). */
const MOKA_MAX_LIMIT = 50;

function clampPageSize(n: number): number {
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(MOKA_MAX_LIMIT, Math.floor(n)));
}

// ---------- shared helpers ----------

function htmlDecode(s: string): string {
  // `&amp;` must decode last: doing it first turns double-encoded text
  // (`&amp;lt;`) into `&lt;` and then a spurious `<`.
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseInitData(html: string): MokaInitData | null {
  const m = html.match(/<input[^>]*id="init-data"[^>]*value="([^"]+)"/);
  if (!m) return null;
  try {
    return JSON.parse(htmlDecode(m[1])) as MokaInitData;
  } catch {
    return null;
  }
}

async function fetchPortalHtml(url: string): Promise<{
  ok: boolean;
  html?: string;
  cookieHeader?: string;
  message: string;
}> {
  // Moka does a locale-cookie redirect dance: first request returns 302 +
  // Set-Cookie; we capture them, then re-issue.
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: DEFAULT_HEADERS, redirect: "manual" });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  const cookies: string[] = [];
  const headersAny = response.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof headersAny.getSetCookie === "function") {
    for (const v of headersAny.getSetCookie.call(response.headers) ?? []) {
      const c = v.split(";")[0];
      if (c) cookies.push(c);
    }
  }
  if (cookies.length === 0) {
    const raw = response.headers.get("set-cookie");
    if (raw) cookies.push(...raw.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0].trim()));
  }
  const cookieHeader = cookies.join("; ");

  let r2: Response;
  try {
    r2 = await fetch(url, {
      method: "GET",
      headers: { ...DEFAULT_HEADERS, Cookie: cookieHeader },
      redirect: "follow",
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  if (!r2.ok) return { ok: false, message: `HTTP ${r2.status}` };
  const html = await r2.text();
  return { ok: true, html, cookieHeader, message: "ok" };
}

function decryptMokaEnvelope(envelope: { data?: string; necromancer?: string }, aesIv: string): unknown {
  if (!envelope.data || !envelope.necromancer) return null;
  try {
    const key = Buffer.from(envelope.necromancer, "utf8");
    const iv = Buffer.from(aesIv, "utf8");
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

async function fetchEncryptedPage(
  orgSlug: string,
  siteId: number,
  pageNum: number,
  pageSize: number,
  aesIv: string,
  cookieHeader: string,
  portalUrl: string,
  keyword?: string
): Promise<{ ok: boolean; jobs?: MokaJob[]; total?: number; message: string }> {
  const url = `${API_ENDPOINT}?orgId=${encodeURIComponent(orgSlug)}`;
  const limit = clampPageSize(pageSize);
  const body: Record<string, unknown> = {
    orgId: orgSlug,
    siteId: String(siteId),
    limit,
    offset: (Math.max(1, pageNum) - 1) * limit,
    needStat: true,
    locale: "zh-CN",
  };
  if (keyword) body.keyword = keyword;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "application/json,*/*",
        "Content-Type": "application/json",
        Origin: "https://app.mokahr.com",
        Referer: portalUrl,
        Cookie: cookieHeader,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
  let envelope: { data?: string; necromancer?: string; code?: number; msg?: string };
  try {
    envelope = await response.json();
  } catch {
    return { ok: false, message: "bad JSON from upstream" };
  }
  const decoded = decryptMokaEnvelope(envelope, aesIv) as
    | { code?: number; data?: { jobs?: MokaJob[]; jobStats?: { total?: number } }; msg?: string }
    | null;
  if (!decoded || decoded.code !== 0 || !decoded.data) {
    return { ok: false, message: decoded?.msg || envelope?.msg || "decrypt or upstream error" };
  }
  return {
    ok: true,
    jobs: decoded.data.jobs ?? [],
    // Leave total undefined when jobStats is absent so callers can keep
    // their init-data board total instead of truncating sweeps at 0.
    total: decoded.data.jobStats?.total,
    message: "ok",
  };
}

/** Flatten Moka's rich-text jobDescription HTML into readable plain text. */
function htmlToText(html: string): string {
  return htmlDecode(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|td|th|ul|ol|section)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCityMap(groups: MokaLocationGroup[] | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  if (!groups) return out;
  for (const g of groups) {
    if (typeof g.cityId === "number" && g.label) out[g.cityId] = g.label;
  }
  return out;
}

function workCitiesFor(job: MokaJob, cityMap: Record<number, string>): string {
  const cities = (job.locations ?? [])
    .map((l) => {
      if (typeof l.cityId === "number" && cityMap[l.cityId]) return cityMap[l.cityId];
      return l.cityName || l.country || "";
    })
    .filter((s) => s.length > 0);
  const uniq: string[] = [];
  for (const c of cities) if (!uniq.includes(c)) uniq.push(c);
  return uniq.join(" / ");
}

function commitmentFor(job: MokaJob): string {
  if (typeof job.commitment === "string" && job.commitment.length > 0) return job.commitment;
  if (job.hireMode === 1) return "全职";
  if (job.hireMode === 2) return "实习";
  return "";
}

/**
 * Some tenants' jobs/v2 rows omit `locations` entirely (megvii, probed
 * 2026-07-11) while the SSR init-data record for the same job has them —
 * graft the SSR locations back so `work_cities` doesn't regress to "".
 */
function enrichFromSsr(job: MokaJob, ssrById: Map<string, MokaJob>): MokaJob {
  if (job.locations && job.locations.length > 0) return job;
  const ssr = ssrById.get(String(job.id));
  return ssr?.locations?.length ? { ...job, locations: ssr.locations } : job;
}

function matchesKeyword(job: MokaJob, kw: string): boolean {
  if (!kw) return true;
  const lc = kw.toLowerCase();
  return (
    (job.title ?? "").toLowerCase().includes(lc) ||
    (job.zhineng?.name ?? "").toLowerCase().includes(lc) ||
    (job.department?.name ?? "").toLowerCase().includes(lc)
  );
}

// ---------- createAdapter ----------

export function createAdapter(cfg: MokaAdapterConfig) {
  const SOURCE = `app.mokahr.com/${cfg.orgSlug}`;
  const portalUrl = (ch: MokaChannel) =>
    `https://app.mokahr.com/${ch.kind}/${cfg.orgSlug}/${ch.siteId}`;

  function pickChannel(recruitType?: SearchOptions["recruitType"]): MokaChannel {
    const want = recruitType ?? cfg.defaultRecruitType ?? "social";
    return cfg.channels.find((c) => c.recruitType === want) ?? cfg.channels[0];
  }

  /**
   * Translate a CLI-canonical `PositionScope` to the Moka channel that
   * fulfils it. `"social"` and `"campus"` map directly to a `recruitType`
   * value; `"intern"` has no native Moka channel (Moka folds interns into
   * the campus portal in every tenant we've seen), so we route it through
   * the campus channel and let the consumer filter by `hireMode === 2` if
   * needed. `"all"` is a sentinel handled by the caller (parallel merge
   * across every channel); for any callers that hand it here directly we
   * fall back to the first channel.
   *
   * Returns the first matching channel, or — if none matches — the default
   * channel (per `defaultScope` / `defaultRecruitType` / first entry).
   */
  function pickChannelForScope(s: PositionScope): MokaChannel {
    if (s === "social")
      return cfg.channels.find((c) => c.recruitType === "social") ?? defaultChannel();
    if (s === "campus" || s === "intern")
      return cfg.channels.find((c) => c.recruitType === "campus") ?? defaultChannel();
    // s === "all" — caller is expected to fan out; return default as a fallback.
    return defaultChannel();
  }

  function defaultChannel(): MokaChannel {
    if (cfg.defaultScope && cfg.defaultScope !== "all") {
      const want = cfg.defaultScope === "intern" ? "campus" : cfg.defaultScope;
      const hit = cfg.channels.find((c) => c.recruitType === want);
      if (hit) return hit;
    }
    if (cfg.defaultRecruitType) {
      const hit = cfg.channels.find((c) => c.recruitType === cfg.defaultRecruitType);
      if (hit) return hit;
    }
    return cfg.channels[0];
  }

  /**
   * Resolve the channel to query for a given options bag. `opts.scope` (CLI
   * canonical) wins over `opts.recruitType` (legacy per-adapter field). When
   * neither is set, falls back to the adapter's defaultScope /
   * defaultRecruitType / first channel — same precedence as `defaultChannel`.
   */
  function resolveChannel(opts: SearchOptions): MokaChannel {
    if (opts.scope && opts.scope !== "all") return pickChannelForScope(opts.scope);
    if (opts.recruitType) return pickChannel(opts.recruitType);
    return defaultChannel();
  }

  function summarize(job: MokaJob, cityMap: Record<number, string>, ch: MokaChannel): PositionSummary {
    return {
      post_id: String(job.id),
      title: job.title ?? "",
      project: job.zhineng?.name ?? "",
      recruit_label: commitmentFor(job),
      bgs: job.department?.name ?? "",
      work_cities: workCitiesFor(job, cityMap),
      apply_url: `${portalUrl(ch)}#/job/${encodeURIComponent(job.id)}`,
    };
  }

  async function searchOneChannel(ch: MokaChannel, opts: SearchOptions = {}) {
    const url = portalUrl(ch);
    const pageSize = clampPageSize(opts.pageSize ?? 20);
    const page = opts.page ?? 1;
    const keyword = opts.keyword ?? "";
    const query = { recruitType: ch.recruitType, keyword, page, pageSize };

    const portal = await fetchPortalHtml(url);
    if (!portal.ok || !portal.html) {
      return {
        ok: false as const,
        source: SOURCE,
        message: portal.message,
        query,
        positions: [] as PositionSummary[],
        total: 0,
      };
    }
    const init = parseInitData(portal.html);
    if (!init || !init.jobs || !init.jobStats) {
      return {
        ok: false as const,
        source: SOURCE,
        message: "Moka init-data missing jobs/jobStats",
        query,
        positions: [] as PositionSummary[],
        total: 0,
      };
    }
    const cityMap = buildCityMap(init.jobsGroupedByLocation);
    const total = init.jobStats.total ?? init.jobs.length;

    // The SSR init-data embeds only a prefix of the board (e.g. 15 of 36
    // jobs on high-flyer), so client-side filtering over it silently misses
    // positions. Prefer the encrypted jobs/v2 endpoint: server-side keyword
    // matching over the full board + real limit/offset pagination. With a
    // keyword its jobStats.total is the filtered count.
    if (init.aesIv) {
      const enc = await fetchEncryptedPage(
        cfg.orgSlug,
        ch.siteId,
        page,
        pageSize,
        init.aesIv,
        portal.cookieHeader ?? "",
        url,
        keyword
      );
      if (enc.ok && enc.jobs) {
        const ssrById = new Map(init.jobs.map((j) => [String(j.id), j]));
        return {
          ok: true as const,
          source: SOURCE,
          query,
          page,
          page_size: pageSize,
          total: enc.total ?? total,
          positions: enc.jobs.map((j) => summarize(enrichFromSsr(j, ssrById), cityMap, ch)),
        };
      }
      if (page > 1) {
        return {
          ok: false as const,
          source: SOURCE,
          message: `pagination failed: ${enc.message}`,
          query,
          positions: [] as PositionSummary[],
          total,
        };
      }
      // First page: degrade to the SSR prefix below rather than failing.
    } else if (page > 1) {
      return {
        ok: false as const,
        source: SOURCE,
        message: "pagination unavailable: Moka init-data missing aesIv",
        query,
        positions: [] as PositionSummary[],
        total,
      };
    }

    // Fallback (first page only): client-side filter over the SSR prefix.
    const filtered = init.jobs.filter((j) => matchesKeyword(j, keyword));
    return {
      ok: true as const,
      source: SOURCE,
      query,
      page,
      page_size: pageSize,
      total,
      positions: filtered.slice(0, pageSize).map((j) => summarize(j, cityMap, ch)),
    };
  }

  async function searchPositions(opts: SearchOptions = {}) {
    // scope === "all" + multiple channels → parallel fetch + merge, deduped
    // on post_id (Moka tenants sometimes mirror referral jobs into both
    // campus + social portals).
    if (opts.scope === "all" && cfg.channels.length > 1) {
      const pageSize = clampPageSize(opts.pageSize ?? 20);
      const page = opts.page ?? 1;
      const keyword = opts.keyword ?? "";
      const results = await Promise.all(
        cfg.channels.map((ch) => searchOneChannel(ch, opts))
      );
      const merged: PositionSummary[] = [];
      const seen = new Set<string>();
      let totalSum = 0;
      const errors: string[] = [];
      for (const r of results) {
        if (!r.ok) {
          errors.push(`${r.query.recruitType}: ${r.message}`);
          continue;
        }
        totalSum += r.total ?? 0;
        for (const p of r.positions) {
          if (seen.has(p.post_id)) continue;
          seen.add(p.post_id);
          merged.push(p);
        }
      }
      // All channels failed → return failure that surfaces the per-channel reasons.
      if (merged.length === 0 && errors.length === results.length) {
        return {
          ok: false as const,
          source: SOURCE,
          message: `all channels failed: ${errors.join("; ")}`,
          query: { recruitType: "all", keyword, page, pageSize },
          positions: [] as PositionSummary[],
          total: 0,
        };
      }
      return {
        ok: true as const,
        source: SOURCE,
        query: { recruitType: "all", keyword, page, pageSize },
        page,
        page_size: pageSize,
        total: totalSum,
        positions: merged.slice(0, pageSize),
      };
    }
    return searchOneChannel(resolveChannel(opts), opts);
  }

  async function fetchAllOneChannel(
    ch: MokaChannel,
    opts: SearchOptions & { maxPages?: number } = {}
  ) {
    const url = portalUrl(ch);
    const pageSize = clampPageSize(opts.pageSize ?? 20);
    const maxPages = Math.max(1, opts.maxPages ?? 50);
    const keyword = opts.keyword ?? "";

    const portal = await fetchPortalHtml(url);
    if (!portal.ok || !portal.html) {
      return {
        ok: false as const,
        source: SOURCE,
        message: portal.message,
        total: 0,
        fetched: 0,
        positions: [] as PositionSummary[],
      };
    }
    const init = parseInitData(portal.html);
    if (!init || !init.jobs || !init.jobStats || !init.aesIv) {
      return {
        ok: false as const,
        source: SOURCE,
        message: "Moka init-data missing required fields",
        total: 0,
        fetched: 0,
        positions: [] as PositionSummary[],
      };
    }
    const cityMap = buildCityMap(init.jobsGroupedByLocation);
    let total = init.jobStats.total ?? 0;

    // Sweep the encrypted jobs/v2 endpoint from offset 0 — the SSR init-data
    // is only a prefix of the board, and with a keyword the server matches
    // the full board for us. Dedupe by id and stop on a page that adds
    // nothing, so a tenant that ignores our offset can't loop us over
    // duplicates (the pre-1.1.15 pageNum/pageSize body triggered exactly
    // that: 15 unique jobs came back as 45 rows).
    const seen = new Set<string>();
    const collected: MokaJob[] = [];
    let page = 1;
    let firstPageError: string | null = null;
    while (page <= maxPages) {
      const more = await fetchEncryptedPage(
        cfg.orgSlug,
        ch.siteId,
        page,
        pageSize,
        init.aesIv,
        portal.cookieHeader ?? "",
        url,
        keyword
      );
      if (!more.ok || !more.jobs) {
        if (page === 1) firstPageError = more.message;
        break;
      }
      if (typeof more.total === "number") total = more.total;
      let added = 0;
      for (const j of more.jobs) {
        const id = String(j.id);
        if (seen.has(id)) continue;
        seen.add(id);
        collected.push(j);
        added += 1;
      }
      if (added === 0 || collected.length >= total || more.jobs.length < pageSize) break;
      page += 1;
    }

    if (collected.length === 0 && firstPageError) {
      // Encrypted endpoint down — degrade to the SSR prefix.
      const filtered = init.jobs.filter((j) => matchesKeyword(j, keyword));
      return {
        ok: true as const,
        source: SOURCE,
        total,
        fetched: filtered.length,
        positions: filtered.map((j) => summarize(j, cityMap, ch)),
      };
    }

    const ssrById = new Map(init.jobs.map((j) => [String(j.id), j]));
    return {
      ok: true as const,
      source: SOURCE,
      total,
      fetched: collected.length,
      positions: collected.map((j) => summarize(enrichFromSsr(j, ssrById), cityMap, ch)),
    };
  }

  async function fetchAllPositions(opts: SearchOptions & { maxPages?: number } = {}) {
    // scope === "all" + multiple channels → parallel fan-out, then merge +
    // dedupe by post_id. Mirrors the searchPositions branch.
    if (opts.scope === "all" && cfg.channels.length > 1) {
      const results = await Promise.all(
        cfg.channels.map((ch) => fetchAllOneChannel(ch, opts))
      );
      const merged: PositionSummary[] = [];
      const seen = new Set<string>();
      let totalSum = 0;
      const errors: string[] = [];
      for (const r of results) {
        if (!r.ok) {
          errors.push(r.message);
          continue;
        }
        totalSum += r.total ?? 0;
        for (const p of r.positions) {
          if (seen.has(p.post_id)) continue;
          seen.add(p.post_id);
          merged.push(p);
        }
      }
      if (merged.length === 0 && errors.length === results.length) {
        return {
          ok: false as const,
          source: SOURCE,
          message: `all channels failed: ${errors.join("; ")}`,
          total: 0,
          fetched: 0,
          positions: [] as PositionSummary[],
        };
      }
      return {
        ok: true as const,
        source: SOURCE,
        total: totalSum,
        fetched: merged.length,
        positions: merged,
      };
    }
    return fetchAllOneChannel(resolveChannel(opts), opts);
  }

  /** One /website/job probe against one channel's siteId + portal context. */
  async function detailViaChannel(ch: MokaChannel, id: string) {
    const url = portalUrl(ch);
    const applyUrl = `${url}#/job/${encodeURIComponent(id)}`;
    const fail = (message: string) => ({
      ok: false as const,
      source: SOURCE,
      message,
      post_id: id,
      apply_url: applyUrl,
    });

    // The portal page supplies the AES IV + locale cookies the detail
    // endpoint needs; the endpoint itself is anonymous.
    const portal = await fetchPortalHtml(url);
    if (!portal.ok || !portal.html) return fail(portal.message);
    const init = parseInitData(portal.html);
    if (!init?.aesIv) return fail("Moka init-data missing aesIv");

    let response: Response;
    try {
      response = await fetch(`${DETAIL_ENDPOINT}?orgId=${encodeURIComponent(cfg.orgSlug)}`, {
        method: "POST",
        headers: {
          ...DEFAULT_HEADERS,
          Accept: "application/json,*/*",
          "Content-Type": "application/json",
          Origin: "https://app.mokahr.com",
          Referer: url,
          Cookie: portal.cookieHeader ?? "",
        },
        body: JSON.stringify({
          orgId: cfg.orgSlug,
          siteId: String(ch.siteId),
          jobId: id,
          locale: "zh-CN",
        }),
      });
    } catch (err) {
      return fail(`network error: ${err instanceof Error ? err.message : err}`);
    }
    if (!response.ok) return fail(`HTTP ${response.status}`);
    let envelope: { data?: string; necromancer?: string; msg?: string };
    try {
      envelope = await response.json();
    } catch {
      return fail("bad JSON from upstream");
    }
    const decoded = decryptMokaEnvelope(envelope, init.aesIv) as {
      code?: number;
      data?: MokaJob & { job?: MokaJob };
      msg?: string;
    } | null;
    if (!decoded || decoded.code !== 0 || !decoded.data) {
      return fail(decoded?.msg || envelope?.msg || "decrypt or upstream error (job may not exist)");
    }
    // Some Moka responses nest the job under data.job; most return it flat.
    const job = decoded.data.job ?? decoded.data;
    if (!job.id) return fail("job not found");
    const cityMap = buildCityMap(init.jobsGroupedByLocation);
    return {
      ok: true as const,
      source: SOURCE,
      post_id: String(job.id),
      title: job.title ?? "",
      project: job.zhineng?.name ?? "",
      recruit_label: commitmentFor(job),
      bgs: job.department?.name ?? "",
      work_cities: workCitiesFor(job, cityMap),
      description: htmlToText(job.jobDescription ?? ""),
      apply_url: applyUrl,
    };
  }

  async function fetchPositionDetail(postId: string) {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };
    // Job ids are scoped to their channel's siteId upstream — probing the
    // wrong channel returns 703015 job-not-found (verified on megvii,
    // 2026-07-11) — so try the default channel first, then the rest.
    const first = defaultChannel();
    const channels = [first, ...cfg.channels.filter((c) => c !== first)];
    let firstFailure: Awaited<ReturnType<typeof detailViaChannel>> | null = null;
    for (const ch of channels) {
      const r = await detailViaChannel(ch, id);
      if (r.ok) return r;
      firstFailure ??= r;
    }
    // All channels failed — report the default channel's failure (its
    // apply_url is the tenant's primary portal).
    return firstFailure ?? { ok: false as const, source: SOURCE, message: "no channels configured" };
  }

  async function fetchDictionaries() {
    const ch = pickChannel();
    const url = portalUrl(ch);
    const portal = await fetchPortalHtml(url);
    if (!portal.ok || !portal.html) {
      return { ok: false as const, source: SOURCE, message: portal.message };
    }
    const init = parseInitData(portal.html);
    if (!init) return { ok: false as const, source: SOURCE, message: "Moka init-data missing" };
    return {
      ok: true as const,
      source: SOURCE,
      locations: init.jobsGroupedByLocation ?? [],
      moka_orgs: cfg.channels.map((c) => ({
        slug: cfg.orgSlug,
        id: c.siteId,
        url: portalUrl(c),
        recruitType: c.recruitType,
      })),
    };
  }

  const NOTICES_MSG = `${cfg.label}: no public notices endpoint on Moka tenant`;
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

  async function matchResume(
    text: string,
    opts: { topN?: number; candidates?: number } = {}
  ) {
    const { terms, cities } = extractResumeSignals(text ?? "");
    const candidates = Math.max(20, opts.candidates ?? 100);
    const search = await fetchAllPositions({
      pageSize: 20,
      maxPages: Math.ceil(candidates / 15),
    });
    if (!search.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        extracted_terms: terms,
        city_preferences: cities,
        matches: [] as PositionSummary[],
        message: search.message,
      };
    }
    const topN = Math.max(1, opts.topN ?? 10);
    const scored = search.positions
      .map((p) => ({
        p,
        score: scoreOverlap(`${p.title} ${p.project} ${p.bgs}`, terms, cities).score,
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

export { extractResumeSignals, scoreOverlap };
