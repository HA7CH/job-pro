// Thin client for NetEase's (网易) public recruiting API at hr.163.com.
//
// Both campus-recruiting (校园/实习) and social-hire (社招) positions are served
// from the same host. This adapter targets campus + intern postings (workType "1").
//
// ============================================================
// Endpoint inventory (probed 2026-05, commons.288fd140.chunk.js):
//
//   POST https://hr.163.com/api/hr163/position/queryPage
//        Payload: { currentPage, pageSize, workType, keyword, ... }
//        Response: { code:200, data:{ total, pages, list:[...], lastPage } }
//        Verified fields in payload:
//          workType     "0"=社招 (social hire)  "1"=校园/实习 (campus+intern)
//          keyword      free-text search — the only filter that actually narrows results
//          currentPage  WORKS anonymously (verified 2026-07-11: currentPage 1/2/3
//                       with pageSize=200 workType="1" returned 200+200+14 rows,
//                       0 overlap, union of ids == total=414). `pageNum` is silently
//                       IGNORED — the earlier "pagination needs auth" note was a
//                       mis-diagnosis caused by sending the wrong param name.
//          pageSize     works; max=200 (code 402 if exceeded)
//        All other filter params (positionTypeCode, firstPostTypeCode,
//        workPlaceId, workPlaceList, etc.) are accepted with 200 but have NO
//        effect on the result set without an authenticated session cookie.
//
//   GET  https://hr.163.com/api/hr163/position/query?id=<id>
//        Returns full JD fields for one position ID.
//        No auth required; same shape as list items plus description/requirement.
//
//   GET  https://hr.163.com/api/hr163/options/positionType/queryItemList
//        Returns the positionType dictionary (职位类别).
//        id/name pairs — see DIMENSION 1 below.
//
//   GET  https://hr.163.com/api/hr163/position/queryPositionMetric
//        Returns aggregate counts: positionCount, cityCount, firstDepartmentCount.
//
//   GET  https://campus.163.com/api/campuspc/position/getJobList   [NOTE: auth-gated]
//        The campus.163.com SPA (校园招聘) exposes a dedicated campus portal with
//        BU/city/positionType filters — params: workPlaceId, positionType, firstBuId,
//        keyword, pageNum, pageSize (GET with query params, axios passes as params).
//        However the endpoint returns code:406 "当前用户未登录" for all filter dictionary
//        endpoints, and getJobList returns total:0 for unauthenticated requests.
//        ▶ Not usable without credentials; we fall back to hr.163.com.
//
// ============================================================
// Pagination:
//   The pagination field is `currentPage` (1-based). Anonymous multi-page
//   iteration works — verified 2026-07-11 against the live endpoint:
//     {currentPage:1|2|3, pageSize:200, workType:"1"} → 200+200+14 unique rows,
//     union == total (414 campus); social (workType:"0") behaves the same.
//   fetchAllPositions() sweeps currentPage=1..N at pageSize=200, dedupes by
//   post_id, and stops on a short page / no-new-ids page / total reached.
//
// ============================================================
// DIMENSION 1 — positionType codes (GET /options/positionType/queryItemList):
//   01=技术   02=游戏策划   03=游戏程序   04=游戏艺术   05=游戏测试
//   06=产品   07=人工智能   08=运营       11=用户体验及设计   12=项目管理
//   16=市场渠道   21=销售   26=内容   31=客服   41=电商   51=职能支持
//   56=高管   57=教育   58=企业服务   00,99=其他
//
// DIMENSION 2 — workType:
//   "0" = 社招 (social/experienced hire)  ~1952 positions
//   "1" = 校园/实习 (campus new-grad + intern)  ~417 positions
//
// DIMENSION 3 — workPlaceList city codes (observed in list responses):
//   1=北京   2=上海   138=广州   229=杭州
//   (NOTE: server ignores this filter without auth — keyword is the only filter)
//
// DIMENSION 4 — product/firstDep groupings observed in campus data:
//   P008=网易游戏（雷火）  P041=网易游戏（互娱）  P001=网易严选
//   firstDepName examples: 雷火事业群 / 音乐事业部 / 有道事业群 / 伏羲机器人 / 网易伏羲 / 严选事业部
//
// ============================================================
// ---- PositionSummary field mapping (NetEase → canonical) ----
//   post_id       ← item.id  (stringified)
//   title         ← item.name
//   project       ← item.firstPostTypeName  (职位类别, e.g. "游戏程序" / "技术" / "人工智能")
//   recruit_label ← item.workType === "1" ? "校园/实习" : "社招"  (API has no sub-label)
//   bgs           ← item.firstDepName  (一级部门/事业群, closest to BG)
//   work_cities   ← item.workPlaceNameList joined with " / "
//   apply_url     ← https://hr.163.com/job-detail?id=${id}

