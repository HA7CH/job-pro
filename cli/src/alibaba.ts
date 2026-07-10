// Thin client for Alibaba's public campus-recruiting API at campus-talent.alibaba.com.
//
// CSRF flow: the server issues XSRF-TOKEN via a GET to the campus listing page.
// Every subsequent POST must echo it as both a Cookie and an X-XSRF-TOKEN header.
// The module-level singleton caches the token on first use and retries once on 403.
//
// Endpoint inventory (all under https://campus-talent.alibaba.com):
//
//   GET  /campus/position                  — HTML page; sets XSRF-TOKEN cookie
//   POST /searchCondition/listBatch        — list all active batches (no auth required)
//   POST /searchCondition/list             — filter taxonomy for a given batchId
//   POST /position/search                  — paginated job search (filter params below)
//   POST /position/detail                  — single job detail (body: {id: <number>})
//   POST /position/queryCircleDept         — dept tree for a circle (returns [] without login)
//
// ACTIVE BATCHES (live snapshot 2026-07-11; the adapter now DISCOVERS these at
// runtime via listActiveBatches() — never hardcode a batchId again):
//   batchId        | batchName              | section      | type        | totalCount
//   100000700001   | 阿里星2027届应届生        | graduate     | graduate    | 172
//   100000540002   | 阿里巴巴2027届实习生      | internship   | trainee     | 306
//   100000560002   | 阿里巴巴日常实习生        | internship   | talent_plan | 280
//   100000560001   | 阿里巴巴研究型实习生      | internship   | talent_plan | 194
//   (topTalentPlan re-lists 100000700001 as type=aliStar — dedup by id.)
//
// listBatch QUIRKS (verified 2026-07-11 via direct curl):
//   * `sequence` can OMIT non-empty sections — the live payload has
//     sequence=["internship","topTalentPlan"] while `graduate` holds one batch.
//     Always iterate the fixed section keys graduate/internship/topTalentPlan.
//   * topTalentPlan duplicates batch ids from other sections — dedup by id,
//     iterating `graduate` FIRST so the 校招正式 batch keeps its graduate label.
//
// BATCHID IS MANDATORY:
//   POST /position/search with NO batchId returns totalCount=0. There is no "all batches"
//   aggregate call — searchPositions/fetchAllPositions loop over every active batch
//   (from listBatch) and merge, deduping by post_id. `total` is the SUM of the
//   per-batch totalCounts for the same filters. Verified 2026-07-11: no keyword
//   172+306+280+194=952; searchKey=工程师 0+172+79+36=287.
//
// SCOPE MAPPING (1.2.x):
//   --scope campus → batches in the `graduate` section (校招正式/应届生)
//   --scope intern → batches in the `internship` section (实习生/日常/研究型)
//   --scope all / omitted → every unique active batch
//
// FILTER DIMENSIONS (passed as comma-joined strings in /position/search body):
//   subCategories  — category values from searchCondition/list (type="category")
//                    e.g. "11" (技术类), "1" (产品类), "11,1" (both) — comma-joined
//   regions        — city names from searchCondition/list (type="workCity")
//                    e.g. "北京", "北京,上海" — comma-joined city labels
//   customDeptCode — child dept codes from searchCondition/list (type="customDept")
//                    Must use leaf-level codes (e.g. "JM3EV0" for 阿里云技术线),
//                    NOT parent codes (e.g. "60002" for 阿里云 returns 0 results).
//                    Comma-join multiple: "JM3EV0,5YTU0N"
//
// KEYWORD SEARCH:
//   The correct field is `searchKey` (NOT `keyword`). searchKey works: passing "前端"
//   returns 3 results, "算法" returns 87, "java" returns 2. The old `keyword` field is
//   silently ignored by the server. This adapter now uses searchKey.
//
// CHANNEL NOTE:
//   The live site uses "new_campus_group_official_site". Both channel values return
//   identical counts for batchId 100000540002, so either works.
//
// PositionSummary field mapping (Alibaba → canonical):
//   post_id        ← String(item.id)                (numeric, e.g. 199903220038)
//   title          ← item.name
//   project        ← item.categoryName ?? ""         (e.g. "技术类")
//   recruit_label  ← item.categoryType ?? ""         (e.g. "internship", "freshman")
//   bgs            ← item.circleNames?.[0] ?? ""     (BU / group name)
//   work_cities    ← item.workLocations.join(" / ")
//   batch_name     ← item.batchName ?? ""            (e.g. "阿里星2027届应届生")
//   apply_url      ← https://campus-talent.alibaba.com/campus/positionDetail?positionId=<id>

