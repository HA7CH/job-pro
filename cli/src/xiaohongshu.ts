// Thin client for Xiaohongshu's public campus-recruiting API at job.xiaohongshu.com.
//
// All endpoints are unauthenticated when called via job.xiaohongshu.com (the SPA host).
// Calling the same paths on recruit.xiaohongshu.com (backend host) returns code 320001
// "用户未登录" because that host enforces cookie auth. The SPA host acts as a public
// reverse-proxy that strips the auth requirement for browsing pages.
//
// Endpoint inventory (all on https://job.xiaohongshu.com):
//
//   POST /websiterecruit/position/pageQueryPosition
//        body: { recruitType: "campus", keyword, page, pageSize, workplaceIds?, jobProjectCode? }
//        returns: { statusCode, data: { pageNum, pageSize, total, totalPage, list: [...] } }
//
//   GET  /websiterecruit/position/queryPositionDetail?positionId=<id>
//        returns: { statusCode, data: { positionId, positionName, duty, qualification,
//                   workplace, workplaceIds, recruitType, jobProject, jobProjectName, ... } }
//
//   GET  /websiterecruit/position/project/<recruitType>
//        returns { statusCode, data: null } for campus/school_recruit (no project tree exposed)
//
// API discovery notes:
//   - campus.xiaohongshu.com → 302 → job.xiaohongshu.com/campus (same SPA)
//   - hr.xiaohongshu.com → TLS error (not Moka-hosted)
//   - xiaohongshu.app.mokahr.com → TLS error (Moka subdomain does not exist for XHS)
//   - recruit.xiaohongshu.com → code 320001 auth required on all paths
//   - job.xiaohongshu.com → public; recruitType must be "campus" (not integer, not "top_intern"
//     for this endpoint — wrong value returns error 999 "招聘类型参数异常")
//
// PositionSummary field mapping from Xiaohongshu raw list entry:
//   post_id       ← positionId  (number → string)
//   title         ← positionName
//   project       ← jobProjectName
//   recruit_label ← jobType  (e.g. "大模型", "策略算法", "引擎"; null → "")
//   bgs           ← "" (Xiaohongshu does not expose a BU / business-line field
//                       in the list or detail API; the raw entry has no department,
//                       businessLine, team, or bu key — checked 2026-05-13)
//   work_cities   ← workplace  (already a human-readable string, e.g. "北京市，上海市")
//   apply_url     ← DETAIL_PAGE(positionId)

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";

export { checkResume };

const API_ROOT = "https://job.xiaohongshu.com";
const CAMPUS_PAGE = "https://job.xiaohongshu.com/campus/position";
const DETAIL_PAGE = (positionId: string | number) =>
  `https://job.xiaohongshu.com/campus/position?id=${encodeURIComponent(String(positionId))}`;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: "https://job.xiaohongshu.com",
};

// ---------- raw envelope ----------

interface XhsEnvelope<T> {
  statusCode?: number;
  errorCode?: number;
  alertMsg?: string;
  errorMsg?: string;
  data?: T;
  success?: boolean;
}

// ---------- call helper ----------

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; referer?: string } = {}
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    Referer: opts.referer ?? CAMPUS_PAGE,
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

  let payload: XhsEnvelope<T>;
  try {
    payload = (await response.json()) as XhsEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  const code = payload.statusCode ?? payload.errorCode ?? 0;
  const ok = payload.success === true || code === 200;
  return {
    ok,
    data: payload.data,
    message: payload.alertMsg || payload.errorMsg || (ok ? "ok" : "upstream error"),
  };
}

// ---------- dictionaries ----------

// Xiaohongshu does not expose a public dictionary/project tree endpoint for campus
// (the /project/<type> GET returns null data). This stub returns what is known from
// the JS bundle: recruit types are "campus", "social", "top_intern".
export async function fetchDictionaries() {
  return {
    ok: true,
    source: "job.xiaohongshu.com",
    note: "Xiaohongshu does not expose a campus project tree via public API.",
    recruit_types: ["campus", "social", "top_intern"],
  };
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

interface RawPositionListEntry {
  positionId?: string | number;
  positionName?: string;
  jobProjectName?: string;
  jobType?: string | null;
  duty?: string;
  workplace?: string;
  workplaceIds?: string;
  recruitStatus?: string;
  publishTime?: string;
  labels?: unknown;
}

function summarizePosition(item: RawPositionListEntry): PositionSummary {
  const postId = String(item.positionId ?? "");
  return {
    post_id: postId,
    title: item.positionName ?? "",
    project: item.jobProjectName ?? "",
    recruit_label: (item.jobType ?? "").trim(),
    // Xiaohongshu does not expose a BU / business-unit field in the list API.
    // The raw entry contains no department, businessLine, team, or bu key.
    bgs: "",
    work_cities: (item.workplace ?? "").trim(),
    apply_url: postId ? DETAIL_PAGE(postId) : CAMPUS_PAGE,
  };
}

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  workplaceIds?: string;
  jobProjectCode?: string;
}