import { extractResumeSignals, scoreOverlap, checkResume, pickDistinctiveTerms } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * NetEase supports social + campus + intern + all (1.1.0+). The campus
 * endpoint (workType="1") already lumps intern + new-grad together, so
 * `intern` is treated as `campus`.
 *
 * Scope translation to upstream `workType`:
 *   social  → "0"   (社招, ~1952 posts)
 *   campus  → "1"   (校园/实习, ~417 posts)
 *   intern  → "1"   (subset of campus)
 *   all     → "1"   (no separate "all" — caller may fan out)
 *   undefined → "1" (historical default — preserves 1.0.93 campus tab)
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

function workTypeForScope(s: PositionScope | undefined): "0" | "1" {
  if (s === "social") return "0";
  return "1";
}

const API_ROOT = "https://hr.163.com/api/hr163";
const CAMPUS_PAGE = "https://hr.163.com/job-list.html?workType=1";
// The SPA registers each top-level route as a separate .html entry — nginx
// will serve a generic shell for the bare path (`/job-detail?id=...`) but
// that bootstraps `index.488b4902.js` (the index page) instead of the
// page-specific `job-detail.620522dd.js` chunk. The SPA itself only ever
// emits the `.html` form for shareable / external links
// (`window.open("job-detail.html?id=" + id)`), so that is the canonical URL.
const DETAIL_PAGE = (id: string) =>
  `https://hr.163.com/job-detail.html?id=${encodeURIComponent(id)}`;
const SOURCE = "hr.163.com";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://hr.163.com/",
};

// ---------- envelope ----------

interface NeEnvelope<T> {
  code?: number;
  msg?: string | null;
  data?: T | null;
}

// ---------- low-level helpers ----------