import { extractResumeSignals, scoreOverlap, checkResume, pickDistinctiveTerms } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { extractResumeSignals, scoreOverlap, checkResume };

/**
 * Alibaba: campus + intern channels are wired (1.1.0+); scoped batch routing
 * landed in 1.2.x.
 *
 * The public endpoint we hit is `campus-talent.alibaba.com` — Alibaba's
 * social-hire flow lives on a different domain (job.alibaba.com / 阿里招聘)
 * and is NOT wired into this adapter. Declaring `["campus","intern","all"]`
 * lets the dispatcher fail fast on `--scope social` and route the caller
 * elsewhere.
 *
 * Scopes now genuinely differ (since the graduate batch opened):
 *   campus → listBatch `graduate` section (校招正式, e.g. 阿里星2027届应届生)
 *   intern → listBatch `internship` section (2027届实习生/日常/研究型)
 *   all / omitted → every unique active batch
 */
export const supportedScopes = ["campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

const API_ROOT = "https://campus-talent.alibaba.com";
const CAMPUS_PAGE = `${API_ROOT}/campus/position`;
const DETAIL_PAGE = (id: string | number) =>
  `${API_ROOT}/campus/position/${encodeURIComponent(String(id))}`;

const DEFAULT_CHANNEL = "new_campus_group_official_site";
const SOURCE = "campus-talent.alibaba.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---------- CSRF singleton ----------

interface CsrfState {
  token: string;
  session: string;
}

let csrfCache: CsrfState | null = null;

async function acquireCsrf(): Promise<CsrfState | null> {
  let response: Response;
  try {
    response = await fetch(CAMPUS_PAGE, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    return null;
  }
  if (!response.ok) return null;

  // Node fetch exposes Set-Cookie via getSetCookie() (Node 18+) or headers.raw()
  let setCookieHeaders: string[] = [];
  const rawHeaders = (response.headers as unknown as { raw?: () => Record<string, string[]> }).raw;
  if (typeof rawHeaders === "function") {
    const raw = rawHeaders.call(response.headers);
    setCookieHeaders = raw["set-cookie"] ?? [];
  } else if (typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function") {
    setCookieHeaders = (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }

  let token = "";
  let session = "";
  for (const hdr of setCookieHeaders) {
    const nameVal = hdr.split(";")[0].trim();
    const [name, val] = nameVal.split("=").map((s) => s.trim());
    if (name === "XSRF-TOKEN" && val) token = val;
    if (name === "SESSION" && val) session = val;
  }
  if (!token) return null;
  return { token, session };
}

async function getCsrf(force = false): Promise<CsrfState | null> {
  if (!force && csrfCache) return csrfCache;
  const state = await acquireCsrf();
  if (state) csrfCache = state;
  return state ?? null;
}

// ---------- core HTTP helper ----------

interface AliEnvelope<T> {
  success?: boolean;
  errorMsg?: string | null;
  errorCode?: string | null;
  content?: T;
}

async function call<T>(
  path: string,
  body: unknown,
  retried = false
): Promise<{ ok: boolean; data?: T; message: string }> {
  const csrf = await getCsrf();
  if (!csrf) {
    return { ok: false, message: "failed to acquire CSRF token from Alibaba" };
  }

  const cookieStr = `XSRF-TOKEN=${csrf.token}${csrf.session ? `; SESSION=${csrf.session}` : ""}`;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Content-Type": "application/json",
    Accept: "application/json",
    Referer: CAMPUS_PAGE,
    "X-XSRF-TOKEN": csrf.token,
    Cookie: cookieStr,
  };

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (response.status === 403 && !retried) {
    csrfCache = null;
    return call<T>(path, body, true);
  }

  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
  }

  let payload: AliEnvelope<T>;
  try {
    payload = (await response.json()) as AliEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  if (payload.success === false) {
    return {
      ok: false,
      message: payload.errorMsg || payload.errorCode || "upstream returned success=false",
    };
  }

  return {
    ok: true,
    data: payload.content,
    message: "ok",
  };
}

// ---------- raw shapes ----------

interface RawPosition {
  id?: number | string;
  name?: string;
  status?: string;
  description?: string;
  requirement?: string;
  workLocations?: string[];
  interviewLocations?: string[];
  categoryName?: string;
  categoryType?: string;
  circleNames?: string[];
  batchName?: string;
  batchId?: number;
  department?: string | null;
  project?: string | null;
  positionType?: string | null;
}

// ---------- batch discovery ----------

interface RawBatch {
  id: number;
  name: string;
  enName?: string;
  type?: string;
  remark?: string;
  remarkEn?: string;
}

interface RawBatchList {
  graduate?: RawBatch[];
  internship?: RawBatch[];
  topTalentPlan?: RawBatch[];
  sequence?: string[];
}

export interface BatchInfo {
  batchId: number;
  batchName: string;
  batchNameEn: string;
  /** listBatch section the batch FIRST appears in: graduate | internship | topTalentPlan */
  category: string;
  /** Upstream `type`: "graduate" | "trainee" | "talent_plan" | "aliStar" ... */
  recruitType: string;
  remark: string;
}

// graduate FIRST so the 校招正式 batch keeps its graduate label even though
// topTalentPlan re-lists the same id (verified live 2026-07-11).
const BATCH_SECTIONS = ["graduate", "internship", "topTalentPlan"] as const;

let batchCache: BatchInfo[] | null = null;

/**
 * Discover every active batch via POST /searchCondition/listBatch.
 * DO NOT trust the response's `sequence` array — the live payload omits
 * "graduate" from it even while the graduate section is non-empty
 * (verified 2026-07-11). Iterate the fixed section keys, then any extra
 * sections `sequence` mentions, deduping by batch id.
 */
async function listActiveBatches(): Promise<
  { ok: true; batches: BatchInfo[] } | { ok: false; message: string }
> {
  if (batchCache) return { ok: true, batches: batchCache };
  const res = await call<RawBatchList>("/searchCondition/listBatch", {
    channel: DEFAULT_CHANNEL,
    language: "zh",
  });
  if (!res.ok || !res.data) {
    return { ok: false, message: `Alibaba batch list failed: ${res.message}` };
  }

  const sections: string[] = [...BATCH_SECTIONS];
  for (const s of res.data.sequence ?? []) {
    if (!sections.includes(s)) sections.push(s);
  }

  const seen = new Set<number>();
  const batches: BatchInfo[] = [];
  for (const section of sections) {
    const list = (res.data as Record<string, unknown>)[section];
    if (!Array.isArray(list)) continue;
    for (const b of list as RawBatch[]) {
      if (typeof b?.id !== "number" || seen.has(b.id)) continue;
      seen.add(b.id);
      batches.push({
        batchId: b.id,
        batchName: b.name ?? "",
        batchNameEn: b.enName ?? "",
        category: section,
        recruitType: b.type ?? "",
        remark: b.remark ?? "",
      });
    }
  }
  if (!batches.length) {
    return { ok: false, message: "Alibaba listBatch returned no active batches" };
  }
  batchCache = batches;
  return { ok: true, batches };
}

/**
 * campus → graduate-section batches (校招正式); intern → internship-section
 * batches (2027届实习生 + 日常 + 研究型); all / omitted → every unique batch.
 * (`social` never reaches here — the dispatcher gates it via supportedScopes.)
 */
function batchesForScope(batches: BatchInfo[], scope?: PositionScope): BatchInfo[] {
  if (scope === "campus") return batches.filter((b) => b.category === "graduate");
  if (scope === "intern") return batches.filter((b) => b.category === "internship");
  return batches;
}

function emptyScopeNote(scope: PositionScope): string {
  return scope === "campus"
    ? "no graduate (校招正式) batch is currently open on campus-talent.alibaba.com — it typically opens Aug–Oct; try --scope intern or --scope all"
    : `no active batches for --scope ${scope} on campus-talent.alibaba.com — try --scope all`;
}

// ---------- PositionSummary ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  batch_name: string;
  apply_url: string;
}

function summarizePosition(item: RawPosition): PositionSummary {
  const id = String(item.id ?? "");
  return {
    post_id: id,
    title: item.name ?? "",
    project: item.categoryName ?? "",
    recruit_label: item.categoryType ?? "",
    bgs: (item.circleNames ?? [])[0] ?? "",
    work_cities: (item.workLocations ?? []).join(" / "),
    batch_name: item.batchName ?? "",
    apply_url: id ? DETAIL_PAGE(id) : CAMPUS_PAGE,
  };
}

// ---------- low-level single-batch page fetch ----------

interface SearchContent {
  datas?: RawPosition[];
  totalCount?: number;
}

interface BatchFilters {
  searchKey?: string;
  subCategories?: string;
  regions?: string;
  customDeptCode?: string;
}

function joinFilter(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v.join(",") : v;
}

async function searchBatchPage(
  batchId: number,
  pageIndex: number,
  pageSize: number,
  filters: BatchFilters
): Promise<
  { ok: true; totalCount: number; rows: RawPosition[] } | { ok: false; message: string }
> {
  const body: Record<string, unknown> = {
    batchId,
    pageIndex,
    pageSize,
    channel: DEFAULT_CHANNEL,
    language: "zh",
  };
  if (filters.searchKey) body.searchKey = filters.searchKey;
  if (filters.subCategories) body.subCategories = filters.subCategories;
  if (filters.regions) body.regions = filters.regions;
  if (filters.customDeptCode) body.customDeptCode = filters.customDeptCode;

  const response = await call<SearchContent>("/position/search", body);
  if (!response.ok || !response.data) {
    return { ok: false, message: response.message };
  }
  const rows = response.data.datas ?? [];
  return { ok: true, totalCount: response.data.totalCount ?? rows.length, rows };
}

// ---------- search ----------

export interface SearchOptions {
  /** Full-text keyword. Sent as `searchKey` which the server does filter on. */
  keyword?: string;
  /** CLI `--scope` (1.2.x): campus → graduate batches, intern → internship
   *  batches, all/omitted → every active batch. */
  scope?: PositionScope;
  page?: number;
  pageSize?: number;
  /**
   * Pin the query to ONE batch (bypasses batch discovery + scope mapping).
   * Omit to search every active batch for the scope. Retrieve batchIds via
   * fetchDictionaries().
   */
  batchId?: number;
  /**
   * Category filter values (comma-joined string or array). Values come from
   * fetchDictionaries().batches[n].filters.categories.
   * Examples: "11" (技术类), ["11","1"] (技术+产品).
   */
  subCategories?: string | string[];
  /**
   * City filter (comma-joined string or array). Values come from
   * fetchDictionaries().batches[n].filters.cities.
   * Examples: "北京", ["北京","上海"].
   */
  regions?: string | string[];
  /**
   * BU / dept leaf-level codes (comma-joined string or array). Use CHILD codes
   * from fetchDictionaries().batches[n].filters.customDepts[*].children[*].value.
   * Parent-level codes (e.g. "60002") return 0 results — use child codes only.
   */
  customDeptCode?: string | string[];
}

interface BatchBreakdown {
  batch_id: number;
  batch_name: string;
  category: string;
  total: number;
}

/**
 * Cross-batch search with exact merged pagination.
 *
 * The upstream has NO all-batches call, so the merged result is the fixed-order
 * concatenation graduate → internship → topTalentPlan of per-batch server-side
 * results (searchKey is applied by the server inside each batch). Page N of the
 * merged list is served via offset math over per-batch totalCounts: batches
 * outside the window only cost a pageSize=1 probe; batches covering the window
 * cost at most a probe plus 2 page fetches each.
 */
export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const filters: BatchFilters = {
    searchKey: (opts.keyword ?? "").trim().slice(0, 60) || undefined,
    subCategories: joinFilter(opts.subCategories),
    regions: joinFilter(opts.regions),
    customDeptCode: joinFilter(opts.customDeptCode),
  };

  const fail = (message: string, query: Record<string, unknown>) => ({
    ok: false as const,
    source: SOURCE,
    message,
    query,
    page,
    page_size: pageSize,
    total: 0,
    positions: [] as PositionSummary[],
  });

  // Explicit --batch-id pins a single batch (pre-1.2 behavior preserved).
  if (opts.batchId !== undefined) {
    const query = { ...filters, batchId: opts.batchId, pageIndex: page, pageSize };
    const r = await searchBatchPage(opts.batchId, page, pageSize, filters);
    if (!r.ok) return fail(r.message, query);
    return {
      ok: true as const,
      source: SOURCE,
      query,
      page,
      page_size: pageSize,
      total: r.totalCount,
      positions: r.rows.map(summarizePosition),
    };
  }

  const discovered = await listActiveBatches();
  const scopeLabel = opts.scope ?? "all";
  const baseQuery = { ...filters, scope: scopeLabel, pageIndex: page, pageSize };
  if (!discovered.ok) return fail(discovered.message, baseQuery);

  const batches = batchesForScope(discovered.batches, opts.scope);
  const query = { ...baseQuery, batchIds: batches.map((b) => b.batchId) };
  if (!batches.length) {
    return {
      ok: true as const,
      source: SOURCE,
      query,
      page,
      page_size: pageSize,
      total: 0,
      note: emptyScopeNote(opts.scope ?? "all"),
      batches: [] as BatchBreakdown[],
      positions: [] as PositionSummary[],
    };
  }

  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  let cum = 0; // rows (for these filters) in batches processed so far
  const merged: PositionSummary[] = [];
  const breakdown: BatchBreakdown[] = [];

  for (const b of batches) {
    // totalCount is ONLY trustworthy when the requested pageIndex is in range:
    // an out-of-range pageIndex returns {totalCount: 0, datas: []} (verified
    // 2026-07-11: batch 100000700001 has 172 rows; pageIndex=3&pageSize=100
    // → totalCount=0). So the count must come from an in-range request —
    // either the window fetch itself when it starts at the batch head, or a
    // pageIndex=1&pageSize=1 probe otherwise.
    let count: number;
    const localStart = Math.max(0, start - cum);
    let firstFetch: { rows: RawPosition[]; pageIndex: number } | null = null;
    if (cum < end && localStart === 0) {
      // Window covers this batch from its head — page 1 doubles as the probe.
      const r1 = await searchBatchPage(b.batchId, 1, pageSize, filters);
      if (!r1.ok) return fail(`batch ${b.batchId} (${b.batchName}): ${r1.message}`, query);
      count = r1.totalCount;
      firstFetch = { rows: r1.rows, pageIndex: 1 };
    } else {
      const probe = await searchBatchPage(b.batchId, 1, 1, filters);
      if (!probe.ok) return fail(`batch ${b.batchId} (${b.batchName}): ${probe.message}`, query);
      count = probe.totalCount;
    }

    const localEnd = Math.min(count, end - cum);
    if (cum < end && localEnd > localStart) {
      const collect = (rows: RawPosition[], pageIndex: number) => {
        const pageBase = (pageIndex - 1) * pageSize;
        rows.forEach((row, i) => {
          const g = pageBase + i;
          if (g >= localStart && g < localEnd) merged.push(summarizePosition(row));
        });
      };
      // The local window spans at most 2 server pages of size pageSize.
      const p1 = Math.floor(localStart / pageSize) + 1;
      const p2 = Math.floor((localEnd - 1) / pageSize) + 1;
      for (let p = p1; p <= p2; p++) {
        if (firstFetch && firstFetch.pageIndex === p) {
          collect(firstFetch.rows, p);
          continue;
        }
        const r = await searchBatchPage(b.batchId, p, pageSize, filters);
        if (!r.ok) return fail(`batch ${b.batchId} (${b.batchName}): ${r.message}`, query);
        collect(r.rows, p);
      }
    }
    breakdown.push({ batch_id: b.batchId, batch_name: b.batchName, category: b.category, total: count });
    cum += count;
  }

  return {
    ok: true as const,
    source: SOURCE,
    query,
    page,
    page_size: pageSize,
    /** Sum of per-batch server-side totalCounts for the same filters. */
    total: cum,
    batches: breakdown,
    positions: merged,
  };
}

