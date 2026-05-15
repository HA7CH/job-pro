// Thin client for 旷视科技 / Megvii / Face++ recruiting portal at app.mokahr.com.
//
// ============================================================
// HOW THIS WORKS (probed 2026-05):
//
//   Moka social-recruitment SSR HTML at
//     https://app.mokahr.com/social-recruitment/megviihr/38641
//   embeds the entire first page of jobs INLINE in a hidden input
//   `<input id="init-data" value="<HTML-escaped JSON>">`. The JSON
//   shape is documented in the call helper below; the important keys are
//   `jobs[]` (first 15 entries) and `jobStats.total` (full count).
//
//   The same SSR HTML is also emitted for the campus portal at
//     https://app.mokahr.com/campus_apply/megviihr/38642
//
//   For deeper pagination the SPA POSTs to
//     /api/outer/ats-apply/website/jobs/v2?orgId=megviihr
//   with body { orgId, siteId, pageNum, pageSize, needStat:true } and
//   receives an AES-CBC encrypted envelope {data, necromancer}. We
//   decrypt using key=necromancer (raw utf8) and iv=aesIv (raw utf8,
//   served in the SSR HTML as a constant — observed value is the
//   same Moka-wide string across orgs).
//
// CONFIRMED MOKA ORG IDs:
//   Campus (校园招聘): orgSlug=megviihr, siteId=38642
//     URL: https://app.mokahr.com/campus_apply/megviihr/38642
//   Social  (社会招聘): orgSlug=megviihr, siteId=38641
//     URL: https://app.mokahr.com/social-recruitment/megviihr/38641
//
// PositionSummary field mapping (Moka raw → canonical):
//   post_id      ← job.id           (UUID, used as positionId in detail deeplink)
//   title        ← job.title
//   project      ← job.zhineng?.name (职位类别, e.g. "算法类", "职能类")
//   recruit_label ← job.commitment || hireMode-derived label
//   bgs          ← job.department?.name (部门)
//   work_cities  ← job.locations[].cityId resolved via jobsGroupedByLocation
//                  (concatenated with " / "); falls back to job.location.country
//   apply_url    ← portal URL + "#/jobs/{id}"

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import { createDecipheriv } from "node:crypto";
export { checkResume, extractResumeSignals, scoreOverlap };

const SOURCE = "app.mokahr.com/megviihr";
const ORG_SLUG = "megviihr";
const CAMPUS_SITE_ID = 38642;
const SOCIAL_SITE_ID = 38641;
const CAMPUS_URL = `https://app.mokahr.com/campus_apply/${ORG_SLUG}/${CAMPUS_SITE_ID}`;
const SOCIAL_URL = `https://app.mokahr.com/social-recruitment/${ORG_SLUG}/${SOCIAL_SITE_ID}`;
const API_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

// ---- PositionSummary (canonical shape) ----

export interface PositionSummary {
  post_id: string;
  title: string;
  /** 职位类别 (zhineng.name) */
  project: string;
  /** 招聘类型 / commitment (e.g. 全职 / 实习) */
  recruit_label: string;
  /** Department name */
  bgs: string;
  work_cities: string;
  apply_url: string;
}

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** "campus" = orgId 38642, "social" (default) = orgId 38641 */
  recruitType?: "campus" | "social";
}

// ---- raw Moka shapes ----

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

// ---- helpers ----

/** HTML-decode &quot; / &amp; / &lt; / &gt; / &#x27; */
function htmlDecode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

/** Parse the init-data JSON blob out of Moka SSR HTML. */
function parseInitData(html: string): MokaInitData | null {
  const m = html.match(/<input[^>]*id="init-data"[^>]*value="([^"]+)"/);
  if (!m) return null;
  try {
    return JSON.parse(htmlDecode(m[1])) as MokaInitData;
  } catch {
    return null;
  }
}

/** Fetch SSR HTML for a Moka portal URL with a fresh cookie jar in-memory. */
async function fetchPortalHtml(url: string): Promise<{
  ok: boolean;
  html?: string;
  cookieHeader?: string;
  status?: number;
  message: string;
}> {
  // Two-fetch dance: first request bounces with Set-Cookie + 302 to self;
  // we capture cookies and re-issue with them attached.
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: DEFAULT_HEADERS, redirect: "manual" });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  const cookies: string[] = [];
  // getSetCookie() must be called bound to the Headers object (Node undici brandCheck)
  const headersAny = response.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof headersAny.getSetCookie === "function") {
    for (const v of headersAny.getSetCookie.call(response.headers) ?? []) {
      const c = v.split(";")[0];
      if (c) cookies.push(c);
    }
  }
  // Some runtimes only expose combined header
  if (cookies.length === 0) {
    const raw = response.headers.get("set-cookie");
    if (raw) cookies.push(...raw.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0].trim()));
  }
  const cookieHeader = cookies.join("; ");

  // Now fetch with cookies (follow redirects automatically)
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
  if (!r2.ok) {
    return { ok: false, status: r2.status, message: `HTTP ${r2.status}` };
  }
  const html = await r2.text();
  return { ok: true, html, cookieHeader, status: r2.status, message: "ok" };
}

/** AES-128-CBC decrypt of Moka encrypted job payload. */
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

/** Fetch a deeper page via the encrypted POST endpoint. */
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

/** Build cityId → city label map from jobsGroupedByLocation. */
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

