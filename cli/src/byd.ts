// BYD (比亚迪) recruiting adapter — job.byd.com.
//
// ============================================================
// API DISCOVERY (probed 2026-05-15)
//
// The job.byd.com SPA exposes two distinct API namespaces:
//
//   /portal/api/...              → authenticated; every endpoint returns
//                                  {"code":4001,"msg":"Token无效或已过期"}
//                                  for unauthenticated requests.
//   /portal/api/portal-api/...   → ANONYMOUS public endpoints used by the SPA's
//                                  home/experienced/campus landing flows. These
//                                  return job listings, notices, materials, and
//                                  recruit topics without any token.
//
// The working anonymous search endpoint is:
//
//   POST /portal/api/portal-api/position/queryList
//
// Required headers: a normal Chrome User-Agent, Content-Type application/json,
// a job.byd.com Referer, and `lang: en_US` (vivo accepts both en_US and zh_CN).
//
// Body shape:
//   {
//     positionTypeArr:     [],   // 职位类型 codes
//     positionProvinceArr: [],   // 省 codes
//     positionCityArr:     [],   // 市 codes
//     positionOrgArr:      [],   // 事业群 codes
//     vagueCondition:      "",   // free-text keyword (matches title; server-side,
//                                //   e.g. 工程师 → total 716 of 2032, verified 2026-07-11)
//     searchType:          1,    // 1 = title search
//     zpType:              "00251",  // 招聘类型 — see table below
//     pageNum:             0,    // *** ROW OFFSET, NOT a page index ***
//     pageSize:            20
//   }
//
// pageNum semantics (re-probed 2026-07-11): the server treats pageNum as a
// zero-based ROW OFFSET into the result set, not a page number:
//   - pageNum=1&pageSize=10  returns rows 1-10 (shifted by exactly one row vs
//     pageNum=0), NOT the second page.
//   - pageNum=10&pageSize=10 returns exactly rows 10-19 of pageNum=0&pageSize=20
//     (byte-identical id list).
//   - pageNum=2025&pageSize=50 returns the final 7 rows (2025+7 = total 2032).
// So page N of size S must be requested as pageNum=(N-1)*S. (Pre-1.2.x this
// adapter sent pageNum=page-1, which made every "page" overlap the previous one
// by pageSize-1 rows — `all` returned only ~87 unique jobs out of 2032.)
//
// The raw corpus also contains DUPLICATE ROWS — same positionCode listed as
// multiple posting instances (distinct internal `id`s). Measured 2026-07-11 by
// sweeping all 2032 raw rows: 1689 unique positionCodes, 343 duplicate rows
// across 253 codes (e.g. 20305947 x7; 20368270 twice within one 10-row page).
// 250/253 dup groups are byte-identical in every user-visible field; the other
// 3 (店端销售顾问) differ only in one variant missing province/city. All
// surfaces therefore dedupe by post_id, backfilling work_cities from a richer
// duplicate when the kept row lacks it.
//
// `zpType` controls the recruit channel:
//   "00251"  社招   (Experienced; 1647+ live postings)
//   "00252"  技师   (Technician — empty as of probe)
//   "00253"  操作工 (Operator / blue-collar — empty as of probe)
//   (Campus 校招 listings live behind a separate `school/*` flow that is fully
//   auth-gated; the public anon channel exposes social hire only.)
//
// Response envelope: {"code":0, "data":{"total":N, "data":[...]}}.
//
// Endpoint inventory (anonymous):
//   POST /portal/api/portal-api/position/queryList       → paginated jobs
//   GET  /portal/api/portal-api/material/getMaterial?ids=…    → site materials
//   POST /portal/api/portal-api/other-info/notice/query-list  → notices
//   POST /portal/api/portal-api/other-info/resource/query-list→ downloadables
//   GET  /portal/api/portal-api/common/queryCodeTree?ids=…    → filter taxonomy
//   POST /portal/api/portal-api/common/queryDeptTree          → org tree
//   POST /portal/api/portal-api/Recruitment/getMessageList    → marketing msgs
//   GET  /portal/api/portal-api/resumeSend/school-topic/info?zpNature=…
//                                                             → campus topics
//
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * BYD only exposes social-hire publicly (1.1.0+). The default zpType="00251"
 * IS the social channel; campus listings live behind a separate auth-gated
 * /school/* flow. Declaring `["social","all"]` lets the dispatcher fail fast
 * on `--scope campus|intern`.
 *
 * Scope translation:
 *   social  → zpType:"00251"  (default, ~1647 posts)
 *   all     → zpType:"00251"  (identical — only social is public)
 *   campus / intern → rejected by dispatcher (not in supportedScopes)
 *   undefined → zpType:"00251"
 */
