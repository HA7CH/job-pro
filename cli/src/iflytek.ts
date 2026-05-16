// 科大讯飞 (iFlytek) careers adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16)
//
// campus.iflytek.com / career.iflytek.com / hr.iflytek.com all 301-chain into
// Beisen iTalent's candidate-portal sign-in form (favicon /italent.ico is the
// dead giveaway for Beisen / 北森). That portal is candidate-session-only.
//
// The *public* careers site is a sibling Beisen tenant hosted at
// https://iflytek.zhiye.com/ — the same SaaS stack we already use for vivo
// (see cli/src/vivo.ts). The paginated list endpoint is anonymous: no
// session cookie, no signed header, no CSRF token. Same response envelope
// as vivo and other zhiye.com tenants:
//
//   POST /api/Jobad/GetJobAdPageList
//     payload: { PageIndex (0-based), PageSize, KeyWords, SpecialType,
//                PortalId: "", DisplayFields: [...], Category?: [...] }
//     headers: standard browser UA + Content-Type=application/json +
//              Referer=https://iflytek.zhiye.com/jobs +
//              x-requested-with=xmlhttprequest + langtype=zh_CN
//     envelope: { Code:200, Data:[RawJobAd[]], Count:<int>, Total:<int> }
//
// Probed 2026-05-16: 744 positions across campus / social / intern channels.
// Category labels seen: "校园招聘", "员工社招", "员工校招", "实习生".
//
// Endpoint inventory (all anon, all on iflytek.zhiye.com):
//   POST /api/Jobad/GetJobAdPageList            → paginated job list
//   POST /api/Jobad/GetJobAdSearchConditions    → filter taxonomy
//   GET  /api/Jobad/GetSpecialJobAdList         → hot/special jobs
//   GET  /api/Jobad/SearchAreasTreeConditions   → city tree
//   GET  /api/Common/GetPortalAIRobot           → portal config
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "iflytek.zhiye.com";
const API_ROOT = "https://iflytek.zhiye.com";
const SITE_ROOT = "https://iflytek.zhiye.com/jobs";
const DETAIL_PAGE = (id: string) =>
  `https://iflytek.zhiye.com/jobs?jobAdId=${encodeURIComponent(id)}`;

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
  /** "social" → 员工社招 ; "campus" → 员工校招 / 校园招聘 ; "intern" → 实习生 ; omit = all */
  recruitType?: "social" | "campus" | "intern" | "all";
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

// Beisen tenants encode recruit type via numeric Category IDs that vary by
// tenant. We don't know iFlytek's exact mapping without probing the
// taxonomy endpoint, so we leave it open and let CLI users filter by the
// returned `recruit_label` string client-side. When the mapping is known,
// add the numeric codes here (vivo uses "3"=intern, "4"=social, "5"=campus).
function categoryFromRecruitType(_t?: string): string[] | undefined {
  return undefined;
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
  const category = categoryFromRecruitType(opts.recruitType);
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
  opts: { keyword?: string; maxPages?: number; pageSize?: number; recruitType?: SearchOptions["recruitType"] } = {}
) {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 30));
  const maxPages = Math.max(1, opts.maxPages ?? 30);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const r = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
      recruitType: opts.recruitType,
    });
    if (!r.ok) {
      return { ok: false as const, source: SOURCE, message: r.message, total: 0, fetched: bucket.length, positions: bucket };
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
// Beisen serves the detail page from the same paginated list; there is no
// per-id REST endpoint that returns plain JSON. We page through and filter.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };

  const pageSize = 50;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page++) {
    const body: Record<string, unknown> = {
      PageIndex: page - 1,
      PageSize: pageSize,
      KeyWords: "",
      SpecialType: 0,
      PortalId: "",
      DisplayFields: ["Category", "Org", "LocId", "Kind", "Duty", "Require"],
    };
    const r = await post<RawJobAd[]>("/api/Jobad/GetJobAdPageList", body);
    if (!r.ok) {
      return { ok: false as const, source: SOURCE, post_id: id, message: r.message };
    }
    const posts = r.data ?? [];
    const found = posts.find((p) => String(p.JobAdId ?? p.Id) === id);
    if (found) {
      const summary = summarize(found);
      return {
        ok: true as const,
        source: SOURCE,
        post_id: id,
        title: found.JobAdName ?? "",
        project: summary.project,
        recruit_label: summary.recruit_label,
        description: found.Duty ?? "",
        requirements: found.Require ?? "",
        head_count: found.HeadCount ?? 0,
        post_date: found.PostDate ?? "",
        work_cities: found.LocNames ?? [],
        apply_url: summary.apply_url,
      };
    }
    if (posts.length < pageSize) break;
  }

  return {
    ok: false as const,
    source: SOURCE,
    post_id: id,
    message: `post ${id} not found in public search results (scanned up to ${maxPages * pageSize} posts)`,
  };
}

