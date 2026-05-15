// 寒武纪 (Cambricon) careers adapter — Moka SSR + AES-128-CBC pagination.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16)
//
// www.cambricon.com (the corporate site) embeds links to Moka tenant URLs
// in its 加入我们 / careers section. Extracted slugs:
//
//   /campus-recruitment/cambricon/44201        ← campus + intern (main entry)
//   /recommendation-recruitment/cambricon/42452  (referral channel, overlaps)
//   /recommendation-recruitment/cambricon/46261  (referral channel, overlaps)
//
// No /social-recruitment/cambricon/<siteId> URL is published — Cambricon
// only opens 校招 / 实习 publicly through Moka. The campus SSR HTML embeds
// `<input id="init-data" value="{...}">` containing the full first page of
// jobs + aesIv for subsequent AES-CBC paginated calls. Same pattern as
// `cli/src/megvii.ts`; the heavy lifting (htmlDecode, parseInitData,
// fetchPortalHtml two-fetch cookie dance, decryptMokaEnvelope) is
// duplicated here for now — a shared `moka.ts` factory is worth refactoring
// to once we have 6+ Moka tenants (currently megvii/deepseek/galaxyuniversal/
// stepfun/moonshot/+cambricon = 6 → schedule for next pass).

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import { createDecipheriv } from "node:crypto";
export { checkResume, extractResumeSignals, scoreOverlap };

const SOURCE = "app.mokahr.com/cambricon";
const ORG_SLUG = "cambricon";
const CAMPUS_SITE_ID = 44201;
const CAMPUS_URL = `https://app.mokahr.com/campus-recruitment/${ORG_SLUG}/${CAMPUS_SITE_ID}`;
const API_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

// ---- PositionSummary ----

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

// ---- helpers (duplicated from megvii.ts — slated for moka.ts refactor) ----

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
  status?: number;
  message: string;
}> {
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
  if (!r2.ok) return { ok: false, status: r2.status, message: `HTTP ${r2.status}` };
  const html = await r2.text();
  return { ok: true, html, cookieHeader, status: r2.status, message: "ok" };
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
  pageNum: number,
  pageSize: number,
  aesIv: string,
  cookieHeader: string
): Promise<{ ok: boolean; jobs?: MokaJob[]; total?: number; message: string }> {
  const url = `${API_ENDPOINT}?orgId=${encodeURIComponent(ORG_SLUG)}`;
  const body = {
    orgId: ORG_SLUG,
    siteId: String(CAMPUS_SITE_ID),
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
        Referer: CAMPUS_URL,
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

function summarize(job: MokaJob, cityMap: Record<number, string>): PositionSummary {
  return {
    post_id: String(job.id),
    title: job.title ?? "",
    project: job.zhineng?.name ?? "",
    recruit_label: commitmentFor(job),
    bgs: job.department?.name ?? "",
    work_cities: workCitiesFor(job, cityMap),
    apply_url: `${CAMPUS_URL}#/jobs/${encodeURIComponent(job.id)}`,
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

// ---- searchPositions ----

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = opts.pageSize ?? 20;
  const page = opts.page ?? 1;
  const keyword = opts.keyword ?? "";

  const portal = await fetchPortalHtml(CAMPUS_URL);
  if (!portal.ok || !portal.html) {
    return {
      ok: false as const,
      source: SOURCE,
      message: portal.message,
      query: { keyword, page, pageSize },
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
      query: { keyword, page, pageSize },
      positions: [] as PositionSummary[],
      total: 0,
    };
  }
  const cityMap = buildCityMap(init.jobsGroupedByLocation);
  let jobs = init.jobs;
  const total = init.jobStats.total ?? jobs.length;

  if (page > 1 && init.aesIv && portal.cookieHeader) {
    const more = await fetchEncryptedPage(page, pageSize, init.aesIv, portal.cookieHeader);
    if (!more.ok || !more.jobs) {
      return {
        ok: false as const,
        source: SOURCE,
        message: `pagination failed: ${more.message}`,
        query: { keyword, page, pageSize },
        positions: [] as PositionSummary[],
        total,
      };
    }
    jobs = more.jobs;
  }

  const filtered = jobs.filter((j) => matchesKeyword(j, keyword));
  const sliced = filtered.slice(0, pageSize);
  const positions = sliced.map((j) => summarize(j, cityMap));

  return {
    ok: true as const,
    source: SOURCE,
    query: { keyword, page, pageSize },
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
  const pageSize = opts.pageSize ?? 20;
  const maxPages = Math.max(1, opts.maxPages ?? 50);
  const keyword = opts.keyword ?? "";

  const portal = await fetchPortalHtml(CAMPUS_URL);
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
    const more = await fetchEncryptedPage(page, pageSize, init.aesIv, portal.cookieHeader ?? "");
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
    positions: filtered.map((j) => summarize(j, cityMap)),
  };
}

// ---- fetchPositionDetail ----

export async function fetchPositionDetail(postId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message:
      "Moka detail endpoint requires the same encrypted-session flow; not implemented. " +
      "Use the apply_url deeplink for the full JD.",
    post_id: postId,
    apply_url: `${CAMPUS_URL}#/jobs/${encodeURIComponent(postId)}`,
  };
}

// ---- fetchDictionaries ----

export async function fetchDictionaries() {
  const portal = await fetchPortalHtml(CAMPUS_URL);
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
    moka_org: { slug: ORG_SLUG, id: CAMPUS_SITE_ID, url: CAMPUS_URL },
  };
}

// ---- notices (no public endpoint) ----

const NOTICES_STUB_MSG = "Cambricon (寒武纪): no public notices endpoint on Moka tenant";

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: NOTICES_STUB_MSG,
    notices: [] as never[],
  };
}

export async function getNotice(noticeId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: NOTICES_STUB_MSG,
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
    message: NOTICES_STUB_MSG,
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