async function get<T>(
  path: string
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
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
  let payload: NeEnvelope<T>;
  try {
    payload = (await response.json()) as NeEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  return {
    ok: payload.code === 200,
    data: payload.data ?? undefined,
    message: payload.msg ?? (payload.code === 200 ? "ok" : "upstream error"),
  };
}

async function post<T>(
  path: string,
  body: unknown
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
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
  let payload: NeEnvelope<T>;
  try {
    payload = (await response.json()) as NeEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  return {
    ok: payload.code === 200,
    data: payload.data ?? undefined,
    message: payload.msg ?? (payload.code === 200 ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface RawPosition {
  id?: number | string;
  name?: string;
  workType?: string;
  firstPostTypeName?: string;
  firstDepName?: string;
  productName?: string;
  product?: string;
  recruitNum?: number;
  reqEducationName?: string;
  reqWorkYearsName?: string;
  workPlaceList?: number[];
  workPlaceNameList?: string[];
  description?: string;
  requirement?: string;
  updateTime?: number;
  geekPassionateTalentFlag?: number;
  beeUrl?: string | null;
}

interface RawPageData {
  total?: number;
  pages?: number;
  list?: RawPosition[];
  lastPage?: boolean;
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
  const workCities = (item.workPlaceNameList ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .join(" / ");
  return {
    post_id: id,
    title: item.name ?? "",
    project: item.firstPostTypeName ?? "",
    recruit_label: item.workType === "1" ? "校园/实习" : "社招",
    bgs: item.firstDepName ?? "",
    work_cities: workCities,
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /**
   * Recruit type. Default "1" = 校园/实习 (campus + intern, ~414 posts).
   * Use "0" for 社招 (social/experienced hire, ~2035 posts).
   *
   * Pagination is server-side via `currentPage` (works anonymously —
   * verified 2026-07-11). The only content filter is `keyword`.
   */
  workType?: "0" | "1";
  /** CLI `--scope` echo (1.1.0+). When set and `workType` is omitted, scope
   *  picks the upstream workType. `workType` takes precedence. */
  scope?: PositionScope;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 80);
  const workType = opts.workType ?? workTypeForScope(opts.scope);

  // The server's pagination field is `currentPage` — `pageNum` is accepted
  // but silently ignored (probed 2026-07-11: pageNum 1 vs 2 returned identical
  // ids; currentPage 1 vs 2 returned disjoint ids and exhausts total).
  const payload = {
    currentPage: page,
    pageSize,
    workType,
    keyword,
  };

  const response = await post<RawPageData>("/position/queryPage", payload);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      source: SOURCE,
      message: response.message,
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.list ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    query: payload,
    page,
    page_size: pageSize,
    total: response.data.total ?? rows.length,
    positions: rows.map(summarizePosition),
  };
}

// ---------- fetchAllPositions ----------
// Sweeps currentPage=1..N at the server-max pageSize=200 (anonymous pagination
// works — see header notes, verified 2026-07-11). Dedupes by post_id so a page
// that unexpectedly repeats records cannot inflate the result, and stops on:
//   - collected >= server-reported total (corpus exhausted)
//   - a short page (rows < pageSize)
//   - a page that adds no new ids (guard against a server that loops)
// If maxPages is hit while positions remain, `truncated: true` is emitted.

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = 200; // server max (code 402 above this)
  // 2035 social posts / 200 per page ≈ 11 pages today; 25 leaves headroom.
  const maxPages = Math.max(1, opts.maxPages ?? 25);
  const workType = opts.workType ?? workTypeForScope(opts.scope);
  const keyword = (opts.keyword ?? "").trim();

  const seen = new Set<string>();
  const positions: PositionSummary[] = [];
  let total = 0;
  let page = 1;
  let duplicates = 0;
  let sawShortOrStalePage = false;

  while (page <= maxPages) {
    const result = await searchPositions({ keyword, pageSize, workType, page });
    if (!result.ok) {
      if (page === 1) {
        return {
          ok: false as const,
          source: SOURCE,
          message: result.message,
          total: 0,
          fetched: 0,
          positions: [] as PositionSummary[],
        };
      }
      // Mid-sweep failure: return what we have, flagged as truncated.
      return {
        ok: true as const,
        source: SOURCE,
        total,
        fetched: positions.length,
        positions,
        truncated: true,
        note: `stopped early at page ${page}: ${result.message}`,
      };
    }

    total = result.total;
    let added = 0;
    for (const p of result.positions) {
      if (!p.post_id || seen.has(p.post_id)) {
        duplicates += 1;
        continue;
      }
      seen.add(p.post_id);
      positions.push(p);
      added += 1;
    }

    if (added === 0 || result.positions.length < pageSize || positions.length >= total) {
      sawShortOrStalePage = true;
      break;
    }
    page += 1;
  }

  // Truncated only if we ran out of page budget while the server still had more.
  const truncated = !sawShortOrStalePage && positions.length < total;

  return {
    ok: true as const,
    source: SOURCE,
    total,
    fetched: positions.length,
    positions,
    ...(truncated ? { truncated: true as const } : {}),
    // The server's `total` counts raw rows, and the corpus itself can contain
    // duplicate rows (observed 2026-07-11: social ids 74208 & 75683 listed
    // twice, so total=2035 vs 2033 unique). Surface how many we collapsed so
    // fetched < total is explained.
    ...(duplicates > 0 ? { duplicates_removed: duplicates } : {}),
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return { ok: false as const, source: SOURCE, message: "post_id is required" };
  }

  const response = await get<RawPosition>(`/position/query?id=${encodeURIComponent(id)}`);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: response.message || "no detail returned",
    };
  }

  const raw = response.data;
  const workCities = (raw.workPlaceNameList ?? []).map((c) => c.trim()).filter(Boolean);

  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(raw.id ?? id),
    title: raw.name ?? "",
    project: raw.firstPostTypeName ?? "",
    recruit_label: raw.workType === "1" ? "校园/实习" : "社招",
    bgs: raw.firstDepName ?? "",
    product: raw.productName ?? raw.product ?? "",
    req_education: raw.reqEducationName ?? "",
    req_work_years: raw.reqWorkYearsName ?? "",
    description: raw.description ?? "",
    requirements: raw.requirement ?? "",
    work_cities: workCities,
    recruit_cities: workCities, // API does not separate work city from interview city
    apply_url: DETAIL_PAGE(String(raw.id ?? id)),
  };
}

// ---------- fetchDictionaries ----------
// GET /options/positionType/queryItemList returns live positionType codes.
// city codes and BU lists are scraped from known values; the API does not
// expose a standalone city/BU dictionary without auth.

interface RawDictItem {
  id?: string;
  name?: string;
}

export async function fetchDictionaries() {
  const response = await get<RawDictItem[]>("/options/positionType/queryItemList");

  const positionTypes = response.ok
    ? (response.data ?? []).map((item) => ({
        id: item.id ?? "",
        name: item.name ?? "",
      }))
    : [];

  // Static known city codes (observed in campus responses 2026-05)
  const cities = [
    { code: 1, name: "北京市" },
    { code: 2, name: "上海市" },
    { code: 138, name: "广州市" },
    { code: 229, name: "杭州市" },
  ];

  // Static workType values
  const workTypes = [
    { value: "1", label: "校园/实习", note: "campus new-grad + intern (~417 posts)" },
    { value: "0", label: "社招", note: "social/experienced hire (~1952 posts)" },
  ];

  return {
    ok: response.ok,
    source: SOURCE,
    verified_at: new Date().toISOString(),
    campus_only: false,
    note:
      "City and BU dictionaries are static (derived from observed data 2026-05). " +
      "However, city/BU filters are NOT effective without authentication — " +
      "only `keyword` actually narrows results in unauthenticated calls.",
    positionTypes,
    cities,
    workTypes,
    message: response.ok ? "ok" : response.message,
  };
}

// ---------- notices (stub) ----------
// hr.163.com has no public announcement/notice endpoint.

const STUB_MSG = "NetEase: no public notices endpoint on hr.163.com";

export async function listNotices(): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return { ok: false, source: SOURCE, message: STUB_MSG };
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: SOURCE, message: STUB_MSG };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: SOURCE, message: STUB_MSG };
}