interface PageQueryData {
  pageNum?: number;
  pageSize?: number;
  total?: number;
  totalPage?: number;
  list?: RawPositionListEntry[];
}

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const body: Record<string, unknown> = {
    recruitType: "campus",
    keyword: (opts.keyword ?? "").trim().slice(0, 50),
    page,
    pageSize,
  };
  if (opts.workplaceIds) body.workplaceIds = opts.workplaceIds;
  if (opts.jobProjectCode) body.jobProjectCode = opts.jobProjectCode;

  const response = await call<PageQueryData>(
    "POST",
    "/websiterecruit/position/pageQueryPosition",
    { body }
  );
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = response.data.list ?? [];
  // The upstream API appears to ignore pageSize and always returns its default
  // page size (~10). Enforce the caller's requested pageSize by slicing here.
  const trimmed = rows.slice(0, pageSize);
  return {
    ok: true as const,
    source: "job.xiaohongshu.com",
    query: body,
    page,
    page_size: pageSize,
    total: response.data.total ?? rows.length,
    positions: trimmed.map(summarizePosition),
  };
}

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 20);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ keyword: opts.keyword, page, pageSize });
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message,
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
    source: "job.xiaohongshu.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- position detail ----------

interface RawPositionDetail {
  positionId?: string | number;
  positionName?: string;
  recruitType?: string;
  jobProject?: string;
  jobProjectName?: string;
  jobType?: string | null;
  duty?: string;
  qualification?: string;
  workplace?: string;
  workplaceIds?: string;
  recruitStatus?: string;
  workNature?: string;
  education?: string | null;
}

export async function fetchPositionDetail(postId: string | number) {
  const id = String(postId ?? "").trim();
  if (!id) return { ok: false as const, message: "post_id is required" };

  const response = await call<RawPositionDetail>(
    "GET",
    `/websiterecruit/position/queryPositionDetail?positionId=${encodeURIComponent(id)}`,
    { referer: DETAIL_PAGE(id) }
  );
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message || "no detail returned",
      post_id: id,
    };
  }
  const raw = response.data;
  return {
    ok: true as const,
    source: "job.xiaohongshu.com",
    post_id: String(raw.positionId ?? id),
    title: raw.positionName ?? "",
    direction: raw.jobType ?? "",
    project: raw.jobProjectName ?? "",
    recruit_label: raw.recruitType ?? "",
    description: (raw.duty ?? "").trim(),
    requirements: (raw.qualification ?? "").trim(),
    work_cities: (raw.workplace ?? "").split(/[，,]/).map((s) => s.trim()).filter(Boolean),
    recruit_cities: (raw.workplace ?? "").split(/[，,]/).map((s) => s.trim()).filter(Boolean),
    apply_url: DETAIL_PAGE(raw.positionId ?? id),
  };
}

// ---------- notices (stub) ----------
//
// Xiaohongshu's campus notice page (job.xiaohongshu.com/campus/notice) is rendered
// server-side as static content; there is no public notice list API endpoint discovered
// in the JS bundle (unlike Tencent's /noticeDynamic/getNoticeDynamicList). These stubs
// maintain interface parity with tencent.ts.

export async function listNotices() {
  return {
    ok: true as const,
    source: "job.xiaohongshu.com",
    count: 0,
    notices: [] as Array<{
      id: number;
      title: string;
      publish_time: string;
      tag: string;
      detail_url: string;
    }>,
    note: "No public campus notice API discovered for Xiaohongshu; check job.xiaohongshu.com/campus/notice in a browser.",
  };
}

export async function getNotice(noticeId: string) {
  return {
    ok: false as const,
    message: `Xiaohongshu: no public notice detail API — notice id ${noticeId} not retrievable programmatically`,
  };
}

export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    source: "job.xiaohongshu.com",
    question,
    message: "Xiaohongshu: no public campus notice API — cannot search notices",
    matches: [] as unknown[],
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
  if (!list.ok) return { ok: false as const, message: list.message, positions: [] };

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
    if (!combined.length)
      combined.push("no specific keyword overlap — surfaced from initial keyword search");
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
    source: "job.xiaohongshu.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches: enriched.slice(0, topN).map((e) => e.row),
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
