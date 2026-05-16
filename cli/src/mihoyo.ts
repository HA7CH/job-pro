// Thin client for 米哈游 / miHoYo recruiting portal.
//
// Portal: https://jobs.mihoyo.com/   (the old campus.mihoyo.com permanently
//                                     redirects here)
// API host: https://ats.openout.mihoyo.com/ats-portal
//
// ============================================================
// Discovery (2026-05):
//
//   campus.mihoyo.com         → permanently redirects to jobs.mihoyo.com
//   jobs.mihoyo.com           → React SPA shell
//   ats.openout.mihoyo.com    → real ATS backend (in the bundle: baseURL)
//
//   The bundle whitelist contains /v1/job/category/list, /v1/job/get/id_list,
//   /v1/job/project_count/list — but the actual search endpoint that returns
//   summarized job rows (the one the SPA hits to render the list page) is
//   /v1/job/list (probed; unauth-OK with channelDetailIds + hireType + pageNo).
//   /v1/job/info gives full per-position detail.
//
//   "channel" semantics (decoded from the bundle's enums):
//     R.CAMPUS = 1, R.JOBS = 1 (same value), R.RECOMMEND = 2
//     hireType enum: JOBS = 0 (social), CAMPUS = 1
//   Default surface = social: channelDetailIds=[1], hireType=0.
//
// ============================================================
// Response shape (probed 2026-05):
//   data.list[]:
//     id, title, competencyType, jobNature, projectName,
//     addressDetailList[].addressDetail, channelDetailIds
//   data.total — canonical total count
//
// PositionSummary field mapping:
//   post_id       ← String(job.id)
//   title         ← job.title
//   project       ← job.competencyType  (job category)
//   recruit_label ← job.jobNature       ("全职" / "实习")
//   bgs           ← job.projectName     ("社会招聘" / "校园招聘")
//   work_cities   ← addressDetailList[].addressDetail joined " / "
//   apply_url     ← https://jobs.mihoyo.com/#/position/${id}

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume, extractResumeSignals, scoreOverlap };

const SOURCE = "jobs.mihoyo.com";
const API_ROOT = "https://ats.openout.mihoyo.com/ats-portal";
const PORTAL_URL = "https://jobs.mihoyo.com";
const APPLY_URL_PREFIX = `${PORTAL_URL}/#/position`;

// Default channel: social ("社招"). Bundle constant R.JOBS = 1.
const CHANNEL_DETAIL_IDS = [1];
const HIRE_TYPE_SOCIAL = 0;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
  Origin: PORTAL_URL,
  Referer: `${PORTAL_URL}/`,
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
  /** Override default channel ids (social=[1], campus=[1] with hireType=1). */
  channelDetailIds?: number[];
  /** Override default hireType (0=social, 1=campus). */
  hireType?: number;
}

interface RawAddress {
  addressId?: string;
  addressDetail?: string;
}

interface RawJobRow {
  id?: string | number;
  title?: string;
  addressDetailList?: RawAddress[];
  competencyType?: string;
  jobNature?: string;
  projectName?: string;
  channelDetailIds?: number[];
  hurry?: boolean;
  tagList?: unknown[];
  jobSummary?: string;
  objectId?: string | null;
  objectName?: string;
}

interface RawJobDetail extends RawJobRow {
  code?: string;
  competencyTypeId?: string;
  jobNatureId?: number;
  description?: string;
  jobRequire?: string;
  addition?: string;
  deliveryInstructions?: string;
  hadDelivery?: number;
  status?: number;
  projectId?: number;
  hireType?: number;
  hireTypeName?: string;
}