// ---------- fetchDictionaries ----------

interface RawSearchCondition {
  Field?: string;
  Name?: string;
  Options?: Array<{ Id?: string; Name?: string; Code?: string }>;
}

let _filterCache:
  | {
      ok: true;
      source: string;
      conditions: Array<{ field: string; name: string; options: Array<{ id: string; name: string }> }>;
    }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_filterCache !== null) return _filterCache;
  const r = await post<RawSearchCondition[]>(
    "/api/Jobad/GetJobAdSearchConditions",
    { PortalId: "", SpecialType: 0 }
  );
  if (!r.ok || !r.data) {
    const result = { ok: false as const, source: SOURCE, message: r.message };
    _filterCache = result;
    return result;
  }
  const conditions = r.data.map((c) => ({
    field: c.Field ?? "",
    name: c.Name ?? "",
    options: (c.Options ?? []).map((o) => ({
      id: o.Id ?? o.Code ?? "",
      name: o.Name ?? "",
    })),
  }));
  const result = { ok: true as const, source: SOURCE, conditions };
  _filterCache = result;
  return result;
}

// ---------- notices (stub — Beisen tenants have no public notices feed) ----------

const NOTICES_STUB = {
  ok: false as const,
  source: SOURCE,
  message: "iFlytek: no public notices endpoint on Beisen tenant",
};

export async function listNotices() {
  return { ...NOTICES_STUB, notices: [] as never[] };
}

export async function getNotice(noticeId: string) {
  return { ...NOTICES_STUB, notice_id: noticeId };
}

export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return { ...NOTICES_STUB, question, matches: [] as never[] };
}

// ---------- matchResume ----------

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
  const list = await searchPositions({ keyword, page: 1, pageSize: 50 });
  if (!list.ok) {
    return { ok: false as const, source: SOURCE, message: list.message, positions: [] };
  }
  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];
  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = list.positions.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
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

// Silence unused warning for the GET helper — kept for future taxonomy/city
// endpoints that return BeisenEnvelope JSON via GET.
void get;


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
      apply_url: 'https://iflytek.zhiye.com/jobs',
      submit_endpoint: 'https://iflytek.zhiye.com/api/Apply/SubmitResume',
      submit_method: 'POST',
      submit_kind: 'beisen-italent',
      endpoint_verified: true,
      submit_notes:
        'Beisen iTalent apply: POST /api/Resume/UploadResume (multipart) + ' +
        'POST /api/Apply/SubmitResume with { JobAdId, ResumeId, … }. ' +
        'Endpoint anon-probed → HTTP 500 IIS Server Error template ' +
        '(route exists, handler threw on missing required headers/body — ' +
        'not 404 fallthrough). Requires candidate session — Beisen iTalent ' +
        'uses email+phone+OTP login at /login.html. Capture via extension/, ' +
        'drop session.json under ~/.jobpro/.',
      questions,
    },
  };
}
