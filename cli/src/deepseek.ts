// DeepSeek (深度求索) / High-Flyer (幻方量化) recruiting via app.mokahr.com.
//
// ============================================================
// HOW THIS WORKS (probed 2026-05):
//
//   The SSR HTML at https://app.mokahr.com/social-recruitment/high-flyer/140576
//   embeds the first page of jobs in an `<input id="init-data">` blob.
//   `jobStats.total` is the canonical total count. Deeper pages come from
//   POST /api/outer/ats-apply/website/jobs/v2?orgId=high-flyer (AES-128-CBC
//   encrypted envelope; key=necromancer, iv=aesIv from init-data).
//
// CONFIRMED MOKA ORG:
//   slug=high-flyer, siteId=140576, mode=social
//   Portal: https://app.mokahr.com/social-recruitment/high-flyer/140576
//
// PositionSummary field mapping:
//   post_id       ← job.id
//   title         ← job.title
//   project       ← job.zhineng?.name
//   recruit_label ← job.commitment || hireMode label
//   bgs           ← job.department?.name
//   work_cities   ← locations[].cityId → label via jobsGroupedByLocation
//   apply_url     ← portal#/jobs/{id}

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import { createDecipheriv } from "node:crypto";
export { checkResume, extractResumeSignals, scoreOverlap };

const SOURCE = "app.mokahr.com/high-flyer";
const ORG_SLUG = "high-flyer";
const SITE_ID = 140576;
const PORTAL_URL = `https://app.mokahr.com/social-recruitment/${ORG_SLUG}/${SITE_ID}`;
const API_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

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

interface MokaJob {
  id: string;
  title: string;
  hireMode?: number;
  commitment?: string;
  zhineng?: { name?: string };
  department?: { name?: string };
  locations?: Array<{ cityId?: number | null; country?: string }>;
}
interface MokaLocationGroup {
  label?: string;
  cityId?: number | null;
}
interface MokaInitData {
  aesIv?: string;
  jobs?: MokaJob[];
  jobStats?: { total?: number };
  jobsGroupedByLocation?: MokaLocationGroup[];
}

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