interface RawEnvelope<T> {
  code?: number;
  message?: string;
  traceId?: string;
  data?: T;
  success?: boolean;
  error?: boolean;
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; message: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
  let payload: RawEnvelope<T>;
  try {
    payload = (await response.json()) as RawEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  if (payload.code !== 0 || !payload.data) {
    return { ok: false, message: payload.message || "upstream error" };
  }
  return { ok: true, data: payload.data, message: "ok" };
}

function summarize(row: RawJobRow): PositionSummary {
  const id = String(row.id ?? "");
  const cities = (row.addressDetailList ?? [])
    .map((a) => a.addressDetail ?? "")
    .filter(Boolean);
  return {
    post_id: id,
    title: row.title ?? "",
    project: row.competencyType ?? "",
    recruit_label: row.jobNature ?? "",
    bgs: row.projectName ?? "",
    work_cities: cities.join(" / "),
    apply_url: id ? `${APPLY_URL_PREFIX}/${encodeURIComponent(id)}` : PORTAL_URL,
  };
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const body: Record<string, unknown> = {
    channelDetailIds: opts.channelDetailIds ?? CHANNEL_DETAIL_IDS,
    hireType: opts.hireType ?? HIRE_TYPE_SOCIAL,
    pageSize,
    pageNo: page,
  };
  if (keyword) body.jobName = keyword;

  const response = await postJson<{
    list?: RawJobRow[];
    pageNo?: number;
    pageSize?: number;
    total?: number;
  }>("/v1/job/list", body);

  if (!response.ok || !response.data) {
    return {
      ok: false,
      message: response.message,
      source: SOURCE,
      query: body,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.list ?? [];
  return {
    ok: true,
    source: SOURCE,
    query: body,
    page,
    page_size: pageSize,
    total: response.data.total ?? rows.length,
    positions: rows.map(summarize),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 10);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        source: SOURCE,
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
    ok: true,
    source: SOURCE,
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: SOURCE, message: "post_id is required" };

  const response = await postJson<RawJobDetail>("/v1/job/info", { id });
  if (!response.ok || !response.data) {
    return { ok: false, source: SOURCE, message: response.message, post_id: id };
  }

  const d = response.data;
  const summary = summarize(d);
  return {
    ok: true,
    source: SOURCE,
    post_id: summary.post_id,
    title: d.title ?? "",
    direction: d.objectName ?? "",
    description: d.description ?? "",
    requirements: d.jobRequire ?? "",
    addition: d.addition ?? "",
    work_cities: d.addressDetailList ?? [],
    project: d.competencyType ?? "",
    recruit_label: d.jobNature ?? "",
    hire_type_name: d.hireTypeName ?? "",
    apply_url: summary.apply_url,
  };
}

// ---------- fetchDictionaries ----------

let _filterCache:
  | {
      ok: true;
      source: string;
      categories_social: Array<{
        competencyType: string;
        competencyTypeName: string;
        competencyTypeEnName: string;
        count: number;
      }>;
      categories_campus: Array<{
        competencyType: string;
        competencyTypeName: string;
        competencyTypeEnName: string;
        count: number;
      }>;
    }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_filterCache !== null) return _filterCache;

  const social = await postJson<
    Array<{
      competencyType?: string;
      competencyTypeName?: string;
      competencyTypeEnName?: string;
      count?: number;
    }>
  >("/v1/job/category/list", {
    channelDetailIds: CHANNEL_DETAIL_IDS,
    hireType: HIRE_TYPE_SOCIAL,
  });

  const campus = await postJson<
    Array<{
      competencyType?: string;
      competencyTypeName?: string;
      competencyTypeEnName?: string;
      count?: number;
    }>
  >("/v1/job/category/list", { channelDetailIds: CHANNEL_DETAIL_IDS, hireType: 1 });

  if (!social.ok && !campus.ok) {
    const result = {
      ok: false as const,
      source: SOURCE,
      message: social.message || campus.message,
    };
    _filterCache = result;
    return result;
  }

  const mapList = (
    list: Array<{
      competencyType?: string;
      competencyTypeName?: string;
      competencyTypeEnName?: string;
      count?: number;
    }>
  ) =>
    list.map((c) => ({
      competencyType: c.competencyType ?? "",
      competencyTypeName: c.competencyTypeName ?? "",
      competencyTypeEnName: c.competencyTypeEnName ?? "",
      count: c.count ?? 0,
    }));

  const result = {
    ok: true as const,
    source: SOURCE,
    categories_social: social.ok && social.data ? mapList(social.data) : [],
    categories_campus: campus.ok && campus.data ? mapList(campus.data) : [],
  };
  _filterCache = result;
  return result;
}

// ---------- stub notices ----------

const NOTICES_STUB = {
  ok: false as const,
  source: SOURCE,
  message: "miHoYo: no public notices endpoint",
};

export async function listNotices(): Promise<typeof NOTICES_STUB & { notices: never[] }> {
  return { ...NOTICES_STUB, notices: [] };
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
  const candidates = Math.max(topN, opts.candidates ?? 100);
  const { terms, cities } = extractResumeSignals(text ?? "");

  if (!terms.length) {
    return {
      ok: false,
      source: SOURCE,
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const keyword = terms[0];
  const list = await searchPositions({ keyword, page: 1, pageSize: Math.min(100, candidates) });
  if (!list.ok) {
    return { ok: false, source: SOURCE, message: list.message, positions: [] };
  }

  const scored = (list.positions ?? [])
    .map((p) => ({
      p,
      score: scoreOverlap(`${p.title} ${p.project} ${p.bgs}`, terms, cities).score,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.p);

  return {
    ok: true,
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    matches: scored,
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_mihoyo } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_mihoyo } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_mihoyo } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "ats.openout.mihoyo.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://ats.openout.mihoyo.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "ats.openout.mihoyo.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_mihoyo({
      source: "ats.openout.mihoyo.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://ats.openout.mihoyo.com/ats-portal/v1/application/create",
      submitKind: "multipart-session",
      submitNotes:
        "miHoYo — POST /ats-portal/v1/application/create with session cookie. Endpoint inferred from ats.openout.mihoyo.com SPA; needs validation.",
    }),
  };
}