// ---------- fetch all ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchAllPositions(
  opts: {
    keyword?: string;
    scope?: PositionScope;
    /** Page cap PER BATCH (default 20 → 2000 rows/batch at pageSize 100). */
    maxPages?: number;
    pageSize?: number;
    /** Pin the sweep to ONE batch (bypasses discovery + scope mapping). */
    batchId?: number;
    subCategories?: string | string[];
    regions?: string | string[];
    customDeptCode?: string | string[];
  } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 20);
  const filters: BatchFilters = {
    searchKey: (opts.keyword ?? "").trim().slice(0, 60) || undefined,
    subCategories: joinFilter(opts.subCategories),
    regions: joinFilter(opts.regions),
    customDeptCode: joinFilter(opts.customDeptCode),
  };

  let batches: BatchInfo[];
  if (opts.batchId !== undefined) {
    batches = [
      {
        batchId: opts.batchId,
        batchName: `batch ${opts.batchId}`,
        batchNameEn: "",
        category: "explicit",
        recruitType: "",
        remark: "",
      },
    ];
  } else {
    const discovered = await listActiveBatches();
    if (!discovered.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        message: discovered.message,
        fetched: 0,
        positions: [] as PositionSummary[],
      };
    }
    batches = batchesForScope(discovered.batches, opts.scope);
    if (!batches.length) {
      return {
        ok: true as const,
        source: SOURCE,
        total: 0,
        fetched: 0,
        note: emptyScopeNote(opts.scope ?? "all"),
        batches: [] as Array<BatchBreakdown & { fetched: number }>,
        positions: [] as PositionSummary[],
      };
    }
  }

  const seen = new Set<string>(); // cross-batch dedup by post_id
  const bucket: PositionSummary[] = [];
  let totalSum = 0;
  let anyTruncated = false;
  const breakdown: Array<BatchBreakdown & { fetched: number }> = [];

  for (const b of batches) {
    let count: number | undefined;
    const inBatch = new Set<string>(); // detect upstream pagination loops
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(120); // stay polite — no hammering
      const r = await searchBatchPage(b.batchId, page, pageSize, filters);
      if (!r.ok) {
        return {
          ok: false as const,
          source: SOURCE,
          message: `batch ${b.batchId} (${b.batchName}) page ${page}: ${r.message}`,
          fetched: bucket.length,
          positions: bucket,
        };
      }
      if (count === undefined) count = r.totalCount;
      if (!r.rows.length) break;
      let newInBatch = 0;
      for (const row of r.rows) {
        const s = summarizePosition(row);
        if (!s.post_id || inBatch.has(s.post_id)) continue;
        inBatch.add(s.post_id);
        newInBatch++;
        if (seen.has(s.post_id)) continue;
        seen.add(s.post_id);
        bucket.push(s);
      }
      if (!newInBatch) break; // server repeated a page — bail this batch
      if (inBatch.size >= count) break; // batch exhausted
      if (r.rows.length < pageSize) break; // short page — upstream is done
    }
    const exhausted = count !== undefined && inBatch.size >= count;
    if (!exhausted) anyTruncated = true;
    totalSum += count ?? 0;
    breakdown.push({
      batch_id: b.batchId,
      batch_name: b.batchName,
      category: b.category,
      total: count ?? 0,
      fetched: inBatch.size,
    });
  }

  return {
    ok: true as const,
    source: SOURCE,
    /** Sum of per-batch totalCounts; `fetched` is unique post_ids collected. */
    total: totalSum,
    fetched: bucket.length,
    ...(anyTruncated ? { truncated: true as const } : {}),
    batches: breakdown,
    positions: bucket,
  };
}

