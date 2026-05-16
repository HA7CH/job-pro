// Thin client for Xiaohongshu's public campus-recruiting API at job.xiaohongshu.com.
//
// All endpoints are unauthenticated when called via job.xiaohongshu.com (the SPA host).
// Calling the same paths on recruit.xiaohongshu.com (backend host) returns code 320001
// "用户未登录" because that host enforces cookie auth. The SPA host acts as a public
// reverse-proxy that strips the auth requirement for browsing pages.
//
// ═══════════════════════════════════════════════════════════════════
// FULL FILTER TAXONOMY (verified 2026-05-14 by exhaustive crawl)
// ═══════════════════════════════════════════════════════════════════
//
// recruitType (publicly queryable — no auth required):
//   "campus"     → 319 positions (校园招聘, includes intern + new-grad)
//   "social"     → 828 positions (社会招聘, experienced hires)
//   "top_intern" → ERROR 999 "招聘类型参数异常" (rejected by upstream)
//
// NOTE: The JS bundle references "top_intern" as a valid value for the SPA
// routing layer, but the pageQueryPosition endpoint rejects it with code 999.
// The "Ace 顶尖实习生计划" positions live inside recruitType="campus" with
// jobProjectName="Ace 顶尖实习生计划" / jobProject="top_intern_program".
//
// workplaceIds (city filter — accepted in payload but SILENTLY IGNORED server-side):
//   The upstream ignores workplaceIds regardless of format (string, number, array,
//   comma-separated). The full set of city ids seen in results:
//     campus:  1100=北京市  3100=上海市  3301=杭州市  4403=深圳市
//     social:  702=新加坡   840=美国     1100=北京市  3100=上海市
//              3301=杭州市  4401=广州市  4403=深圳市
//   City filtering must be done client-side by matching workplaceIds in results.
//
// jobType (campus distribution from 350 fetched positions):
//   大模型(35)  策略算法(63)  产品经理(42)  客户端开发(35)  后端开发(28)
//   体验设计(14)  多媒体算法(14)  内容理解(14)  引擎(7)  端点防护(7)
//   数据科学(7)  营销策划(7)  机器学习平台(7)  互动直播运营(7)  招聘(7)
//   政府事务(7)  基础安全(7)  法务(7)  基础后端(7)  内容运营(7)
//   社会招聘 adds: 产品运营  平台专家  电商运营  经营策略  行业销售  运维开发  销售运营
//   The jobType field is populated by the list endpoint and requires no extra dict call.
//   Server-side jobType filter (sending jobType in body) is SILENTLY IGNORED.
//
// jobProject / jobProjectCode (campus):
//   (none)                    203 positions  (no project assigned)
//   "Ace 顶尖实习生计划"       133 positions  code: "top_intern_program"
//   "2026 春季校园招聘"         14 positions  code: "campus_spring_26"
//   jobProjectCode is exposed in the detail endpoint only (not the list entry).
//   Server-side jobProjectCode filter (sending jobProjectCode in body) is SILENTLY IGNORED.
//
// labels: null on all crawled positions — field exists in schema but unused.
//
// ═══════════════════════════════════════════════════════════════════
// ENDPOINT INVENTORY (all on https://job.xiaohongshu.com)
// ═══════════════════════════════════════════════════════════════════
//
//   POST /websiterecruit/position/pageQueryPosition
//        body: { recruitType, keyword, page, pageSize, workplaceIds?, jobProjectCode? }
//        returns: { statusCode, data: { pageNum, pageSize, total, totalPage, list: [...] } }
//        KNOWN SILENTLY-IGNORED BODY FIELDS: keyword, pageSize, workplaceIds,
//        jobProjectCode, jobType — every call returns the same full list for
//        the given recruitType. Caller-side filtering required for all dims.
//        The endpoint always returns its default page size (~10 per page).
//
//   GET  /websiterecruit/position/queryPositionDetail?positionId=<id>
//        returns: { statusCode, data: { positionId, positionName, duty, qualification,
//                   workplace, workplaceIds, recruitType, jobProject, jobProjectName,
//                   positionType (=jobType), workNature, education, ... } }
//        NOTE: recruitType in detail may differ from query type — campus intern shows
//        "intern_recruit", social shows "club_recruit".
//
//   GET  /websiterecruit/position/project/<recruitType>
//        returns { statusCode, data: null } for all three types — no project tree exposed.
//
// DICT ENDPOINTS PROBED — ALL RETURN 404:
//   /websiterecruit/position/cities  /websiterecruit/position/cityList
//   /websiterecruit/position/jobTypes  /websiterecruit/labels
//   /websiterecruit/position/projects  /websiterecruit/dict/jobType
//   /websiterecruit/dict/city  /websiterecruit/dict  /websiterecruit/position/jobProjectList
//   /websiterecruit/position/filterOptions  /websiterecruit/position/config
//   /websiterecruit/position/workplaceList  /websiterecruit/position/jobTypeList
//   → No public filter-taxonomy API exists. All taxonomy is derived by crawling positions.
//
// API DISCOVERY NOTES:
//   - campus.xiaohongshu.com → 302 → job.xiaohongshu.com/campus (same SPA)
//   - hr.xiaohongshu.com → TLS error (not Moka-hosted)
//   - xiaohongshu.app.mokahr.com → TLS error (Moka subdomain does not exist for XHS)
//   - recruit.xiaohongshu.com → code 320001 auth required on all paths
//   - "social" recruitType IS publicly queryable (828 results, no auth required)
//
// PositionSummary field mapping from Xiaohongshu raw list entry:
//   post_id       ← positionId  (number → string)
//   title         ← positionName
//   project       ← jobProjectName
//   recruit_label ← jobType  (e.g. "大模型", "策略算法", "引擎"; null → "")
//   bgs           ← "" (Xiaohongshu does not expose a BU / business-line field
//                       in the list or detail API; the raw entry has no department,
//                       businessLine, team, or bu key — checked 2026-05-14)
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

