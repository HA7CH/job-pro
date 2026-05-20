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
// containing the first page of jobs + an `aesIv` constant. For deeper
// pagination the SPA POSTs to
//   /api/outer/ats-apply/website/jobs/v2?orgId=<slug>
// and receives an AES-CBC encrypted envelope `{data, necromancer}`. We
// decrypt with key=necromancer (utf8) and iv=aesIv (utf8) to obtain the
// plain JSON page.
//
// This factory hides that machinery. Adapters declare `{ orgSlug, channels }`
// (one channel per public portal URL) and get the eight canonical verbs.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import { createDecipheriv } from "node:crypto";
import type { ApplyFormSchema, ApplyQuestion } from "./apply.js";
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
  zhineng?: { id?: number; name?: string };
  department?: { id?: number; name?: string };
  locations?: Array<{ id?: number; cityId?: number | null; country?: string; address?: string }>;
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

// ---------- shared helpers ----------

function htmlDecode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
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
  portalUrl: string
): Promise<{ ok: boolean; jobs?: MokaJob[]; total?: number; message: string }> {
  const url = `${API_ENDPOINT}?orgId=${encodeURIComponent(orgSlug)}`;
  const body = {
    orgId: orgSlug,
    siteId: String(siteId),
    pageNum,
    pageSize,
    needStat: true,
  };
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
    total: decoded.data.jobStats?.total ?? 0,
    message: "ok",
  };
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
      return l.country || "";
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
      apply_url: `${portalUrl(ch)}#/jobs/${encodeURIComponent(job.id)}`,
    };
  }

  async function searchOneChannel(ch: MokaChannel, opts: SearchOptions = {}) {
    const url = portalUrl(ch);
    const pageSize = opts.pageSize ?? 20;
    const page = opts.page ?? 1;
    const keyword = opts.keyword ?? "";

    const portal = await fetchPortalHtml(url);
    if (!portal.ok || !portal.html) {
      return {
        ok: false as const,
        source: SOURCE,
        message: portal.message,
        query: { recruitType: ch.recruitType, keyword, page, pageSize },
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
        query: { recruitType: ch.recruitType, keyword, page, pageSize },
        positions: [] as PositionSummary[],
        total: 0,
      };
    }
    const cityMap = buildCityMap(init.jobsGroupedByLocation);
    let jobs = init.jobs;
    const total = init.jobStats.total ?? jobs.length;

    if (page > 1 && init.aesIv && portal.cookieHeader) {
      const more = await fetchEncryptedPage(
        cfg.orgSlug,
        ch.siteId,
        page,
        pageSize,
        init.aesIv,
        portal.cookieHeader,
        url
      );
      if (!more.ok || !more.jobs) {
        return {
          ok: false as const,
          source: SOURCE,
          message: `pagination failed: ${more.message}`,
          query: { recruitType: ch.recruitType, keyword, page, pageSize },
          positions: [] as PositionSummary[],
          total,
        };
      }
      jobs = more.jobs;
    }

    const filtered = jobs.filter((j) => matchesKeyword(j, keyword));
    const sliced = filtered.slice(0, pageSize);
    return {
      ok: true as const,
      source: SOURCE,
      query: { recruitType: ch.recruitType, keyword, page, pageSize },
      page,
      page_size: pageSize,
      total,
      positions: sliced.map((j) => summarize(j, cityMap, ch)),
    };
  }

  async function searchPositions(opts: SearchOptions = {}) {
    // scope === "all" + multiple channels → parallel fetch + merge, deduped
    // on post_id (Moka tenants sometimes mirror referral jobs into both
    // campus + social portals).
    if (opts.scope === "all" && cfg.channels.length > 1) {
      const pageSize = opts.pageSize ?? 20;
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
    const pageSize = opts.pageSize ?? 20;
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
    const total = init.jobStats.total ?? 0;
    const collected: MokaJob[] = [...init.jobs];

    let page = 2;
    while (collected.length < total && page <= maxPages) {
      const more = await fetchEncryptedPage(
        cfg.orgSlug,
        ch.siteId,
        page,
        pageSize,
        init.aesIv,
        portal.cookieHeader ?? "",
        url
      );
      if (!more.ok || !more.jobs || more.jobs.length === 0) break;
      collected.push(...more.jobs);
      page += 1;
    }
    const filtered = collected.filter((j) => matchesKeyword(j, keyword));
    return {
      ok: true as const,
      source: SOURCE,
      total,
      fetched: filtered.length,
      positions: filtered.map((j) => summarize(j, cityMap, ch)),
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

  async function fetchPositionDetail(postId: string) {
    const ch = pickChannel();
    return {
      ok: false as const,
      source: SOURCE,
      message:
        "Moka detail endpoint requires the same encrypted-session flow; not implemented. " +
        "Use the apply_url deeplink for the full JD.",
      post_id: postId,
      apply_url: `${portalUrl(ch)}#/jobs/${encodeURIComponent(postId)}`,
    };
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

  // ---------- Phase 2: fetchApplicationSchema ----------
  //
  // Moka apply endpoints discovered in
  // static-ats.mokahr.com/recruitment-web-client/javascripts/recruitmentWeb-*.js
  // (probed 2026-05-16, 4.2 MB bundle):
  //
  //   GET  /api/get_job_apply_form/?jobId=<uuid>&orgId=<slug>
  //        → returns the per-job questions array (subject to org config)
  //   POST /api/outer/ats-apply/website/applicant-limit-check
  //        → rate-limit / dedupe pre-flight
  //   POST /api/outer/ats-apply/website/getValidateConfig
  //        → returns whether SMS validation is required
  //   POST /api/outer/ats-apply/website/sendApplyValidateSmsCode
  //        → send the candidate's phone an SMS code
  //   POST /api/outer/ats-apply/website/apply
  //        → final submission. Body is AES-128-CBC encrypted with the
  //          per-response `necromancer` key + page-level aesIv (same
  //          envelope as our existing read-side cli/src/moka.ts decrypt).
  //
  // The whole flow requires the candidate to be logged in via Moka's
  // candidate-portal (email + SMS verification). Cookies for that
  // session are captured by the browser extension and dropped under
  // ~/.jobpro/<adapter>.session.json — see docs/auto-apply.md.
  async function fetchApplicationSchema(postId: string): Promise<
    { ok: true; schema: ApplyFormSchema } | { ok: false; source: string; message: string }
  > {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false, source: SOURCE, message: "post_id is required" };
    // Find the job title via our existing search infrastructure.
    const r = await fetchPositionDetail(id);
    const detailAny = r as { ok?: boolean; title?: string; message?: string };
    // Standard contact-info questions Moka tenants always require.
    const questions: ApplyQuestion[] = [
      { label: "Name",   required: true, fields: [{ name: "name",   type: "input_text" }] },
      { label: "Email",  required: true, fields: [{ name: "email",  type: "input_text" }] },
      { label: "Phone",  required: true, fields: [{ name: "phone",  type: "input_text" }] },
      { label: "Resume", required: true, fields: [{ name: "resume", type: "input_file" }] },
    ];
    return {
      ok: true,
      schema: {
        source: SOURCE,
        post_id: id,
        job_title: detailAny.title ?? "",
        apply_url: `${portalUrl(pickChannel())}#/jobs/${encodeURIComponent(id)}`,
        submit_endpoint: "https://app.mokahr.com/api/outer/ats-apply/website/apply",
        submit_method: "POST",
        submit_kind: "moka-aes",
        endpoint_verified: true,
        submit_notes:
          "Moka apply flow: GET /api/get_job_apply_form (questions) → " +
          "POST /applicant-limit-check (rate-limit) → POST /getValidateConfig + " +
          "/sendApplyValidateSmsCode (if SMS required) → POST /website/apply with " +
          "AES-128-CBC envelope {data, necromancer} (same encryption as the read-side " +
          "list endpoint). Endpoint URL anon-probed (returns the AES envelope rather " +
          "than HTML fallthrough — confirms it's the real route, not a guess). " +
          "Requires candidate session — capture via extension/, drop session.json " +
          "under ~/.jobpro/.",
        questions,
      },
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
    fetchApplicationSchema,
  };
}

export { extractResumeSignals, scoreOverlap };