// ---------- position detail ----------

export async function fetchPositionDetail(postId: string | number) {
  const id = String(postId ?? "").trim();
  if (!id) return { ok: false as const, message: "post_id is required" };

  const numId = Number(id);
  const body = { id: Number.isNaN(numId) ? id : numId };

  const response = await call<RawPosition>("/position/detail", body);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      source: SOURCE,
      message: response.message || "no detail returned",
      post_id: id,
    };
  }

  const raw = response.data;
  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(raw.id ?? id),
    title: raw.name ?? "",
    direction: raw.categoryName ?? "",
    description: (raw.description ?? "").trim(),
    requirements: (raw.requirement ?? "").trim(),
    work_cities: raw.workLocations ?? [],
    recruit_cities: raw.interviewLocations ?? [],
    bgs: (raw.circleNames ?? [])[0] ?? "",
    batch_name: raw.batchName ?? "",
    apply_url: DETAIL_PAGE(raw.id ?? id),
  };
}

// ---------- dictionaries: real batch list + filter taxonomy ----------

interface RawSearchConditionItem {
  label: string;
  value: string;
  positionCountNotHC?: number;
  children?: RawSearchConditionItem[] | null;
}

interface RawSearchCondition {
  type: string;
  title: string;
  items?: RawSearchConditionItem[] | null;
}

