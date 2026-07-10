// Thin client for Bilibili's recruiting APIs at jobs.bilibili.com.
//
// AUTH MODEL  — Two-step stateless handshake (no login required):
//   1. GET /api/auth/v1/csrf/token
//        Headers: X-AppKey: ops.ehr-api.auth, X-UserType: 2
//        Response: { code:0, data:"<uuid>" }
//        Side-effect: sets cookie X-CSRF=<uuid> on domain bilibili.co
//                     (note: curl won't auto-save it due to domain mismatch with jobs.bilibili.com)
//   2. POST /api/campus/position/positionList   (校招 — campus + intern)
//      POST /api/srs/position/positionList      (社招 — social hire, 1.1.0+)
//        Pass the token both as:
//          header  X-CSRF: <token>
//          cookie  X-CSRF=<token>
//        Without both, the server returns code:-3 ("csrf不能为空").
//
// SCOPE SUPPORT (1.1.0+)  — Two endpoints, same auth shape, fully anonymous:
//   - /api/campus/position/positionList  → 校招 (campus + intern), ~356 posts
//   - /api/srs/position/positionList     → 社招 (social hire / SRS), ~470 posts
//
// The Tier-2 design doc hypothesised SRS was login-gated; re-probing (2026-05)
// showed the SRS list endpoint accepts the same anonymous CSRF handshake the
// campus path uses. Only SRS sub-routes that touch user state
// (/api/srs/post/list — code:-403, /api/srs/.../apply, etc.) remain account-gated.
//
// Both campus and SRS list endpoints require NO Bilibili account session
// (ajSessionId). A fresh CSRF token from step 1 is sufficient for public
// position browsing on either feed.
//
// ============================================================
// Endpoint inventory (probed 2026-05, JS bundle app.3a48ef6c.js + position.846fe539.js):
//
//   GET  https://jobs.bilibili.com/api/auth/v1/csrf/token
//        Headers: X-AppKey, X-UserType:2
//        Response: { code:0, data:"<csrf-uuid>" }
//
//   POST https://jobs.bilibili.com/api/campus/position/positionList
//        Headers: X-AppKey, X-UserType:2, X-CSRF:<token>, Cookie: X-CSRF=<token>
//        Payload: { pageNum, pageSize, positionName?, workLocationList?, positionTypeList?,
//                   deptCodeList?, workTypeList?, practiceTypes?, onlyHotRecruit?, recruitType? }
//        Response: { code:0, data:{ list:[...], pages:<int>, size:<int>, total:<int> } }
//
//   GET  https://jobs.bilibili.com/api/campus/dict/post
//        Headers: X-AppKey, X-UserType:2, X-CSRF:<token>, Cookie: X-CSRF=<token>
//        Response: code:0, data:[{ parentRankCode, rankCode, rankName, sonRankBasics:[...] }]
//        This is the public job-category taxonomy — no account needed.
//
// ============================================================
// Filter taxonomy (probed 2026-05, total ~356 positions):
//
// DIMENSION 1 — 职位类型 (实习/全职)
//   Historically positionTypeList:["实习"|"全职"]; re-probed 2026-07-11 the
//   backend ignores positionTypeList strings and filters on numeric
//   workTypeList codes instead:
//     workTypeList:[0] — 实习 (284 of 296)
//     workTypeList:[3] — 全职 (12 of 296)
//   (default: both, pass []; unknown codes → total 0; SRS ignores it)
//
// DIMENSION 2 — workLocationList (工作地点, free-text city names from workLocation field)
//   Common values seen: "上海", "北京", "上海/北京", "深圳", "杭州", "成都"
//   The API matches substring, so "北京" will match "上海/北京".
//   Pass [] or omit to query all cities.
//
// DIMENSION 3 — positionName (搜索关键词)
//   Free-text search matched against position title. Pass "" or omit for all.
//
// DIMENSION 4 — practiceTypes (校招项目 project IDs)
//   53 — 实习生校招项目  (campus intern program, recruitType=1)
//   52 — 全职校招项目    (campus full-time program, recruitType=1)
//   0  — 普通实习         (regular intern, recruitType=0)
//   Pass [] or omit to return all projects.
//   Note: passing [52] or [53] alone does NOT reliably filter by type in this API —
//   see the workTypeList + positionTypeList combination instead.
//
// DIMENSION 5 — recruitType (招聘类型)
//   1 — 校招 (campus program recruit)
//   0 — 普通实习 (ad-hoc intern)
//   (default: both; pass undefined to include all)
//
// DIMENSION 6 — job category taxonomy from GET /api/campus/dict/post (positionType)
//   Parent "01" 技术类
//     "010" 开发序列, "011" 运维序列, "012" 测试序列, "013" 算法序列
//     "014" 安全序列, "015" 信息管理序列, "016" 多媒体序列
//   Parent "02" 大职能类
//     "020" 财务, "021" 法务, "022" 投资, "023" 行政, "024" 采购
//     "025" 综合业务, "026" 公共关系, "027" 信息管理, "028" 人力资源, "029" 战略
//   Parent "03" 产品运营类
//     "030" 产品, "031" 产品运营, "032" 用户运营, "033" 电商运营
//     "034" 展会活动运营, "035" 数据分析, "036" 数据科学
//   Parent "04" 设计类
//     "040" UED, "041" 美术创意, "042" 平面设计
//   Parent "05" 内容类
//     "050" 内容运营, "051" 版权管理, "052" 内容合作
//   Parent "06" 文创类
//     "061" 制作, "062" 出品
//   Parent "07" 市场营销类
//     "070" 品牌市场, "071" 公关, "072" 商务BD, "073" 销售支持
//     "074" 销售, "075" 广告运营
//   Parent "08" 运营保障类
//     "080" 审核, "081" 客服, "082" 审核管理, "083" 审核运营
//     "084" 审核执行, "085" 客服执行, "086" 客服运营, "087" 客服管理
//   Parent "09" 综合管理类 / "10" 项目管理类 / "11" 游戏类 / "12" 外包类 / "99" 其他
//
// ============================================================
// PositionSummary field mapping (Bilibili → canonical):
//   post_id       ← String(item.id)
//   title         ← item.positionName
//   project       ← item.postCodeName   (e.g. "技术类" / "大职能类")
//   recruit_label ← item.positionTypeName (e.g. "实习" / "全职")
//   bgs           ← ""  (Bilibili does not expose BG/事业群 in public search)
//   work_cities   ← item.workLocation   (e.g. "上海" / "上海/北京")
//   apply_url     ← https://jobs.bilibili.com/campus/positions/${id}
//
// The list rows also inline the full JD as item.positionDescription
// (plain-text 工作职责 + 工作要求, both feeds — probed 2026-07-11). List
// summaries stay lean; detail/match surface it as `description`.
//
// ============================================================
// Endpoints that return 403 without a real account session (ajSessionId):
//   GET/POST /api/campus/dict/dictMsg
//   GET/POST /api/campus/position/cityList
//   GET/POST /api/campus/position/postCodeList
//   GET/POST /api/campus/position/detail/<id>
//   GET/POST /api/srs/post/list           (user-state subroute, code:-403)
//   GET/POST /api/rts/*                   (internal system — 403 or 500)
// Public anonymous (verified 2026-05 with CSRF only):
//   POST /api/srs/position/positionList   (社招 list, ~470 posts)
//   GET  /api/srs/dict/post               (社招 job taxonomy)
//
// The CSRF token is fresh per request; cache it for the process lifetime to
// avoid double-fetching on repeated searchPositions calls.

