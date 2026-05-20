// vivo careers adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (probed 2026-05-15)
//
// hr.vivo.com is vivo's *internal* BPM portal SPA and serves an all-paths-match
// catchall that returns its own HTML for every URL. The actual public careers
// site is a Beisen (北森) recruitment-portal tenant hosted at
// https://vivo.zhiye.com/ (tenant id 612022).
//
// The Beisen 2022 portal exposes a single paginated POST endpoint that backs
// every job-listing widget (社招 / 校招 / 全部职位 / 实习生):
//
//   POST /api/Jobad/GetJobAdPageList
//
// The endpoint is anonymous; the only required headers are a real browser
// User-Agent, Content-Type=application/json, and a vivo.zhiye.com Referer.
// `Category` filters by recruit type:
//
//   "1"  全部 / unspecified (default in widget config)
//   "4"  员工社招  (social hire)
//   "5"  员工校招  (campus hire)
//   "2"  校园招聘 (templated campus)
//   "3"  实习生
//
// Each position record exposes `Category` (Chinese label) and `CategoryId`.
//
// Endpoint inventory (anonymous POST, content-type application/json):
//   POST /api/Jobad/GetJobAdPageList            → paginated job list
//   POST /api/Jobad/GetJobAdSearchConditions    → filter taxonomy
//   GET  /api/Jobad/GetSpecialJobAdList         → hot/special jobs
//   GET  /api/Jobad/SearchAreasTreeConditions   → city tree
//   GET  /api/Common/GetPortalAIRobot           → portal config
//
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Beisen iTalent Category-axis mapping for the vivo tenant (612022).
 *
 * `--scope social` → `Category: ["4"]` (员工社招)
 * `--scope campus` → `Category: ["5"]` (员工校招)
 * `--scope intern` → `Category: ["3"]` (实习生)
 * `--scope all` / undefined → no Category filter (vivo's historical default)
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const;

const SOURCE = "vivo.zhiye.com";
const API_ROOT = "https://vivo.zhiye.com";
const SITE_ROOT = "https://vivo.zhiye.com/jobs";
const DETAIL_PAGE = (id: string) =>
  `https://vivo.zhiye.com/jobs?jobAdId=${encodeURIComponent(id)}`;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: SITE_ROOT,
  Origin: API_ROOT,
  "x-requested-with": "xmlhttprequest",
  langtype: "zh_CN",
};

interface BeisenEnvelope<T> {
  Code?: number;
  Message?: string;
  Data?: T;
  Count?: number;
  Total?: number;
}

async function post<T>(path: string, body: unknown): Promise<{
  ok: boolean;
  data?: T;
  count?: number;
  message: string;
}> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers: { ...DEFAULT_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }
  let payload: BeisenEnvelope<T>;
  try {
    payload = (await response.json()) as BeisenEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  return {
    ok: payload.Code === 200,
    data: payload.Data,
    count: payload.Count ?? payload.Total,
    message: payload.Message || (payload.Code === 200 ? "ok" : "upstream error"),
  };
}

async function get<T>(path: string): Promise<{ ok: boolean; data?: T; message: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, { method: "GET", headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }
  let payload: BeisenEnvelope<T>;
  try {
    payload = (await response.json()) as BeisenEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  return {
    ok: payload.Code === 200,
    data: payload.Data,
    message: payload.Message || (payload.Code === 200 ? "ok" : "upstream error"),
  };
}

// ---------- types ----------

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
  /**
   * Canonical CLI-side scope flag (1.1.0+). Mapped via `categoryFromScope`
   * to the Beisen Category axis: `social`=4, `campus`=5, `intern`=3,
   * `all`/undefined = no filter (vivo's historical default).
   */
  scope?: PositionScope;
  /**
   * @deprecated kept for backward compatibility with 1.0.93 callers — use
   * `scope` instead. Same string-value space as `scope`.
   */
  recruitType?: PositionScope;
}

