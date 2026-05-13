// Thin client for Alibaba's public campus-recruiting API at campus-talent.alibaba.com.
//
// CSRF flow: the server issues XSRF-TOKEN via a GET to the campus listing page.
// Every subsequent POST must echo it as both a Cookie and an X-XSRF-TOKEN header.
// The module-level singleton caches the token on first use and retries once on 403.
//
// Endpoint inventory (all under https://campus-talent.alibaba.com):
//
//   GET  /campus/position                  — HTML page; sets XSRF-TOKEN cookie
//   POST /position/search                  — paginated job search
//   POST /position/detail                  — single job detail (body: {id: <number>})
//
// No public dictionary / notice endpoints were found; those exports are stubbed.
//
// DEFAULT BATCH SCOPE:
//   batchId 100000540002 = "阿里巴巴2027届实习生" (Alibaba 2027 class internships only).
//   All positions returned have categoryType: "internship" — this batch does NOT include
//   full-time new-grad (校招正式) roles. The batch name is embedded in each result's
//   batchName field. When a full-time new-grad batch opens it will have a different
//   batchId; pass --batch-id explicitly to target it.
//   As of 2026-05-13 the only other active batch is 100000560002 ("阿里巴巴日常实习生",
//   225 roles, categoryType: "project").
//
// CHANNEL NOTE:
//   The live site (window.__sysconfig.channelCodeMap.campus) now uses
//   "new_campus_group_official_site". Both channel values return identical counts
//   for batchId 100000540002 (474 total), so either works; the new name is canonical.
//
// PositionSummary field mapping (Alibaba → canonical):
//   post_id        ← String(item.id)                (numeric, e.g. 199903220038)
//   title          ← item.name
//   project        ← item.categoryName ?? ""         (e.g. "技术类")
//   recruit_label  ← item.categoryType ?? ""         (e.g. "internship")
//   bgs            ← item.circleNames?.[0] ?? ""     (BU / group name)
//   work_cities    ← item.workLocations.join(" / ")
//   apply_url      ← https://campus-talent.alibaba.com/campus/positionDetail?positionId=<id>

import { extractResumeSignals, scoreOverlap } from "./tencent.js";
export { extractResumeSignals, scoreOverlap };

const API_ROOT = "https://campus-talent.alibaba.com";
const CAMPUS_PAGE = `${API_ROOT}/campus/position`;
const DETAIL_PAGE = (id: string | number) =>
  `${API_ROOT}/campus/position/${encodeURIComponent(String(id))}`;

const DEFAULT_BATCH_ID = 100000540002;
const DEFAULT_CHANNEL = "new_campus_group_official_site";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---------- CSRF singleton ----------

interface CsrfState {
  token: string;
  session: string;
}

let csrfCache: CsrfState | null = null;