import { extractResumeSignals, scoreOverlap, checkResume, pickDistinctiveTerms } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Bilibili supports social + campus + intern + all (1.1.0+).
 *
 * Scope translation to upstream list endpoint:
 *   social  → /api/srs/position/positionList            (~470 posts)
 *   campus  → /api/campus/position/positionList         (~356 posts, mixed campus + intern)
 *   intern  → /api/campus/position/positionList + positionTypeList:["实习"]
 *   all     → both endpoints fanned out and merged
 *   undefined → /api/campus/position/positionList       (historical default, preserves 1.0.93)
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

const API_ROOT = "https://jobs.bilibili.com";
const CAMPUS_PAGE = "https://jobs.bilibili.com/campus/positions";
const SOCIAL_PAGE = "https://jobs.bilibili.com/social/positions";
const DETAIL_PAGE = (id: string, channel: "campus" | "social" = "campus") =>
  channel === "social"
    ? `https://jobs.bilibili.com/social/positions/${encodeURIComponent(id)}`
    : `https://jobs.bilibili.com/campus/positions/${encodeURIComponent(id)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "X-AppKey": "ops.ehr-api.auth",
  "X-UserType": "2",
  Referer: "https://jobs.bilibili.com/",
};

// ---------- CSRF token cache ----------
// Fresh UUID from GET /api/auth/v1/csrf/token — valid for the process lifetime.
let _csrfCache: string | null = null;

async function fetchCsrfToken(): Promise<
  { ok: true; token: string } | { ok: false; message: string }
> {
  if (_csrfCache) return { ok: true, token: _csrfCache };

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}/api/auth/v1/csrf/token`, {
      headers: DEFAULT_HEADERS,
    });
  } catch (err) {
    return {
      ok: false,
      message: `network error fetching CSRF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    return { ok: false, message: `CSRF HTTP ${response.status}` };
  }

  let payload: { code?: number; data?: string; message?: string };
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "bad JSON in CSRF response" };
  }

  if (payload.code !== 0 || !payload.data) {
    return {
      ok: false,
      message: payload.message ?? "CSRF endpoint returned error",
    };
  }

  _csrfCache = payload.data;
  return { ok: true, token: payload.data };
}

// ---------- low-level call helper ----------

interface BiliEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

async function call<T>(
  body: unknown,
  path: string = "/api/campus/position/positionList"
): Promise<{ ok: boolean; data?: T; message: string }> {
  const csrfResult = await fetchCsrfToken();
  if (!csrfResult.ok) {
    return { ok: false, message: csrfResult.message };
  }
  const token = csrfResult.token;

  const url = `${API_ROOT}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "X-CSRF": token,
        // The backend requires the CSRF token as both a request header AND a cookie.
        // The Set-Cookie header from /api/auth/v1/csrf/token sets it on domain bilibili.co
        // (not jobs.bilibili.com), so browsers do send it automatically but Node's fetch
        // does not forward cross-domain cookies — we inject it manually here.
        Cookie: `X-CSRF=${token}`,
      },
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

  let payload: BiliEnvelope<T>;
  try {
    payload = (await response.json()) as BiliEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  return {
    ok: payload.code === 0,
    data: payload.data,
    message: payload.message ?? (payload.code === 0 ? "ok" : `code ${payload.code}`),
  };
}

// ---------- raw response types ----------

interface RawPosition {
  id?: number | string;
  positionName?: string;
  positionTypeName?: string; // "实习" | "全职"
  postCodeName?: string;     // "技术类" | "大职能类" | etc.
  workLocation?: string;     // "上海" | "上海/北京" | etc.
  pushTime?: string;
  recruitType?: number;      // 0=普通实习, 1=校招
  campusProjectId?: number;  // 0=普通实习, 52=全职校招, 53=实习校招
  hotRecruit?: number;
  positionDescription?: string;
}

interface RawListData {
  list?: RawPosition[];
  pages?: number;
  size?: number;
  total?: number;
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

function summarizePosition(item: RawPosition, channel: "campus" | "social" = "campus"): PositionSummary {
  const id = String(item.id ?? "");
  const fallback = channel === "social" ? SOCIAL_PAGE : CAMPUS_PAGE;
  return {
    post_id: id,
    title: item.positionName ?? "",
    project: item.postCodeName ?? "",
    recruit_label: channel === "social"
      ? (item.positionTypeName ?? "社招")
      : (item.positionTypeName ?? ""),
    bgs: "",
    work_cities: item.workLocation ?? "",
    apply_url: id ? DETAIL_PAGE(id, channel) : fallback,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Filter by position type. Default: both.
   *  "实习" = intern only, "全职" = full-time campus hire only.
   *  Pass [] or omit for all. */
  positionTypes?: string[];
  /** Filter by work city (free-text, substring match).
   *  e.g. ["上海"], ["北京"], ["上海", "北京"].
   *  Pass [] or omit for all cities. */
  workLocations?: string[];
  /** Filter by recruit mode. 1=校招 (campus program), 0=普通实习 (ad-hoc intern).
   *  Omit to include both. (Campus feed only — SRS feed ignores it.) */
  recruitType?: number;
  /** CLI `--scope` echo (1.1.0+). Picks the upstream list endpoint
   *  (campus vs SRS). Omit to preserve the historical campus default. */
  scope?: PositionScope;
}

function channelForScope(s: PositionScope | undefined): "campus" | "social" | "all" {
  if (s === "social") return "social";
  if (s === "intern" || s === "campus") return "campus";
  if (s === "all") return "all";
  return "campus";
}

// ---------- raw single-channel page fetch ----------
// Both public list endpoints inline the full JD as `positionDescription`
// (probed 2026-07-11 with the anonymous CSRF handshake: campus and SRS rows
// both carry the plain-text 工作职责+工作要求 blob). Keeping the raw rows
// available here lets fetchPositionDetail / matchResume surface the JD
// without a second endpoint, while list summaries stay lean.

interface RawPageResult {
  ok: boolean;
  message: string;
  total: number;
  rows: RawPosition[];
  /** Echo of the upstream payload (+ _path) for the `query` field. */
  query: Record<string, unknown>;
}

async function fetchRawPage(
  channel: "campus" | "social",
  opts: SearchOptions
): Promise<RawPageResult> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const path = channel === "social"
    ? "/api/srs/position/positionList"
    : "/api/campus/position/positionList";

  const payload: Record<string, unknown> = {
    pageNum: page,
    pageSize,
    positionName: keyword,
    deptCodeList: [],
  };

  // intern scope narrows campus feed to 实习 rows unless caller overrides.
  let positionTypes = opts.positionTypes;
  if (!positionTypes?.length && opts.scope === "intern") {
    positionTypes = ["实习"];
  }
  // The 实习/全职 dimension moved server-side params (re-probed 2026-07-11):
  // positionTypeList strings are now IGNORED by the backend (["实习"] still
  // returns the full 296-post campus board incl. 全职), while workTypeList
  // takes numeric codes and filters for real — [0]=实习 (284) and [3]=全职
  // (12) exactly partition campus total 296, and both combine with the
  // positionName keyword. Unknown values → total 0 (honest empty, never the
  // unfiltered board). The SRS social feed ignores workTypeList entirely
  // (always 575, all 全职), same as it ignored positionTypeList before.
  const WORK_TYPE_CODE: Record<string, number> = { 实习: 0, 全职: 3 };
  const requestedTypes: unknown[] = Array.isArray(positionTypes)
    ? positionTypes
    : positionTypes ? [positionTypes] : []; // CLI --position-types 实习 arrives as a bare string
  payload.workTypeList = requestedTypes.map((t) => WORK_TYPE_CODE[String(t)] ?? t);
  payload.positionTypeList = []; // dead upstream since ≤2026-07; kept for payload-shape parity
  payload.workLocationList = opts.workLocations?.length ? opts.workLocations : [];

  if (opts.recruitType !== undefined && channel === "campus") {
    payload.recruitType = opts.recruitType;
  }

  const query = { ...payload, _path: path };
  const response = await call<RawListData>(payload, path);
  if (!response.ok || !response.data) {
    return { ok: false, message: response.message, total: 0, rows: [], query };
  }
  const rows = response.data.list ?? [];
  return {
    ok: true,
    message: "ok",
    total: response.data.total ?? rows.length,
    rows,
    query,
  };
}

// ---------- searchPositions ----------

type SearchPositionsResult =
  | {
      ok: true;
      source: string;
      query: Record<string, unknown>;
      page: number;
      page_size: number;
      total: number;
      positions: PositionSummary[];
    }
  | {
      ok: false;
      source: string;
      message: string;
      query: Record<string, unknown>;
      positions: PositionSummary[];
    };

export async function searchPositions(opts: SearchOptions = {}): Promise<SearchPositionsResult> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const channel = channelForScope(opts.scope);

  // scope=all → fan out both channels and merge (single concatenated page).
  if (channel === "all") {
    const [campusRes, socialRes] = await Promise.all([
      searchPositions({ ...opts, scope: "campus" }),
      searchPositions({ ...opts, scope: "social" }),
    ]);
    const positions: PositionSummary[] = [
      ...(campusRes.ok ? campusRes.positions : []),
      ...(socialRes.ok ? socialRes.positions : []),
    ];
    const total = (campusRes.ok ? (campusRes.total ?? 0) : 0)
      + (socialRes.ok ? (socialRes.total ?? 0) : 0);
    return {
      ok: true,
      source: "jobs.bilibili.com",
      query: { scope: "all", pageNum: page, pageSize, positionName: keyword },
      page,
      page_size: pageSize,
      total,
      positions,
    };
  }

  const result = await fetchRawPage(channel, opts);
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      source: "jobs.bilibili.com",
      query: result.query,
      positions: [] as PositionSummary[],
    };
  }

  return {
    ok: true,
    source: "jobs.bilibili.com",
    query: result.query,
    page,
    page_size: pageSize,
    total: result.total,
    positions: result.rows.map((row) => summarizePosition(row, channel)),
  };
}