interface RawJobAd {
  Id?: string;
  JobAdId?: number | string;
  JobAdName?: string;
  Category?: string;
  CategoryId?: string;
  Org?: string;
  OrgId?: number | string;
  LocNames?: string[];
  Salary?: string;
  Kind?: string;
  HeadCount?: number;
  PostDate?: string;
  Duty?: string;
  Require?: string;
}

function summarize(item: RawJobAd): PositionSummary {
  const id = String(item.JobAdId ?? item.Id ?? "");
  const cities = Array.isArray(item.LocNames) ? item.LocNames.join(", ") : "";
  return {
    post_id: id,
    title: (item.JobAdName ?? "").trim(),
    project: (item.Org ?? "").trim(),
    recruit_label: (item.Category ?? "").trim(),
    bgs: "",
    work_cities: cities,
    apply_url: id ? DETAIL_PAGE(id) : SITE_ROOT,
  };
}

function categoryFromScope(s?: PositionScope): string[] | undefined {
  switch (s) {
    case "social":
      return ["4"];
    case "campus":
      return ["5"];
    case "intern":
      return ["3"];
    case "all":
    default:
      return undefined;
  }
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  // Beisen pageIndex is zero-based.
  const body: Record<string, unknown> = {
    PageIndex: page - 1,
    PageSize: pageSize,
    KeyWords: (opts.keyword ?? "").trim().slice(0, 60),
    SpecialType: 0,
    PortalId: "",
    DisplayFields: ["Category", "Kind", "LocId", "Org", "HeadCount", "PostDate", "Salary"],
  };
  const category = categoryFromScope(opts.scope ?? opts.recruitType);
  if (category) body.Category = category;

  const r = await post<RawJobAd[]>("/api/Jobad/GetJobAdPageList", body);
  if (!r.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: r.message,
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = r.data ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    query: body,
    page,
    page_size: pageSize,
    total: r.count ?? rows.length,
    positions: rows.map(summarize),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: {
    keyword?: string;
    maxPages?: number;
    pageSize?: number;
    scope?: PositionScope;
    /** @deprecated use `scope` */
    recruitType?: PositionScope;
  } = {}
) {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 30));
  const maxPages = Math.max(1, opts.maxPages ?? 20);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const r = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
      scope: opts.scope ?? opts.recruitType,
    });
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        message: r.message,
        total: 0,
        fetched: bucket.length,
        positions: bucket,
      };
    }
    if (total === undefined) total = r.total;
    if (!r.positions.length) break;
    bucket.push(...r.positions);
    if (total !== undefined && bucket.length >= total) break;
  }
  return {
    ok: true as const,
    source: SOURCE,
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
//
// Beisen returns the full duty/require text directly on the list endpoint
// when DisplayFields is omitted or includes those keys. We therefore call
// GetJobAdPageList with the exact JobAdId to recover a single record.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required", post_id: id };
  const r = await post<RawJobAd[]>("/api/Jobad/GetJobAdPageList", {
    PageIndex: 0,
    PageSize: 1,
    KeyWords: "",
    SpecialType: 0,
    PortalId: "",
    JobAdIds: [Number(id) || id],
    DisplayFields: [
      "Category",
      "Kind",
      "LocId",
      "Org",
      "HeadCount",
      "PostDate",
      "Salary",
      "DetailAddress",
    ],
  });
  if (!r.ok || !r.data || !r.data.length) {
    return { ok: false as const, source: SOURCE, message: r.message || "no detail returned", post_id: id };
  }
  const raw = r.data[0];
  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(raw.JobAdId ?? id),
    title: raw.JobAdName ?? "",
    project: raw.Org ?? "",
    recruit_label: raw.Category ?? "",
    description: (raw.Duty ?? "").trim(),
    requirements: (raw.Require ?? "").trim(),
    work_cities: Array.isArray(raw.LocNames) ? raw.LocNames.join(", ") : "",
    salary: raw.Salary ?? "",
    kind: raw.Kind ?? "",
    head_count: raw.HeadCount,
    post_date: raw.PostDate ?? "",
    apply_url: DETAIL_PAGE(String(raw.JobAdId ?? id)),
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  const [conditions, areas] = await Promise.all([
    post<unknown>("/api/Jobad/GetJobAdSearchConditions", { Category: [] }),
    get<unknown>("/api/Jobad/SearchAreasTreeConditions"),
  ]);
  return {
    ok: conditions.ok || areas.ok,
    source: SOURCE,
    api_host: API_ROOT,
    verified_at: new Date().toISOString(),
    search_conditions: conditions.data ?? null,
    areas_tree: areas.data ?? null,
    category_map: { "4": "员工社招", "5": "员工校招", "2": "校园招聘", "3": "实习生" },
  };
}