async function acquireCsrf(): Promise<CsrfState | null> {
  let response: Response;
  try {
    response = await fetch(CAMPUS_PAGE, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    return null;
  }
  if (!response.ok) return null;

  // Node fetch exposes Set-Cookie via getSetCookie() (Node 18+) or headers.raw()
  let setCookieHeaders: string[] = [];
  const rawHeaders = (response.headers as unknown as { raw?: () => Record<string, string[]> }).raw;
  if (typeof rawHeaders === "function") {
    const raw = rawHeaders.call(response.headers);
    setCookieHeaders = raw["set-cookie"] ?? [];
  } else if (typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function") {
    setCookieHeaders = (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }

  let token = "";
  let session = "";
  for (const hdr of setCookieHeaders) {
    const nameVal = hdr.split(";")[0].trim();
    const [name, val] = nameVal.split("=").map((s) => s.trim());
    if (name === "XSRF-TOKEN" && val) token = val;
    if (name === "SESSION" && val) session = val;
  }
  if (!token) return null;
  return { token, session };
}

async function getCsrf(force = false): Promise<CsrfState | null> {
  if (!force && csrfCache) return csrfCache;
  const state = await acquireCsrf();
  if (state) csrfCache = state;
  return state ?? null;
}

// ---------- core HTTP helper ----------

interface AliEnvelope<T> {
  success?: boolean;
  errorMsg?: string | null;
  errorCode?: string | null;
  content?: T;
}

async function call<T>(
  path: string,
  body: unknown,
  retried = false
): Promise<{ ok: boolean; data?: T; message: string }> {
  const csrf = await getCsrf();
  if (!csrf) {
    return { ok: false, message: "failed to acquire CSRF token from Alibaba" };
  }

  const cookieStr = `XSRF-TOKEN=${csrf.token}${csrf.session ? `; SESSION=${csrf.session}` : ""}`;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Content-Type": "application/json",
    Accept: "application/json",
    Referer: CAMPUS_PAGE,
    "X-XSRF-TOKEN": csrf.token,
    Cookie: cookieStr,
  };

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (response.status === 403 && !retried) {
    csrfCache = null;
    return call<T>(path, body, true);
  }

  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }

  let payload: AliEnvelope<T>;
  try {
    payload = (await response.json()) as AliEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  if (payload.success === false) {
    return {
      ok: false,
      message: payload.errorMsg || payload.errorCode || "upstream returned success=false",
    };
  }

  return {
    ok: true,
    data: payload.content,
    message: "ok",
  };
}

// ---------- raw shapes ----------

interface RawPosition {
  id?: number | string;
  name?: string;
  status?: string;
  description?: string;
  requirement?: string;
  workLocations?: string[];
  interviewLocations?: string[];
  categoryName?: string;
  categoryType?: string;
  circleNames?: string[];
  batchName?: string;
  batchId?: number;
  department?: string | null;
  project?: string | null;
  positionType?: string | null;
}

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

function summarizePosition(item: RawPosition): PositionSummary {
  const id = String(item.id ?? "");
  return {
    post_id: id,
    title: item.name ?? "",
    project: item.categoryName ?? "",
    recruit_label: item.categoryType ?? "",
    bgs: (item.circleNames ?? [])[0] ?? "",
    work_cities: (item.workLocations ?? []).join(" / "),
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// ---------- search ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  batchId?: number;
}

interface SearchContent {
  datas?: RawPosition[];
  totalCount?: number;
}

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const batchId = opts.batchId ?? DEFAULT_BATCH_ID;

  const body = {
    batchId,
    pageIndex: page,
    pageSize,
    channel: DEFAULT_CHANNEL,
    language: "zh",
    keyword,
  };

  const response = await call<SearchContent>("/position/search", body);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      source: "campus-talent.alibaba.com",
      message: response.message,
      query: body,
      page,
      page_size: pageSize,
      total: 0,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.datas ?? [];
  return {
    ok: true as const,
    source: "campus-talent.alibaba.com",
    query: body,
    page,
    page_size: pageSize,
    total: response.data.totalCount ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetch all ----------

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number; batchId?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 20);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
      batchId: opts.batchId,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        source: "campus-talent.alibaba.com",
        message: (result as { message?: string }).message ?? "search failed",
        fetched: bucket.length,
        positions: bucket,
      };
    }
    if (total === undefined) total = result.total;
    if (!result.positions.length) break;
    bucket.push(...result.positions);
    if (total !== undefined && bucket.length >= total) break;
  }

  return {
    ok: true as const,
    source: "campus-talent.alibaba.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- position detail ----------

export async function fetchPositionDetail(postId: string | number) {
  const id = String(postId ?? "").trim();
  if (!id) return { ok: false as const, message: "post_id is required" };

  const numId = Number(id);
  const body = { id: Number.isNaN(numId) ? id : numId };

  const response = await call<RawPosition>("/position/detail", body);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      source: "campus-talent.alibaba.com",
      message: response.message || "no detail returned",
      post_id: id,
    };
  }

  const raw = response.data;
  return {
    ok: true as const,
    source: "campus-talent.alibaba.com",
    post_id: String(raw.id ?? id),
    title: raw.name ?? "",
    direction: raw.categoryName ?? "",
    description: (raw.description ?? "").trim(),
    requirements: (raw.requirement ?? "").trim(),
    work_cities: raw.workLocations ?? [],
    recruit_cities: raw.interviewLocations ?? [],
    bgs: (raw.circleNames ?? [])[0] ?? "",
    batch_name: raw.batchName ?? "",
    apply_url: DETAIL_PAGE(raw.id ?? id),
  };
}

// ---------- stubs for missing public endpoints ----------

export async function fetchDictionaries() {
  return {
    ok: false as const,
    message: "Alibaba: no public dictionary endpoint",
  };
}

export async function listNotices() {
  return {
    ok: false as const,
    message: "Alibaba: no public notices endpoint",
  };
}

export async function getNotice(_id: string) {
  return {
    ok: false as const,
    message: "Alibaba: no public notice detail endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    message: "Alibaba: no public notices endpoint",
    matches: [],
  };
}

// ---------- resume matching ----------

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
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
  if (!list.ok) {
    return {
      ok: false as const,
      message: (list as { message?: string }).message ?? "search failed",
      positions: [],
    };
  }

  type Pre = { score: number; position: PositionSummary; reasons: string[] };
  const pre: Pre[] = [];
  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.bgs, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) pre.push({ score, position: p, reasons });
  }
  pre.sort((a, b) => b.score - a.score);

  let shortlist = pre.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = list.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  type Enriched = {
    score: number;
    row: PositionSummary & {
      direction?: string;
      description?: string;
      requirements?: string;
      match_reasons: string[];
    };
  };
  const enriched: Enriched[] = [];
  for (const { score: baseScore, position, reasons: baseReasons } of shortlist.slice(0, candidates)) {
    const detail = await fetchPositionDetail(position.post_id);
    if (!detail.ok) continue;
    const jdBlob = [
      detail.title,
      detail.direction,
      detail.description,
      detail.requirements,
      (detail.work_cities ?? []).join(" "),
    ].join(" ");
    const { score: extraScore, reasons: extraReasons } = scoreOverlap(jdBlob, terms, cities);
    const combined = [...new Set([...baseReasons, ...extraReasons])].slice(0, 5);
    if (!combined.length)
      combined.push("no specific keyword overlap — surfaced from initial keyword search");
    enriched.push({
      score: baseScore + extraScore,
      row: {
        ...position,
        direction: detail.direction,
        description: detail.description,
        requirements: detail.requirements,
        match_reasons: combined,
      },
    });
  }
  enriched.sort((a, b) => b.score - a.score);

  return {
    ok: true as const,
    source: "campus-talent.alibaba.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches: enriched.slice(0, topN).map((e) => e.row),
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