// CITY_MAP: workplaceId → city name, derived by crawling all campus + social positions.
// campus (4 cities): Beijing, Shanghai, Hangzhou, Shenzhen.
// social (7 cities): adds Singapore, USA, Guangzhou.
// No public /cities API endpoint exists — all 404.
export const CITY_MAP: Record<string, string> = {
  "702":  "新加坡",
  "840":  "美国",
  "1100": "北京市",
  "3100": "上海市",
  "3301": "杭州市",
  "4401": "广州市",
  "4403": "深圳市",
};

// PROJECT_MAP: jobProject code → human name (campus only; social has no projects).
// Discovered via detail endpoint — the list entry only exposes jobProjectName, not the code.
// Server-side jobProjectCode filtering is silently ignored; use client-side matching.
export const PROJECT_MAP: Record<string, string> = {
  "top_intern_program": "Ace 顶尖实习生计划",   // 133 campus positions
  "campus_spring_26":   "2026 春季校园招聘",     // 14 campus positions
};

// JOB_TYPES: full set of jobType strings seen across campus + social.
// campus (20 types): 体验设计 大模型 引擎 策略算法 多媒体算法 端点防护 客户端开发
//   产品经理 内容理解 数据科学 营销策划 机器学习平台 后端开发 招聘 政府事务
//   互动直播运营 基础安全 法务 基础后端 内容运营
// social adds (7 types): 产品运营 平台专家 电商运营 经营策略 行业销售 运维开发 销售运营
// NOTE: server-side jobType filter (sending jobType in payload) is silently ignored.
export const JOB_TYPES = {
  campus: [
    "大模型", "策略算法", "产品经理", "客户端开发", "后端开发",
    "体验设计", "多媒体算法", "内容理解", "引擎", "端点防护",
    "数据科学", "营销策划", "机器学习平台", "互动直播运营", "招聘",
    "政府事务", "基础安全", "法务", "基础后端", "内容运营",
  ],
  social: [
    "大模型", "策略算法", "产品经理", "客户端开发", "后端开发",
    "体验设计", "多媒体算法", "内容理解", "产品运营", "平台专家",
    "电商运营", "经营策略", "行业销售", "运维开发", "销售运营",
    "互动直播运营", "内容运营",
  ],
};