function summarize(job: MokaJob, cityMap: Record<number, string>, portalUrl: string): PositionSummary {
  return {
    post_id: String(job.id),
    title: job.title ?? "",
    project: job.zhineng?.name ?? "",
    recruit_label: commitmentFor(job),
    bgs: job.department?.name ?? "",
    work_cities: workCitiesFor(job, cityMap),
    apply_url: `${portalUrl}#/jobs/${encodeURIComponent(job.id)}`,
  };
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

function portalUrlFor(recruitType: "campus" | "social"): string {
  return recruitType === "campus" ? CAMPUS_URL : SOCIAL_URL;
}

function siteIdFor(recruitType: "campus" | "social"): number {
  return recruitType === "campus" ? CAMPUS_SITE_ID : SOCIAL_SITE_ID;
}

// ---- searchPositions ----

export async function searchPositions(opts: SearchOptions = {}) {
  const recruitType = opts.recruitType ?? "social";
  const portalUrl = portalUrlFor(recruitType);
  const pageSize = opts.pageSize ?? 20;
  const page = opts.page ?? 1;
  const keyword = opts.keyword ?? "";

  const portal = await fetchPortalHtml(portalUrl);
  if (!portal.ok || !portal.html) {
    return {
      ok: false as const,
      source: SOURCE,
      message: portal.message,
      query: { recruitType, keyword, page, pageSize },
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
      query: { recruitType, keyword, page, pageSize },
      positions: [] as PositionSummary[],
      total: 0,
    };
  }
  const cityMap = buildCityMap(init.jobsGroupedByLocation);
  let jobs = init.jobs;
  const total = init.jobStats.total ?? jobs.length;

  // If caller requested page > 1, fetch via encrypted POST
  if (page > 1 && init.aesIv && portal.cookieHeader) {
    const more = await fetchEncryptedPage(
      ORG_SLUG,
      siteIdFor(recruitType),
      page,
      pageSize,
      init.aesIv,
      portal.cookieHeader,
      portalUrl
    );
    if (!more.ok || !more.jobs) {
      return {
        ok: false as const,
        source: SOURCE,
        message: `pagination failed: ${more.message}`,
        query: { recruitType, keyword, page, pageSize },
        positions: [] as PositionSummary[],
        total,
      };
    }
    jobs = more.jobs;
  }

  // Client-side keyword filter — Moka server-side keyword on this endpoint
  // is observed to be ignored on first-page SSR, so we filter locally.
  const filtered = jobs.filter((j) => matchesKeyword(j, keyword));
  const sliced = filtered.slice(0, pageSize);
  const positions = sliced.map((j) => summarize(j, cityMap, portalUrl));

  return {
    ok: true as const,
    source: SOURCE,
    query: { recruitType, keyword, page, pageSize },
    page,
    page_size: pageSize,
    total,
    positions,
  };
}

// ---- fetchAllPositions ----

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const recruitType = opts.recruitType ?? "social";
  const portalUrl = portalUrlFor(recruitType);
  const pageSize = opts.pageSize ?? 20;
  const maxPages = Math.max(1, opts.maxPages ?? 50);
  const keyword = opts.keyword ?? "";

  const portal = await fetchPortalHtml(portalUrl);
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

  // Page 1 came from SSR; for subsequent pages use encrypted POST.
  // SSR returns ~15 per page; we cap with maxPages * pageSize.
  let page = 2;
  while (collected.length < total && page <= maxPages) {
    const more = await fetchEncryptedPage(
      ORG_SLUG,
      siteIdFor(recruitType),
      page,
      pageSize,
      init.aesIv,
      portal.cookieHeader ?? "",
      portalUrl
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
    positions: filtered.map((j) => summarize(j, cityMap, portalUrl)),
  };
}

// ---- fetchPositionDetail ----
//
// The Moka detail endpoint /api/outer/ats-apply/website/job is also AES-encrypted
// and requires a fresh session cookie. For now we return the deeplink + a
// note — keeping the verb honest rather than fake-successful.

export async function fetchPositionDetail(postId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message:
      "Moka detail endpoint /api/outer/ats-apply/website/job requires the same encrypted-session " +
      "flow; not implemented in this adapter. Use the apply_url deeplink for the full JD.",
    post_id: postId,
    apply_url: `${SOCIAL_URL}#/jobs/${encodeURIComponent(postId)}`,
  };
}

// ---- fetchDictionaries ----

export async function fetchDictionaries() {
  const portal = await fetchPortalHtml(SOCIAL_URL);
  if (!portal.ok || !portal.html) {
    return { ok: false as const, source: SOURCE, message: portal.message };
  }
  const init = parseInitData(portal.html);
  if (!init) {
    return { ok: false as const, source: SOURCE, message: "Moka init-data missing" };
  }
  return {
    ok: true as const,
    source: SOURCE,
    locations: init.jobsGroupedByLocation ?? [],
    moka_orgs: {
      campus: { slug: ORG_SLUG, id: CAMPUS_SITE_ID, url: CAMPUS_URL },
      social: { slug: ORG_SLUG, id: SOCIAL_SITE_ID, url: SOCIAL_URL },
    },
  };
}

// ---- notices (no public endpoint) ----

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: "Megvii (旷视): no public notices endpoint",
    notices: [] as Array<{
      id: number;
      title: string;
      publish_time: string;
      tag: string;
      detail_url: string;
    }>,
  };
}

export async function getNotice(noticeId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: "Megvii (旷视): no public notices endpoint",
    notice_id: noticeId,
  };
}

export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    source: SOURCE,
    question,
    message: "Megvii (旷视): no public notices endpoint",
    matches: [] as unknown[],
  };
}

// ---- matchResume ----

export async function matchResume(
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
