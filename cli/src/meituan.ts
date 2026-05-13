// Thin client for Meituan's public recruiting API at zhaopin.meituan.com.
//
// All endpoints are unauthenticated; the server just checks Referer/Origin.
// Endpoint inventory:
//
//   POST /api/official/job/getJobList      — paginated job search
//   POST /api/official/job/getJobDetail    — single job detail by jobUnionId
//
// Response envelope: { status: 1, message: "成功", data: { ... } }
// NOTE: status === 1 (not 0) indicates success on this platform.
//
// jobType codes (verified 2026-05-13):
//   "1" → 社招 (regular / experienced hire) — totalCount ~2600+
//   "2" → 实习 (intern)                     — totalCount ~530+
//   "3" → 经验丰富/校园类 (the original spec labelled this "campus";
//           in practice the API label is jobType "3" / specialCode "5",
//           covering experienced-hire style postings rather than new-grad
//           campus recruitment). Using "2" for intern yields clear 实习 roles.
//
// PositionSummary field mapping:
//   post_id       ← jobUnionId (stringified)
//   title         ← name
//   project       ← department[0].name if present, else ""
//   recruit_label ← jobType mapped to human label (社招/实习/校园)
//   bgs           ← jobFamilyGroup (e.g. "软件") + jobFamily (e.g. "技术类")
//   work_cities   ← cityList[*].name joined with " / "
//   apply_url     ← https://zhaopin.meituan.com/job-list/${jobUnionId}
//
// Detail fields:
//   description   ← jobDuty (job responsibilities)
//   requirements  ← jobRequirement (required qualifications)
//   highlight     ← highLight (why join)
//   department_intro ← departmentIntro (team introduction)

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://zhaopin.meituan.com/api/official";
const LIST_PAGE = "https://zhaopin.meituan.com/job-list";
const DETAIL_PAGE = (jobUnionId: string) =>
  `https://zhaopin.meituan.com/job-list/${encodeURIComponent(jobUnionId)}`;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

// jobType code → human label
const JOB_TYPE_LABEL: Record<string, string> = {
  "1": "社招",
  "2": "实习",
  "3": "校园/经验",
};