export const supportedScopes = ["social", "all"] as const satisfies ReadonlyArray<PositionScope>;

const SOURCE = "job.byd.com";
const API_ROOT = "https://job.byd.com";
const SITE_ROOT = "https://job.byd.com/portal/pc/";
const DETAIL_PAGE = (id: string) =>
  `https://job.byd.com/portal/pc/#/social/detail?positionCode=${encodeURIComponent(id)}`;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: SITE_ROOT,
  Origin: API_ROOT,
  lang: "zh_CN",
};

interface BydEnvelope<T> {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {}
): Promise<{ ok: boolean; data?: T; message: string }> {
  let url = `${API_ROOT}${path}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (path.includes("?") ? "&" : "?") + qs;
  }
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json;charset=UTF-8";
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
  let payload: BydEnvelope<T>;
  try {
    payload = (await response.json()) as BydEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  return {
    ok: payload.code === 0,
    data: payload.data,
    message: payload.msg || payload.message || (payload.code === 0 ? "ok" : "upstream error"),
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
  /** CLI `--scope` echo (1.1.0+). BYD only exposes social publicly, so scope
   *  is accepted but does not change the query (zpType is already social). */
  scope?: PositionScope;
  /** zpType — recruit channel. Default "00251" (Experienced / 社招). */
  zpType?: string;
  /** position-type codes from queryCodeTree ids=0030 */
  positionTypeIds?: string[];
  /** province codes from queryCodeTree ids=0009 */
  provinceCodes?: string[];
  /** city codes from queryCodeTree ids=0009 (leaves) */
  cityCodes?: string[];
  /** 事业群 codes from queryDeptTree (fatherOrg) */
  orgCodes?: string[];
}

interface RawPosition {
  id?: string;
  positionCode?: string;
  positionName?: string;
  positionTypeId?: string;
  fatherOrgAliasName?: string;
  fatherOrgName?: string;
  orgAliasName?: string;
  orgName?: string;
  city?: string;
  province?: string;
  enCity?: string;
  enProvince?: string;
  peopleNumLimit?: string;
  createTime?: string;
}

function summarize(item: RawPosition): PositionSummary {
  const id = String(item.positionCode ?? item.id ?? "");
  const city = [item.province, item.city].filter(Boolean).join("·");
  return {
    post_id: id,
    title: (item.positionName ?? "").trim(),
    project: (item.fatherOrgAliasName ?? item.fatherOrgName ?? "").trim(),
    recruit_label: "社招",
    bgs: (item.orgAliasName ?? item.orgName ?? "").trim(),
    work_cities: city,
    apply_url: id ? DETAIL_PAGE(id) : SITE_ROOT,
  };
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const body = {
    positionTypeArr: opts.positionTypeIds ?? [],
    positionProvinceArr: opts.provinceCodes ?? [],
    positionCityArr: opts.cityCodes ?? [],
    positionOrgArr: opts.orgCodes ?? [],
    vagueCondition: (opts.keyword ?? "").trim().slice(0, 60),
    searchType: 1,
    zpType: opts.zpType ?? "00251",
    // pageNum is a ROW OFFSET, not a page index (see header notes, probed
    // 2026-07-11: pageNum=2025&pageSize=50 → the final 7 of 2032 rows).
    pageNum: (page - 1) * pageSize,
    pageSize,
  };
  const r = await call<{ total?: number; data?: RawPosition[] }>(
    "POST",
    "/portal/api/portal-api/position/queryList",
    { body }
  );
  if (!r.ok || !r.data) {
    return {
      ok: false as const,
      source: SOURCE,
      message: r.message,
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = r.data.data ?? [];
  // BYD's own table can list the same positionCode twice within one page
  // (observed 20368270 duplicated in a raw 10-row page) — collapse by post_id,
  // keeping the first row but backfilling work_cities from a richer duplicate.
  const seen = new Map<string, PositionSummary>();
  const positions: PositionSummary[] = [];
  for (const row of rows) {
    const p = summarize(row);
    const prev = p.post_id ? seen.get(p.post_id) : undefined;
    if (prev) {
      if (!prev.work_cities && p.work_cities) prev.work_cities = p.work_cities;
      continue;
    }
    if (p.post_id) seen.set(p.post_id, p);
    positions.push(p);
  }
  return {
    ok: true as const,
    source: SOURCE,
    query: body,
    page,
    page_size: pageSize,
    total: r.data.total ?? rows.length,
    // Raw row count from the server, BEFORE in-page dedup. fetchAllPositions
    // needs this for short-page / offset accounting (offsets are in raw rows).
    raw_rows: rows.length,
    ...(rows.length > positions.length
      ? { duplicates_removed: rows.length - positions.length }
      : {}),
    positions,
  };
}

// ---------- fetchAllPositions ----------
// Sweeps the catalog in non-overlapping raw-row windows (pageNum is a row
// offset — see header notes). Dedupes by post_id across pages AND collapses
// BYD's own duplicate rows, and stops on:
//   - raw rows consumed >= server-reported total (corpus exhausted)
//   - a short raw page (server ran out of rows)
//   - a full page that adds no new ids (guard against a looping server)
// If maxPages is hit while raw rows remain, `truncated: true` is emitted.

export async function fetchAllPositions(
  opts: {
    keyword?: string;
    maxPages?: number;
    pageSize?: number;
    zpType?: string;
    scope?: PositionScope;
  } = {}
) {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 50));
  // 2032 raw social rows / 50 per page = 41 pages as of 2026-07-11; 60 leaves
  // headroom (the pre-1.2.x default of 40 could not even cover today's corpus).
  const maxPages = Math.max(1, opts.maxPages ?? 60);

  const seen = new Map<string, PositionSummary>();
  const bucket: PositionSummary[] = [];
  let total: number | undefined;
  let rawConsumed = 0;
  let duplicates = 0;
  let exhausted = false;

  for (let page = 1; page <= maxPages; page++) {
    const r = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
      zpType: opts.zpType,
    });
    if (!r.ok) {
      if (page === 1) {
        return {
          ok: false as const,
          source: SOURCE,
          message: r.message,
          total: 0,
          fetched: 0,
          positions: [] as PositionSummary[],
        };
      }
      // Mid-sweep failure: return what we have, flagged as truncated.
      return {
        ok: true as const,
        source: SOURCE,
        total: total ?? bucket.length,
        fetched: bucket.length,
        positions: bucket,
        truncated: true as const,
        ...(duplicates > 0 ? { duplicates_removed: duplicates } : {}),
        note: `stopped early at page ${page}: ${r.message}`,
      };
    }
    total = r.total;
    rawConsumed += r.raw_rows;
    let added = 0;
    for (const p of r.positions) {
      const prev = p.post_id ? seen.get(p.post_id) : undefined;
      if (prev) {
        // Duplicate posting instance of the same positionCode; 3 of 253 dup
        // groups only differ by one variant missing province/city — backfill.
        if (!prev.work_cities && p.work_cities) prev.work_cities = p.work_cities;
        continue;
      }
      if (!p.post_id) continue;
      seen.set(p.post_id, p);
      bucket.push(p);
      added += 1;
    }
    // Cross-page + in-page collapses, measured against raw server rows.
    duplicates = rawConsumed - bucket.length;
    if (r.raw_rows < pageSize || rawConsumed >= total || added === 0) {
      exhausted = true;
      break;
    }
  }

  // Truncated only if we ran out of page budget while raw rows remained.
  const truncated = !exhausted && total !== undefined && rawConsumed < total;

  return {
    ok: true as const,
    source: SOURCE,
    // Server total counts RAW rows; the corpus itself contains duplicate rows
    // (e.g. 20368270 listed twice), so unique `fetched` can sit slightly below
    // `total` even after a full sweep — duplicates_removed explains the gap.
    total: total ?? bucket.length,
    fetched: bucket.length,
    positions: bucket,
    ...(truncated ? { truncated: true as const } : {}),
    ...(duplicates > 0 ? { duplicates_removed: duplicates } : {}),
  };
}

// ---------- fetchPositionDetail ----------
//
// The detail endpoint /portal/api/position/queryDetail requires auth, but the
// public list endpoint returns enough info per row that we surface a "row+link"
// detail instead of a fully gated 4001 stub.
//
// JD bodies are a GENUINE server-side JWT gate, re-verified 2026-07-11 audit:
//   - anon POST /portal/api/position/queryDetail → {"code":4001,"msg":"Token无
//     效或已过期: Not Authenticated"}
//   - anon POST /portal/api/portal-api/position/queryDetail with an internal
//     row id → code:0 but detail length 0 for every position sampled.
// So description/requirements stay empty by upstream policy, not adapter
// laziness; the honest `note` + apply_url below is the best anon surface.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required", post_id: id };

  // Page through the social-hire list looking for the row. This is the best we
  // can do without a logged-in JWT; in practice the row is usually within the
  // first few hundred records and matchResume already pages through the full
  // catalogue.
  const r = await searchPositions({ keyword: id, pageSize: 5 });
  const hit = r.ok ? r.positions.find((p) => p.post_id === id) : undefined;
  if (!hit) {
    return {
      ok: false as const,
      source: SOURCE,
      message:
        "Position detail endpoint (POST /portal/api/position/queryDetail) requires a logged-in JWT. " +
        "Public anon API can list positions but not return per-position bodies.",
      post_id: id,
      apply_url: DETAIL_PAGE(id),
    };
  }
  return {
    ok: true as const,
    source: SOURCE,
    post_id: hit.post_id,
    title: hit.title,
    project: hit.project,
    bgs: hit.bgs,
    recruit_label: hit.recruit_label,
    work_cities: hit.work_cities,
    description: "",
    requirements: "",
    apply_url: hit.apply_url,
    note:
      "Description and requirements are not available without authentication; " +
      "visit apply_url for the full posting after login.",
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  const [codeTree, deptTree] = await Promise.all([
    call<unknown>("GET", "/portal/api/portal-api/common/queryCodeTree", {
      query: { ids: "0009,0030" },
    }),
    call<unknown>("POST", "/portal/api/portal-api/common/queryDeptTree", { body: {} }),
  ]);
  return {
    ok: codeTree.ok || deptTree.ok,
    source: SOURCE,
    api_host: API_ROOT,
    verified_at: new Date().toISOString(),
    code_tree: codeTree.data ?? null,
    dept_tree: deptTree.data ?? null,
    zp_types: {
      "00251": "社招 (Experienced)",
      "00252": "技师 (Technician)",
      "00253": "操作工 (Operator)",
    },
    note:
      "Campus (校招) jobs are not exposed by the anon public API — the school/* " +
      "endpoints all require a JWT bearer token.",
  };
}

// ---------- notices ----------

interface RawNotice {
  id?: number | string;
  title?: string;
  noticeTitle?: string;
  publishTime?: string;
  createTime?: string;
  noticeContent?: string;
  content?: string;
  noticeType?: string;
}

export async function listNotices() {
  const r = await call<{ data?: RawNotice[]; list?: RawNotice[]; total?: number }>(
    "POST",
    "/portal/api/portal-api/other-info/notice/query-list",
    { body: { pageNum: 0, pageSize: 30 } }
  );
  if (!r.ok) return { ok: false as const, source: SOURCE, message: r.message, notices: [] };
  const items = r.data?.data ?? r.data?.list ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    count: items.length,
    notices: items.map((n) => ({
      id: String(n.id ?? ""),
      title: n.title ?? n.noticeTitle ?? "",
      publish_time: n.publishTime ?? n.createTime ?? "",
      tag: n.noticeType ?? "",
      detail_url: SITE_ROOT,
    })),
  };
}

export async function getNotice(noticeId: string) {
  const id = (noticeId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "notice_id is required" };
  const all = await listNotices();
  if (!all.ok) return { ok: false as const, source: SOURCE, message: all.message };
  const hit = all.notices.find((n) => n.id === id);
  if (!hit)
    return {
      ok: false as const,
      source: SOURCE,
      message: `notice ${id} not in the latest /notice/query-list page`,
    };
  return { ok: true as const, source: SOURCE, ...hit, content_html: "" };
}

export async function findNoticesByQuestion(
  question: string,
  opts: { questionTime?: string; topK?: number } = {}
) {
  const listing = await listNotices();
  if (!listing.ok) return { ok: false as const, source: SOURCE, message: listing.message, matches: [] };

  const tokens: string[] = [];
  const seen = new Set<string>();
  const text = (question ?? "").trim();
  for (const m of text.match(/[A-Za-z0-9]{2,}/g) ?? []) {
    const k = m.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      tokens.push(k);
    }
  }
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!seen.has(bigram)) {
        seen.add(bigram);
        tokens.push(bigram);
      }
      if (tokens.length >= 40) break;
    }
  }

  const topK = Math.max(1, opts.topK ?? 3);
  const scored = listing.notices
    .map((n) => {
      const hay = `${n.title} ${n.tag}`.toLowerCase();
      const score = tokens.filter((t) => hay.includes(t)).length;
      return { score, notice: n };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    ok: true as const,
    source: SOURCE,
    question,
    question_time: opts.questionTime,
    matched_tokens: tokens,
    matches: scored.slice(0, topK).map((s) => ({ ...s.notice, excerpt: "" })),
  };
}

// ---------- matchResume ----------

export async function matchResume(text: string, opts: { topN?: number; candidates?: number } = {}) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 200);

  const all = await fetchAllPositions({
    pageSize: 50,
    maxPages: Math.ceil(candidates / 50),
  });
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