// ---------- fetchAllPositions ----------

type FetchAllPositionsResult =
  | {
      ok: true;
      source: string;
      total: number;
      fetched: number;
      /** Present (true) only when the sweep hit maxPages before exhausting
       *  `total` — the caller got a prefix of the board, not all of it. */
      truncated?: true;
      positions: PositionSummary[];
    }
  | {
      ok: false;
      source: string;
      message: string;
      fetched: number;
      positions: PositionSummary[];
    };

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
): Promise<FetchAllPositionsResult> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  // Default 120 pages exhausts the larger SRS feed (~575 posts, probed
  // 2026-07-11; campus ~296) down to --page-size 5. The total-reached /
  // short-page / no-new-rows exits below keep a default sweep at 3–6
  // requests in practice; 120 is only the runaway cap.
  const maxPages = Math.max(1, opts.maxPages ?? 120);
  const channel = channelForScope(opts.scope);

  // scope=all → fan out both channels and merge with de-dup on post_id/url.
  if (channel === "all") {
    const [campusRes, socialRes] = await Promise.all([
      fetchAllPositions({ ...opts, scope: "campus" }),
      fetchAllPositions({ ...opts, scope: "social" }),
    ]);
    const seen = new Set<string>();
    const merged: PositionSummary[] = [];
    for (const p of [...(campusRes.positions ?? []), ...(socialRes.positions ?? [])]) {
      const key = `${p.post_id}|${p.apply_url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }
    // A failed channel means the merged board is silently missing that whole
    // feed — surface it as an error (with whatever was fetched) instead of
    // reporting ok with an understated total.
    if (!campusRes.ok || !socialRes.ok) {
      const message = [
        campusRes.ok ? null : `campus: ${campusRes.message}`,
        socialRes.ok ? null : `social: ${socialRes.message}`,
      ].filter(Boolean).join("; ");
      return {
        ok: false,
        source: "jobs.bilibili.com",
        message,
        fetched: merged.length,
        positions: merged,
      };
    }
    const total = campusRes.total + socialRes.total;
    const anyTruncated = campusRes.truncated === true || socialRes.truncated === true;
    return {
      ok: true,
      source: "jobs.bilibili.com",
      total,
      fetched: merged.length,
      ...(anyTruncated ? { truncated: true as const } : {}),
      positions: merged,
    };
  }

  const bucket: PositionSummary[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let exhausted = false;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        source: "jobs.bilibili.com",
        fetched: bucket.length,
        positions: bucket,
      };
    }
    if (total === undefined) total = result.total;
    // De-dup on post_id and stop as soon as a page adds nothing new, so a
    // server that ever started ignoring pageNum can't loop us over the same
    // page (both feeds honoured pageNum when probed 2026-07-11, but this is
    // exactly the failure Moka shipped pre-1.1.15).
    let added = 0;
    for (const p of result.positions) {
      if (seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      bucket.push(p);
      added += 1;
    }
    if (result.positions.length === 0 || added === 0) {
      exhausted = true; // past the last page / nothing new
      break;
    }
    if (total !== undefined && bucket.length >= total) {
      exhausted = true;
      break;
    }
    if (result.positions.length < pageSize) {
      exhausted = true; // short page = last page
      break;
    }
  }

  const truncated = !exhausted && total !== undefined && bucket.length < total;
  return {
    ok: true,
    source: "jobs.bilibili.com",
    total: total ?? bucket.length,
    fetched: bucket.length,
    ...(truncated ? { truncated: true as const } : {}),
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
// Bilibili's public list response carries the full JD inline as
// `positionDescription` (工作职责 + 工作要求 plain text — probed 2026-07-11 on
// both feeds), so "detail" is a paginated raw scan-and-filter (same pattern
// as feishu.ts) that returns that field as `description`.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: "jobs.bilibili.com", message: "post_id is required" };

  const pageSize = 100;
  // 12 × 100 = 1200 posts per channel — comfortably past the larger SRS feed
  // (~575 posts, probed 2026-07-11); the short-page / total-reached exits stop
  // the scan at the real end of each feed well before the cap.
  const maxPages = 12;

  // Scan campus feed first (historical default), then SRS social feed.
  for (const channel of ["campus", "social"] as const) {
    let scanned = 0;
    for (let page = 1; page <= maxPages; page++) {
      const result = await fetchRawPage(channel, { page, pageSize });
      if (!result.ok) break; // fall through to next channel
      const found = result.rows.find((row) => String(row.id ?? "") === id);
      if (found) {
        const summary = summarizePosition(found, channel);
        return {
          ok: true as const,
          source: "jobs.bilibili.com",
          post_id: id,
          title: summary.title,
          project: summary.project,
          recruit_label: summary.recruit_label,
          bgs: summary.bgs,
          work_cities: summary.work_cities,
          description: (found.positionDescription ?? "").trim(),
          apply_url: summary.apply_url,
        };
      }
      scanned += result.rows.length;
      if (result.rows.length < pageSize || scanned >= result.total) break;
    }
  }

  return {
    ok: false as const,
    source: "jobs.bilibili.com",
    post_id: id,
    message: `post ${id} not found in public search results (scanned the full campus + SRS feeds, up to ${maxPages * pageSize} posts each)`,
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
      source: "jobs.bilibili.com",
      message: "could not extract any technical signals from the text",
      preview: (text ?? "").slice(0, 120),
    };
  }

  const queries = pickDistinctiveTerms(terms, 3);
  if (!queries.length) queries.push(terms[0] ?? "");
  // Pull raw rows (not summaries) so scoring can see the inline JD
  // (positionDescription) instead of just title/category/city.
  const posLists = await Promise.all(
    queries.map((q) => fetchRawPage("campus", { keyword: q, page: 1, pageSize: 100 }))
  );
  const seen = new Set<string>();
  const pool: PositionSummary[] = [];
  const rawById = new Map<string, RawPosition>();
  const addRows = (rows: RawPosition[]) => {
    for (const row of rows) {
      const p = summarizePosition(row, "campus");
      if (seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      pool.push(p);
      rawById.set(p.post_id, row);
    }
  };
  let lastErr: string | undefined;
  for (const l of posLists) {
    if (!l.ok) { lastErr = l.message; continue; }
    addRows(l.rows);
  }
  if (!pool.length) {
    const broad = await fetchRawPage("campus", { page: 1, pageSize: 100 });
    if (broad.ok) addRows(broad.rows);
  }
  if (!pool.length) {
    return { ok: false, source: "jobs.bilibili.com", message: lastErr ?? "no positions returned", positions: [] };
  }

  type Scored = {
    score: number;
    position: PositionSummary;
    reasons: string[];
    description?: string;
  };
  const scored: Scored[] = [];

  for (const p of pool) {
    const description = (rawById.get(p.post_id)?.positionDescription ?? "").trim();
    const blob = [p.title, p.project, p.recruit_label, p.work_cities, description].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) {
      scored.push({ score, position: p, reasons, description });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = pool.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
      description: (rawById.get(position.post_id)?.positionDescription ?? "").trim(),
    }));
  }

  const matches = shortlist.slice(0, topN).map((s) => {
    const mr =
      s.reasons.length > 0
        ? s.reasons.slice(0, 5)
        : ["no specific keyword overlap — surfaced from initial keyword search"];
    return { ...s.position, description: s.description, match_reasons: mr };
  });

  return {
    ok: true,
    source: "jobs.bilibili.com",
    extracted_terms: terms,
    city_preferences: cities,
    matches,
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}

// ---------- stub notices + dicts ----------
// Bilibili's campus site has no public notices/announcements endpoint
// and the dict/post endpoint requires a real Bilibili session (403 anon),
// so fetchDictionaries also stubs with an honest message.

const STUB_NOTICES = {
  ok: false as const,
  source: "jobs.bilibili.com",
  message: "Bilibili: no public notices endpoint",
};

export async function fetchDictionaries(): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return {
    ok: false,
    source: "jobs.bilibili.com",
    message: "Bilibili: dict endpoints (dict/post, cityList, etc.) require a real user session (ajSessionId); filter taxonomy is derivable from positionList responses instead.",
  };
}

export async function listNotices(): Promise<typeof STUB_NOTICES> {
  return STUB_NOTICES;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bilibili.com",
    message: "Bilibili: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: "jobs.bilibili.com",
    message: "Bilibili: no public notices endpoint",
  };
}