export async function fetchDictionaries() {
  // No live API call needed — taxonomy is fully derived from exhaustive position crawl.
  // All /websiterecruit/position/cities, /cityList, /jobTypes, /labels etc. return 404.
  // /project/<type> returns statusCode 200 but data: null for all three types.
  return {
    ok: true,
    source: "job.xiaohongshu.com",
    note: [
      "Taxonomy derived by crawling all campus (319) and social (828) positions — no public dict API.",
      "recruitType='top_intern' is rejected by pageQueryPosition (error 999); top-intern positions",
      "live inside campus with jobProjectName='Ace 顶尖实习生计划' (jobProject='top_intern_program').",
      "All server-side filters (workplaceIds, jobType, jobProjectCode, keyword, pageSize) are silently ignored.",
      "Client-side filtering is required for all dimensions.",
    ].join(" "),
    recruit_types: {
      campus: { total: 319, description: "校园招聘 — intern + new-grad, publicly queryable" },
      social: { total: 828, description: "社会招聘 — experienced hires, publicly queryable, no auth needed" },
      top_intern: { total: null, description: "INVALID for pageQueryPosition — returns error 999; use campus + project filter" },
    },
    cities: CITY_MAP,
    projects: PROJECT_MAP,
    job_types: JOB_TYPES,
    campus_city_breakdown: {
      "1100 北京市": 287,
      "3100 上海市": 266,
      "3301 杭州市": 140,
      "4403 深圳市": 28,
      "note": "counts overlap (multi-city positions counted once per city); 350 unique positions fetched",
    },
    campus_project_breakdown: {
      "(none)":                 203,
      "Ace 顶尖实习生计划":      133,
      "2026 春季校园招聘":        14,
    },
    campus_jobtype_breakdown: {
      "策略算法": 63, "产品经理": 42, "大模型": 35, "客户端开发": 35,
      "后端开发": 28, "体验设计": 14, "多媒体算法": 14, "内容理解": 14,
      "(none)": 21,
      "other_7_each": ["引擎","端点防护","数据科学","营销策划","机器学习平台","互动直播运营","招聘","政府事务","基础安全","法务","基础后端","内容运营"],
    },
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
  /** Filter by recruit type. Defaults to "campus" (319 positions).
   *  "social" returns 828 positions (social hires), also publicly queryable without auth.
   *  "top_intern" is NOT a valid value for the upstream API (returns error 999);
   *  to find top-intern positions use recruitType:"campus" and filter client-side
   *  on project === "Ace 顶尖实习生计划". */
  recruitType?: "campus" | "social" | "top_intern";
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** City filter — passed to the upstream API but SILENTLY IGNORED server-side.
   *  Use for semantic documentation only; apply workplaceIds filtering client-side
   *  by matching item.workplaceIds against CITY_MAP keys.
   *  Known ids: 702=新加坡 840=美国 1100=北京市 3100=上海市 3301=杭州市 4401=广州市 4403=深圳市 */
  workplaceIds?: string | number | (string | number)[];
  /** Project code filter — passed to the upstream API but SILENTLY IGNORED server-side.
   *  Known campus codes: "top_intern_program" (Ace顶尖实习生), "campus_spring_26" (2026春季校招).
   *  Apply client-side by matching item.project (jobProjectName) from the list. */
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
  // "top_intern" is rejected by the upstream API (error 999). The caller may pass it
  // for intent documentation, but we map it to "campus" and note the caveat.
  const recruitType = opts.recruitType === "top_intern" ? "campus" : (opts.recruitType ?? "campus");
  const body: Record<string, unknown> = {
    recruitType,
    keyword: (opts.keyword ?? "").trim().slice(0, 50),
    page,
    pageSize,
  };
  // workplaceIds and jobProjectCode are forwarded for completeness but are silently
  // ignored by the upstream — all server-side filtering must be done client-side.
  if (opts.workplaceIds !== undefined && opts.workplaceIds !== null) {
    body.workplaceIds = Array.isArray(opts.workplaceIds)
      ? opts.workplaceIds.join(",")
      : String(opts.workplaceIds);
  }
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
  opts: { keyword?: string; maxPages?: number; pageSize?: number; recruitType?: SearchOptions["recruitType"] } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 20);

  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ keyword: opts.keyword, recruitType: opts.recruitType, page, pageSize });
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
  // Stub contract: align with listNotices (ok: true, empty results) so callers
  // treating "no public endpoint" as a soft success — same as Tencent when the
  // notice list happens to be empty — get a uniform shape.
  return {
    ok: true as const,
    source: "job.xiaohongshu.com",
    question,
    matches: [] as unknown[],
    note: "No public campus notice API discovered for Xiaohongshu; flow returns no matches by design.",
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


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_xiaohongshu } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_xiaohongshu } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_xiaohongshu } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "job.xiaohongshu.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://job.xiaohongshu.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "job.xiaohongshu.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_xiaohongshu({
      source: "job.xiaohongshu.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://job.xiaohongshu.com/recruit/apply",
      submitKind: "multipart-session",
      endpointVerified: true,
      submitNotes:
        "Xiaohongshu — POST /recruit/apply (no /api/ prefix) with session cookie. Endpoint anon-probed → HTTP 401 + {success:false, errorCode:401, alertMsg:\"请登录\"} (real apply route; the /api/* prefix returns 404 HTML, but the path lives at the host root). Body shape still needs validation.",
    }),
  };
}
