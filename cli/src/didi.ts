// Thin client for Didi's public job portal API at talent.didiglobal.com.
//
// ============================================================
// API DISCOVERY NOTES (probed 2026-05):
//
//   campus.didiglobal.com  — Moka white-label campus site (redirects to /campus_apply/didiglobal/96064).
//                            All data endpoints return AES-encrypted blobs {"data":"...","necromancer":"..."}.
//                            Cannot be decoded without the JS runtime cipher. BLOCKED.
//
//   talent.didiglobal.com  — Didi's self-hosted recruiting portal. Serves all open positions
//                            (campus + social hire combined, 1200+ active listings).
//                            Public, unauthenticated, no CORS restrictions.
//
//   talent.didiglobal.com/recruit-portal-service/api/job/front/list — live ✓
//   talent.didiglobal.com/recruit-portal-service/api/job/front/view/{jdId} — live ✓
//   talent.didiglobal.com/recruit-portal-service/api/job/job_locations — live ✓
//   talent.didiglobal.com/recruit-portal-service/api/job/jdpublish/confirm/listJdTypes — live ✓
//
// ============================================================
// Endpoint: GET /recruit-portal-service/api/job/front/list
//   Query params:
//     jobName    — keyword filter (URL-encoded, e.g. "算法")
//     workArea   — city name filter, e.g. "北京市" (from /api/job/job_locations list)
//     jobType    — job category code (integer, see taxonomy below)
//     recruitType — declared but NOT enforced server-side; returns same 1213 regardless of value
//     page       — 1-indexed page number
//     size       — page size; server ignores values != 16 and always returns 16 items/page
//   Response: { meta:{api,method,code:0,message}, data:{total,items:[...],page,size} }
//
// ============================================================
// Filter taxonomy (verified 2026-05):
//
// jobType codes (from GET /api/job/jdpublish/confirm/listJdTypes):
//   1=技术 (~416)   2=设计 (~20)    3=产品 (~101)   4=数据 (~68)
//   5=运营 (~382)   6=销售 (~54)    7=客服          9=市场 (~18)
//   10=人力 (~18)   11=行政         12=财务          13=法务
//   14=公关         15=战略         16=风控          18=安全 (~47)
//   19=供应链        20=采购
//
// workArea city values (from GET /api/job/job_locations, 52 total):
//   Top cities (2026-05): 北京市 (~838) 深圳市 上海市 杭州市 成都市 广州市
//   Also: 武汉市 天津市 南京市 西安市 重庆市 厦门市 香港岛 九龙
//   International: Mexico City  Sao Paulo
//
// ============================================================
// Site URL pattern for campus-tab positions (talent.didiglobal.com):
//   The portal has four tabs: 社会招聘 (social) / 校园招聘 (campus) / 实习生招聘 (intern) / 内推
//   The API returns all listings without tab-level filtering — both campus (JR-prefix jdNo) and
//   social (J-prefix jdNo) positions are included in every response.
//   There is no public API filter to isolate campus-only listings.
//   The campus.didiglobal.com (Moka) site would expose campus-only data but uses client-side AES
//   encryption that cannot be bypassed without executing Moka's JavaScript.
//
// ============================================================
// Page size is always 16 (server-enforced). To fetch more positions use fetchAllPositions()
// which paginates up to maxPages.
//
// ============================================================
// ---- PositionSummary field mapping (Didi → canonical) ----
//   post_id       ← jdId  (stringified) or jdNo as fallback
//   title         ← jobName (stripped of trailing "(jdNo)" suffix that Didi appends)
//   project       ← deptName  (closest to Tencent's projectName / BG)
//   recruit_label ← "" (recruitType field exists in /view but not in list response; campus vs social
//                       cannot be distinguished from the list API)
//   bgs           ← "" (Didi does not expose BG / 事业群 in public search)
//   work_cities   ← workArea
//   apply_url     ← https://talent.didiglobal.com/campus#/position/{jdId}/detail

import { extractResumeSignals, scoreOverlap, checkResume, pickDistinctiveTerms } from "./tencent.js";
export { checkResume };

const API_ROOT = "https://talent.didiglobal.com/recruit-portal-service/api";
const PORTAL_PAGE = "https://talent.didiglobal.com/";
const DETAIL_PAGE = (jdId: string) =>
  `https://talent.didiglobal.com/campus#/position/${encodeURIComponent(jdId)}/detail`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: PORTAL_PAGE,
};

// ---------- low-level call helper ----------

interface DidiMeta {
  code?: number;
  message?: string;
}

interface DidiEnvelope<T> {
  meta?: DidiMeta;
  data?: T;
}