interface ApiEnvelope<T> {
  status?: number;
  message?: string;
  data?: T;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; referer?: string } = {}
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    Referer: opts.referer ?? LIST_PAGE,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }

  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  // Meituan uses status === 1 for success (not 0 like Tencent)
  return {
    ok: payload.status === 1,
    data: payload.data,
    message: payload.message || (payload.status === 1 ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface CityNode {
  code?: string | null;
  name?: string;
  children?: CityNode[] | null;
}

interface DepartmentNode {
  code?: string | null;
  name?: string;
  children?: DepartmentNode[] | null;
}

interface RawJobListEntry {
  jobUnionId?: string | number;
  name?: string;
  projectId?: string | number | null;
  projectName?: string | null;
  jobType?: string;
  jobSpecialCode?: string;
  jobSource?: string;
  jobStatus?: string;
  jobFamily?: string;
  jobFamilyGroup?: string;
  cityList?: CityNode[];
  workYear?: string | null;
  department?: DepartmentNode[];
  desc?: string | null;
  departmentIntro?: string | null;
  jobDuty?: string | null;
  jobRequirement?: string | null;
  precedence?: string | null;
  highLight?: string | null;
  otherInfo?: string | null;
  firstPostTime?: number | null;
  refreshTime?: number | null;
  tag?: unknown;
  expiredTime?: number | null;
  socialRecommendJob?: boolean | null;
}

interface RawJobDetail extends RawJobListEntry {
  // detail response adds these with full content
}

interface RawPageInfo {
  pageNo?: number;
  pageSize?: number;
  totalPage?: number;
  totalCount?: number;
}

interface RawJobListResponse {
  list?: RawJobListEntry[];
  page?: RawPageInfo;
  traceId?: string | null;
}

// ---------- positions ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

function citiesText(cityList?: CityNode[]): string {
  if (!cityList || !cityList.length) return "";
  return cityList
    .map((c) => c.name ?? "")
    .filter(Boolean)
    .join(" / ");
}

function summarizePosition(item: RawJobListEntry): PositionSummary {
  const jobUnionId = String(item.jobUnionId ?? "");
  const deptName = item.department?.[0]?.name ?? "";
  const jobTypeCode = item.jobType ?? "";
  const recruitLabel = JOB_TYPE_LABEL[jobTypeCode] ?? jobTypeCode;
  const bgs = [item.jobFamilyGroup, item.jobFamily].filter(Boolean).join(" · ");

  return {
    post_id: jobUnionId,
    title: item.name ?? "",
    project: deptName,
    recruit_label: recruitLabel,
    bgs,
    work_cities: citiesText(item.cityList),
    apply_url: jobUnionId ? DETAIL_PAGE(jobUnionId) : LIST_PAGE,
  };
}

export interface SearchOptions {
  keyword?: string;
  jobTypeCodes?: string[];  // default: ["3"] (campus/experienced)
  page?: number;
  pageSize?: number;
}

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const jobTypeCodes = opts.jobTypeCodes ?? ["3"];

  const body = {
    page: { pageNo: page, pageSize },
    jobShareType: "1",
    keywords: (opts.keyword ?? "").trim().slice(0, 30),
    cityList: [],
    department: [],
    jobType: jobTypeCodes.map((code) => ({ code, subCode: [] })),
  };

  const response = await call<RawJobListResponse>("POST", "/job/getJobList", { body });
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: "zhaopin.meituan.com",
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = response.data.list ?? [];
  const pageInfo = response.data.page ?? {};
  return {
    ok: true as const,
    source: "zhaopin.meituan.com",
    query: body,
    page,
    page_size: pageSize,
    total: pageInfo.totalCount ?? rows.length,
    total_pages: pageInfo.totalPage ?? 1,
    positions: rows.map(summarizePosition),
  };
}

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number; jobTypeCodes?: string[] } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 30);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({
      keyword: opts.keyword,
      jobTypeCodes: opts.jobTypeCodes,
      page,
      pageSize,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message,
        source: "zhaopin.meituan.com",
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
    source: "zhaopin.meituan.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- detail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, message: "post_id is required" };

  const response = await call<RawJobDetail>("POST", "/job/getJobDetail", {
    body: { jobUnionId: id },
    referer: DETAIL_PAGE(id),
  });
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message || "no detail returned",
      source: "zhaopin.meituan.com",
      post_id: id,
    };
  }
  const raw = response.data;
  const first = (...vals: (string | null | undefined)[]) => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };

  return {
    ok: true as const,
    source: "zhaopin.meituan.com",
    post_id: String(raw.jobUnionId ?? id),
    title: raw.name ?? "",
    direction: first(raw.jobFamily, raw.jobFamilyGroup),
    description: first(raw.jobDuty, raw.desc),
    requirements: first(raw.jobRequirement),
    highlight: first(raw.highLight),
    department_intro: first(raw.departmentIntro),
    work_year: raw.workYear ?? null,
    work_cities: (raw.cityList ?? []).map((c) => c.name ?? "").filter(Boolean),
    recruit_cities: [],  // Meituan API does not expose a separate recruit city list
    apply_url: DETAIL_PAGE(String(raw.jobUnionId ?? id)),
  };
}

// ---------- stubs (no public endpoints found) ----------

export async function fetchDictionaries() {
  return { ok: false as const, message: "Meituan: no public dictionaries endpoint" };
}

export async function listNotices() {
  return { ok: false as const, message: "Meituan: no public notices endpoint", notices: [] };
}

export async function getNotice(_id: string) {
  return { ok: false as const, message: "Meituan: no public notice endpoint" };
}

export async function findNoticesByQuestion(_q: string, _opts: { questionTime?: string; topK?: number } = {}) {
  return {
    ok: false as const,
    message: "Meituan: no public notices endpoint",
    matches: [],
  };
}

// ---------- resume matching ----------

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number; jobTypeCodes?: string[] } = {}
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
  const list = await searchPositions({
    keyword,
    page: 1,
    pageSize: 100,
    jobTypeCodes: opts.jobTypeCodes,
  });
  if (!list.ok) return { ok: false as const, message: list.message, positions: [] };

  type Pre = { score: number; position: PositionSummary; reasons: string[] };
  const pre: Pre[] = [];
  for (const p of list.positions) {
    // Use name + project + bgs + work_cities as haystack (desc is in detail only)
    const blob = [p.title, p.project, p.bgs, p.work_cities].join(" ");
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
      title_detail?: string;
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
    if (!combined.length) {
      combined.push("no specific keyword overlap — surfaced from initial keyword search");
    }
    enriched.push({
      score: baseScore + extraScore,
      row: {
        ...position,
        title_detail: detail.title,
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
    source: "zhaopin.meituan.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches: enriched.slice(0, topN).map((e) => e.row),
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