interface RawSearchConditionList {
  searchItems?: RawSearchCondition[] | null;
  totalPositions?: number | null;
}

export async function fetchDictionaries() {
  // Step 1: discover all active batches (fixed-section iteration + id dedup)
  const discovered = await listActiveBatches();
  if (!discovered.ok) {
    return { ok: false as const, message: discovered.message };
  }

  // Step 2: for each unique batch, fetch the filter taxonomy
  const batches = await Promise.all(
    discovered.batches.map(async (batch) => {
      const condRes = await call<RawSearchConditionList>("/searchCondition/list", {
        batchId: batch.batchId,
        channel: DEFAULT_CHANNEL,
        language: "zh",
      });
      const searchItems = condRes.data?.searchItems ?? [];
      const filters: {
        categories: Array<{ label: string; value: string }>;
        cities: Array<{ label: string; value: string }>;
        customDepts: Array<{
          label: string;
          value: string;
          children?: Array<{ label: string; value: string }>;
        }>;
      } = { categories: [], cities: [], customDepts: [] };

      for (const si of searchItems) {
        const items = si.items ?? [];
        if (si.type === "category") {
          filters.categories = items.map((x) => ({ label: x.label, value: x.value }));
        } else if (si.type === "workCity") {
          filters.cities = items.map((x) => ({ label: x.label, value: x.value }));
        } else if (si.type === "customDept") {
          filters.customDepts = items.map((x) => ({
            label: x.label,
            value: x.value,
            children: x.children?.map((c) => ({ label: c.label, value: c.value })),
          }));
        }
      }

      return {
        batchId: batch.batchId,
        batchName: batch.batchName,
        batchNameEn: batch.batchNameEn,
        category: batch.category, // "graduate" | "internship" | "topTalentPlan"
        recruitType: batch.recruitType, // "graduate" | "trainee" | "talent_plan" | "aliStar"
        remark: batch.remark,
        totalPositions: condRes.data?.totalPositions ?? null,
        filters,
      };
    })
  );

  const hasGraduate = discovered.batches.some((b) => b.category === "graduate");
  return {
    ok: true as const,
    source: SOURCE,
    note:
      "batchId is mandatory for /position/search — search/all loop every active batch " +
      "automatically (--scope campus → graduate, intern → internship, all → everything); " +
      "pass --batch-id to pin one. " +
      (hasGraduate
        ? "A graduate (校招正式) batch is OPEN — use --scope campus for it. "
        : "No graduate (校招正式) batch is currently open; it typically opens Aug–Oct. ") +
      "customDeptCode requires CHILD-level codes (leaf nodes), not parent group codes.",
    batches,
  };
}