async function call<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<{ ok: boolean; data?: T; message: string }> {
  // Build query string — omit undefined values
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${API_ROOT}${path}${qs ? "?" + qs : ""}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }

  let payload: DidiEnvelope<T>;
  try {
    payload = (await response.json()) as DidiEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  const code = payload.meta?.code ?? 0;
  return {
    ok: code === 0,
    data: payload.data,
    message: payload.meta?.message || (code === 0 ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface RawListItem {
  jdId?: number | string;
  jdNo?: string;
  jobName?: string;
  deptName?: string;
  workArea?: string;
  jobType?: number | string;
  labelCode?: string;
  refreshTime?: string;
  isUrgent?: boolean | null;
  new?: boolean;
}

interface RawListData {
  total?: number;
  items?: RawListItem[];
  page?: number;
  size?: number;
}

interface RawDetailData {
  jdId?: number | string;
  jdNo?: string;
  jobName?: string;
  deptName?: string;
  workArea?: string;
  jobType?: string;
  recruitType?: string;
  qualification?: string;
  jobDesc?: string;
  publishTime?: string;
  refreshTime?: string;
  recruitNum?: number;
  jdStatus?: number;
  recordId?: number;
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

/** Strip the "(JR2026XXXXXXX)" suffix that Didi appends to jobName in the list endpoint. */
function stripJdNoSuffix(jobName: string, jdNo: string | undefined): string {
  if (!jdNo) return jobName;
  const suffix = ` (${jdNo})`;
  return jobName.endsWith(suffix) ? jobName.slice(0, -suffix.length) : jobName;
}

function summarizePosition(item: RawListItem): PositionSummary {
  const jdId = String(item.jdId ?? "");
  const rawName = item.jobName ?? "";
  const title = stripJdNoSuffix(rawName, item.jdNo);
  return {
    post_id: jdId || (item.jdNo ?? ""),
    title,
    project: item.deptName ?? "",
    recruit_label: "", // not available in list response
    bgs: "",
    work_cities: (item.workArea ?? "").trim(),
    apply_url: jdId ? DETAIL_PAGE(jdId) : PORTAL_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  /** Keyword search — matched against job name.  Max ~60 chars. */
  keyword?: string;
  /** City name to filter by, e.g. "北京市", "上海市", "深圳市".
   *  Must be an exact string from GET /api/job/job_locations.
   *  Top cities: 北京市 上海市 深圳市 杭州市 成都市 广州市 武汉市 天津市 西安市 重庆市 南京市 厦门市 */
  workArea?: string;
  /** Job category code.  Known values:
   *    1=技术 (~416)   3=产品 (~101)   4=数据 (~68)   5=运营 (~382)
   *    6=销售 (~54)    9=市场 (~18)    18=安全 (~47)   2=设计 (~20)
   *  See header comment for full list. */
  jobType?: number;
  /** Page number, 1-indexed.  Default: 1. */
  page?: number;
  /** Desired page size.  NOTE: The server always returns exactly 16 items per page;
   *  this value is passed through but ignored server-side.  Use for informational
   *  purposes only (the response will always contain ≤16 items). */
  pageSize?: number;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const params: Record<string, string | number | undefined> = {
    page,
    size: 16, // server enforces 16; pass it explicitly for clarity
    ...(keyword ? { jobName: keyword } : {}),
    ...(opts.workArea ? { workArea: opts.workArea } : {}),
    ...(opts.jobType !== undefined ? { jobType: opts.jobType } : {}),
  };

  const response = await call<RawListData>("/job/front/list", params);
  if (!response.ok || !response.data) {
    return {
      ok: false,
      message: response.message,
      source: "talent.didiglobal.com",
      query: params,
      total: 0,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.items ?? [];
  return {
    ok: true,
    source: "talent.didiglobal.com",
    query: params,
    page,
    page_size: rows.length, // actual count (always ≤ 16)
    total: response.data.total ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const maxPages = Math.max(1, opts.maxPages ?? 10); // default: up to 160 posts
  const bucket: PositionSummary[] = [];
  let total: number | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        source: "talent.didiglobal.com",
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
    source: "talent.didiglobal.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "talent.didiglobal.com", message: "post_id is required" };

  const response = await call<RawDetailData>(`/job/front/view/${encodeURIComponent(id)}`);
  if (!response.ok || !response.data) {
    return {
      ok: false,
      source: "talent.didiglobal.com",
      post_id: id,
      message: response.message || "no detail returned",
    };
  }
  const raw = response.data;
  const jdId = String(raw.jdId ?? id);
  const rawName = raw.jobName ?? "";
  const title = stripJdNoSuffix(rawName, raw.jdNo);
  return {
    ok: true,
    source: "talent.didiglobal.com",
    post_id: jdId,
    jd_no: raw.jdNo ?? "",
    title,
    project: raw.deptName ?? "",
    recruit_label: raw.recruitType ?? "",
    description: raw.jobDesc ?? "",
    requirements: raw.qualification ?? "",
    work_cities: (raw.workArea ?? "").trim(),
    job_type: raw.jobType ?? "",
    recruit_num: raw.recruitNum ?? null,
    publish_time: raw.publishTime ?? "",
    apply_url: DETAIL_PAGE(jdId),
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  const [locations, jobTypes] = await Promise.all([
    call<string[]>("/job/job_locations"),
    call<Array<{ code: number; name: string }>>("/job/jdpublish/confirm/listJdTypes"),
  ]);

  return {
    ok: locations.ok && jobTypes.ok,
    source: "talent.didiglobal.com",
    cities: locations.data ?? [],
    job_types: (jobTypes.data ?? []).map((jt) => ({ code: jt.code, name: jt.name })),
    note: [
      "cities: pass as workArea filter (exact string match, e.g. '北京市').",
      "job_types: pass as jobType filter (integer code, e.g. 1 for 技术).",
      "recruitType filter is declared but NOT enforced — all values return the full dataset.",
      "Page size is server-fixed at 16 items/page regardless of size param.",
    ].join(" "),
  };
}

// ---------- stub notices ----------

const STUB_NOTICES = {
  ok: false as const,
  source: "talent.didiglobal.com",
  message: "Didi: no public notices/announcements endpoint on talent.didiglobal.com",
};

export async function listNotices(): Promise<typeof STUB_NOTICES> {
  return STUB_NOTICES;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "talent.didiglobal.com",
    message: "Didi: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "talent.didiglobal.com",
    message: "Didi: no public notices endpoint",
  };
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
      ok: false,
      source: "talent.didiglobal.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const queries = pickDistinctiveTerms(terms, 3);
  if (!queries.length) queries.push(terms[0] ?? "");
  const lists = await Promise.all(queries.map((q) => searchPositions({ keyword: q, page: 1 })));
  const seen = new Set<string>();
  const pool: PositionSummary[] = [];
  let lastErr: string | undefined;
  for (const l of lists) {
    if (!l.ok) { lastErr = l.message; continue; }
    for (const p of l.positions) {
      if (!seen.has(p.post_id)) { seen.add(p.post_id); pool.push(p); }
    }
  }
  if (!pool.length) {
    const broad = await searchPositions({ page: 1 });
    if (broad.ok) pool.push(...broad.positions);
  }
  if (!pool.length) {
    return { ok: false, source: "talent.didiglobal.com", message: lastErr ?? "no positions returned", positions: [] };
  }

  // Fetch a raw pass for description scoring via detail calls on top candidates
  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
    requirements?: string;
  };
  const scored: Scored[] = [];

  for (const p of pool) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({ score, position: p, reasons });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = pool.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  // Enrich top candidates with JD text from detail endpoint
  type EnrichedRow = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
    requirements?: string;
  };
  const enriched: EnrichedRow[] = [];
  for (const entry of shortlist.slice(0, candidates)) {
    const detail = await fetchPositionDetail(entry.position.post_id);
    if (detail.ok) {
      const jdBlob = [detail.description, detail.requirements, detail.work_cities].join(" ");
      const { score: extraScore, reasons: extraReasons } = scoreOverlap(
        jdBlob,
        terms,
        cities
      );
      const combined = [...new Set([...entry.reasons, ...extraReasons])].slice(0, 5);
      enriched.push({
        ...entry,
        score: entry.score + extraScore,
        reasons: combined,
        description: detail.description,
        requirements: detail.requirements,
      });
    } else {
      enriched.push(entry);
    }
  }
  enriched.sort((a, b) => b.score - a.score);

  const matches = enriched.slice(0, topN).map((s) => {
    const mr =
      s.reasons.length > 0
        ? s.reasons.slice(0, 5)
        : ["no specific keyword overlap — surfaced from initial keyword search"];
    return {
      ...s.position,
      description: s.description,
      requirements: s.requirements,
      match_reasons: mr,
    };
  });

  return {
    ok: true,
    source: "talent.didiglobal.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_didi } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_didi } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_didi } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "talent.didiglobal.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://talent.didiglobal.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "talent.didiglobal.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_didi({
      source: "talent.didiglobal.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://talent.didiglobal.com/talent-api/applyResume",
      submitKind: "multipart-session",
      endpointVerified: true,
      submitNotes:
        "Didi — POST /talent-api/applyResume with session cookie. Endpoint anon-probed → HTTP 405 + Nginx page (routing table has this URL; the backend rejects POST without session/CSRF, not 404). Body shape still needs validation.",
    }),
  };
}