// ---------- notices ----------

const NO_NOTICES = "vivo careers (Beisen tenant 612022) does not expose a public notices endpoint.";

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: NO_NOTICES, notices: [] as never[] };
}
export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: NO_NOTICES, notice_id: noticeId };
}
export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return { ok: false as const, source: SOURCE, question, message: NO_NOTICES, matches: [] as never[] };
}

// ---------- matchResume ----------

export async function matchResume(text: string, opts: { topN?: number; candidates?: number } = {}) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 200);

  const all = await fetchAllPositions({ pageSize: 30, maxPages: Math.ceil(candidates / 30) });
  if (!all.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: all.message,
      extracted_terms: terms,
      city_preferences: cities,
      matches: [] as PositionSummary[],
    };
  }

  type Scored = { score: number; position: PositionSummary };
  const scored: Scored[] = [];
  for (const p of all.positions) {
    const haystack = `${p.title} ${p.project} ${p.bgs} ${p.work_cities}`;
    const score = scoreOverlap(haystack, terms, cities).score;
    if (score > 0) scored.push({ score, position: p });
  }
  scored.sort((a, b) => b.score - a.score);

  const matches = scored.length
    ? scored.slice(0, topN).map((s) => s.position)
    : all.positions.slice(0, topN);

  return {
    ok: true as const,
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    candidate_pool: all.positions.length,
    matches,
  };
}

export { extractResumeSignals, scoreOverlap };


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema, ApplyQuestion } from './apply.js';

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: ApplyFormSchema } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? '').trim();
  if (!id) return { ok: false, source: SOURCE, message: 'post_id is required' };
  let title = '';
  try {
    const detail = await fetchPositionDetail(id) as { ok?: boolean; title?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: SOURCE, message: detail.message ?? 'post not found' };
    }
    title = detail?.title ?? '';
  } catch {}
  const questions: ApplyQuestion[] = [
    { label: 'Name',   required: true, fields: [{ name: 'name',   type: 'input_text' }] },
    { label: 'Email',  required: true, fields: [{ name: 'email',  type: 'input_text' }] },
    { label: 'Phone',  required: true, fields: [{ name: 'phone',  type: 'input_text' }] },
    { label: 'Resume', required: true, fields: [{ name: 'resume', type: 'input_file' }] },
  ];
  return {
    ok: true,
    schema: {
      source: SOURCE,
      post_id: id,
      job_title: title,
      apply_url: 'https://vivo.zhiye.com/jobs',
      submit_endpoint: 'https://vivo.zhiye.com/api/Apply/SubmitResume',
      submit_method: 'POST',
      submit_kind: 'beisen-italent',
      endpoint_verified: true,
      submit_notes:
        'Beisen iTalent apply: POST /api/Resume/UploadResume (multipart) + ' +
        'POST /api/Apply/SubmitResume with { JobAdId, ResumeId, … }. ' +
        'Endpoint anon-probed → HTTP 500 IIS Server Error template ' +
        '(route exists, handler threw on missing required headers/body — ' +
        'not 404 fallthrough). Requires candidate session via Beisen iTalent ' +
        'login at /login.html. Capture via extension/, drop session.json ' +
        'under ~/.jobpro/.',
      questions,
    },
  };
}