async function fetchPortalHtml(): Promise<{
  ok: boolean;
  html?: string;
  cookieHeader?: string;
  message: string;
}> {
  let r1: Response;
  try {
    r1 = await fetch(PORTAL_URL, { method: "GET", headers: DEFAULT_HEADERS, redirect: "manual" });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  const cookies: string[] = [];
  // getSetCookie() must be called bound to the Headers object (Node undici brandCheck)
  const headersAny = r1.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof headersAny.getSetCookie === "function") {
    for (const v of headersAny.getSetCookie.call(r1.headers) ?? []) {
      const c = v.split(";")[0];
      if (c) cookies.push(c);
    }
  }
  if (cookies.length === 0) {
    const raw = r1.headers.get("set-cookie");
    if (raw) cookies.push(...raw.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0].trim()));
  }
  const cookieHeader = cookies.join("; ");
  let r2: Response;
  try {
    r2 = await fetch(PORTAL_URL, {
      method: "GET",
      headers: { ...DEFAULT_HEADERS, Cookie: cookieHeader },
      redirect: "follow",
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  if (!r2.ok) return { ok: false, message: `HTTP ${r2.status}` };
  return { ok: true, html: await r2.text(), cookieHeader, message: "ok" };
}

function decryptMoka(envelope: { data?: string; necromancer?: string }, aesIv: string): unknown {
  if (!envelope.data || !envelope.necromancer) return null;
  try {
    const decipher = createDecipheriv(
      "aes-128-cbc",
      Buffer.from(envelope.necromancer, "utf8"),
      Buffer.from(aesIv, "utf8")
    );
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
  let response: Response;
  try {
    response = await fetch(`${API_ENDPOINT}?orgId=${encodeURIComponent(ORG_SLUG)}`, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "application/json,*/*",
        "Content-Type": "application/json",
        Origin: "https://app.mokahr.com",
        Referer: PORTAL_URL,
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        orgId: ORG_SLUG,
        siteId: String(SITE_ID),
        pageNum,
        pageSize,
        needStat: true,
      }),
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
  let envelope: { data?: string; necromancer?: string; code?: number; msg?: string };
  try {
    envelope = await response.json();
  } catch {
    return { ok: false, message: "bad JSON" };
  }
  const decoded = decryptMoka(envelope, aesIv) as
    | { code?: number; data?: { jobs?: MokaJob[]; jobStats?: { total?: number } }; msg?: string }
    | null;
  if (!decoded || decoded.code !== 0 || !decoded.data) {
    return { ok: false, message: decoded?.msg || envelope.msg || "decrypt error" };
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

function workCities(job: MokaJob, cityMap: Record<number, string>): string {
  const uniq: string[] = [];
  for (const loc of job.locations ?? []) {
    const label =
      (typeof loc.cityId === "number" && cityMap[loc.cityId]) || loc.country || "";
    if (label && !uniq.includes(label)) uniq.push(label);
  }
  return uniq.join(" / ");
}

function recruitLabel(job: MokaJob): string {
  if (job.commitment) return job.commitment;
  if (job.hireMode === 1) return "全职";
  if (job.hireMode === 2) return "实习";
  return "";
}

function summarize(job: MokaJob, cityMap: Record<number, string>): PositionSummary {
  return {
    post_id: String(job.id),
    title: job.title ?? "",
    project: job.zhineng?.name ?? "",
    recruit_label: recruitLabel(job),
    bgs: job.department?.name ?? "",
    work_cities: workCities(job, cityMap),
    apply_url: `${PORTAL_URL}#/jobs/${encodeURIComponent(job.id)}`,
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

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = opts.pageSize ?? 20;
  const page = opts.page ?? 1;
  const keyword = opts.keyword ?? "";

  const portal = await fetchPortalHtml();
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
  const filtered = jobs.filter((j) => matchesKeyword(j, keyword)).slice(0, pageSize);
  return {
    ok: true as const,
    source: SOURCE,
    query: { keyword, page, pageSize },
    page,
    page_size: pageSize,
    total,
    positions: filtered.map((j) => summarize(j, cityMap)),
  };
}

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}
) {
  const pageSize = opts.pageSize ?? 20;
  const maxPages = Math.max(1, opts.maxPages ?? 50);
  const keyword = opts.keyword ?? "";

  const portal = await fetchPortalHtml();
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
      page,
      pageSize,
      init.aesIv,
      portal.cookieHeader ?? ""
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
    positions: filtered.map((j) => summarize(j, cityMap)),
  };
}

export async function fetchPositionDetail(postId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message:
      "Moka detail endpoint is also AES-encrypted and not implemented; " +
      "use the apply_url deeplink for the full JD.",
    post_id: postId,
    apply_url: `${PORTAL_URL}#/jobs/${encodeURIComponent(postId)}`,
  };
}

export async function fetchDictionaries() {
  const portal = await fetchPortalHtml();
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
    moka_org: { slug: ORG_SLUG, siteId: SITE_ID, url: PORTAL_URL },
  };
}

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: "DeepSeek: no public notices endpoint",
    notices: [] as never[],
  };
}

export async function getNotice(noticeId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: "DeepSeek: no public notices endpoint",
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
    message: "DeepSeek: no public notices endpoint",
    matches: [] as never[],
  };
}

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const candidates = Math.max(20, opts.candidates ?? 100);
  const all = await fetchAllPositions({
    pageSize: 20,
    maxPages: Math.ceil(candidates / 15),
  });
  if (!all.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      extracted_terms: terms,
      city_preferences: cities,
      matches: [] as PositionSummary[],
      message: all.message,
    };
  }
  const topN = Math.max(1, opts.topN ?? 10);
  const scored = all.positions
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