export async function listNotices() {
  return {
    ok: false as const,
    message: "Alibaba: no public notices endpoint",
  };
}

export async function getNotice(_id: string) {
  return {
    ok: false as const,
    message: "Alibaba: no public notice detail endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    message: "Alibaba: no public notices endpoint",
    matches: [],
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

  const queries = pickDistinctiveTerms(terms, 3);
  if (!queries.length) queries.push(terms[0] ?? "");
  const lists = await Promise.all(queries.map((q) => searchPositions({ keyword: q, page: 1, pageSize: 100 })));
  const seen = new Set<string>();
  const pool: PositionSummary[] = [];
  let lastErr: string | undefined;
  for (const l of lists) {
    if (!l.ok) { lastErr = (l as { message?: string }).message; continue; }
    for (const p of l.positions) {
      if (!seen.has(p.post_id)) { seen.add(p.post_id); pool.push(p); }
    }
  }
  if (!pool.length) {
    const broad = await searchPositions({ page: 1, pageSize: 100 });
    if (broad.ok) pool.push(...broad.positions);
  }
  if (!pool.length) {
    return { ok: false as const, message: lastErr ?? "no positions returned", positions: [] };
  }

  type Pre = { score: number; position: PositionSummary; reasons: string[] };
  const pre: Pre[] = [];
  for (const p of pool) {
    const blob = [p.title, p.project, p.recruit_label, p.bgs, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) pre.push({ score, position: p, reasons });
  }
  pre.sort((a, b) => b.score - a.score);

  let shortlist = pre.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = pool.slice(0, candidates).map((position) => ({
      score: 0,
      position,
      reasons: [],
    }));
  }

  type Enriched = {
    score: number;
    row: PositionSummary & {
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
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    matches: enriched.slice(0, topN).map((e) => e.row),
    note:
      "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
      "The only authority on selection is HR.",
  };
}