// ---------- matchResume ----------
// Mirror bytedance/tencent algorithm:
// 1. Extract signals from resume text.
// 2. Search with top-3 terms as keyword (the only working filter).
// 3. Score each post against title + project + bgs + work_cities + description + requirement.
// 4. Return top N matches with reasons.

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

  const queries = pickDistinctiveTerms(terms, 3);
  if (!queries.length) queries.push(terms[0] ?? "");
  const lists = await Promise.all(queries.map((q) => searchPositions({ keyword: q, pageSize: 100, workType: "1" })));
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
    const broad = await searchPositions({ pageSize: 100, workType: "1" });
    if (broad.ok) pool.push(...broad.positions);
  }
  if (!pool.length) {
    return {
      ok: false as const,
      source: SOURCE,
      message: lastErr ?? "no positions returned",
      positions: [] as PositionSummary[],
    };
  }

  // Fetch detail for each candidate to get description + requirements for richer scoring
  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
    requirements?: string;
  };
  const scored: Scored[] = [];

  const shortlist = pool.slice(0, candidates);
  for (const p of shortlist) {
    // Quick score from summary fields first
    const summaryBlob = [p.title, p.project, p.bgs, p.work_cities, p.recruit_label].join(" ");
    const { score: quickScore, reasons: quickReasons } = scoreOverlap(summaryBlob, terms, cities);

    // Fetch detail for JD text
    const detail = await fetchPositionDetail(p.post_id);
    let description: string | undefined;
    let requirements: string | undefined;
    let extraScore = 0;
    let extraReasons: string[] = [];

    if (detail.ok) {
      description = detail.description;
      requirements = detail.requirements;
      const jdBlob = [detail.description, detail.requirements].join(" ");
      const extra = scoreOverlap(jdBlob, terms, cities);
      extraScore = extra.score;
      extraReasons = extra.reasons;
    }

    const totalScore = quickScore + extraScore;
    const allReasons = [...new Set([...quickReasons, ...extraReasons])].slice(0, 5);

    if (totalScore > 0 || scored.length < topN) {
      scored.push({ score: totalScore, position: p, reasons: allReasons, description, requirements });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  let finalList = scored.slice(0, topN);
  if (!finalList.length) {
    // Fall back: return first topN from list without enrichment
    finalList = pool.slice(0, topN).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  const matches = finalList.map((s) => {
    const mr =
      s.reasons.length > 0
        ? s.reasons
        : ["no specific keyword overlap — surfaced from initial keyword search"];
    return {
      ...s.position,
      description: s.description,
      requirements: s.requirements,
      match_reasons: mr,
    };
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
