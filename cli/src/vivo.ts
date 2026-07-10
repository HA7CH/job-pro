// vivo careers adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (re-probed 2026-07-11 — full rewrite)
//
// The 2026-05-15 probe wrongly concluded hr.vivo.com was an internal BPM
// portal and pointed this adapter at vivo.zhiye.com — which is the *employee*
// portal (「vivo员工招聘」, ~36 operations roles: 客服/厨师/助理…). That missed
// every professional/engineering opening. Audited 2026-07: CLI搜「工程师」
// total=1，搜「算法」total=0，while the real official site had 257/…
//
// vivo actually runs TWO public career sites:
//
// 1. SOCIAL — https://hr.vivo.com (title「vivo招聘官方网站」, project
//    "hr-official", a vivo-built SPA). Anonymous JSON API base
//    /api/social/webSite (extracted from Jobs SPA chunk
//    useJobsRecommend.02a9ab82.js, service registrations via
//    vuiAjax.registerService):
//
//      POST /api/social/webSite/portal/page        → paginated job list
//           body {keyword, page (1-based), max_results, city_code_list:[],
//                 yoe_list:[], company_id:1, group_id:1}
//           resp {code:0, data:[…], meta:{page,total,page_count,max_results}}
//           (verified 2026-07-11: keyword=工程师 → meta.total=257; empty
//           keyword → meta.total=685; max_results honored 1..100; page
//           beyond page_count → data:[] with meta intact)
//      POST /api/social/webSite/portal/jobList     → UNPAGED variant used by
//           the locations page — ignores paging fields, returns everything.
//           Not used here; portal/page is the real list.
//      POST /api/social/webSite/portal/job/detail  → {job_id} → full record
//           incl. job_desc (verified: echoes the requested job_id; bogus id
//           → code:100000 error)
//      POST /api/social/webSite/portal/jobCategory → category tree
//      POST /api/social/webSite/portal/workplace   → city list
//
//    job_id is an "M"-prefixed entity id (e.g. M2075067003919405057). The
//    human detail page is /job-detail?_irjid=<job_id> — the short query key
//    map lives in assets/mock.33e336cc.js (getQueryKey:
//    internalReferralJobId → "_irjid", keyword → "_kw").
//
// 2. CAMPUS + INTERN — https://hr-campus.vivo.com, a Beisen (北森) 2022
//    recruitment portal (tenant 612022, PortalId
//    903cbcbf-4898-46e1-817c-da522a9752b1 — read from the BSGlobal bootstrap
//    blob in the page HTML). Same GetJobAdPageList API as the old employee
//    portal but a different Portal with the real student openings:
//
//      POST /api/Jobad/GetJobAdPageList
//           body {PageIndex (0-based), PageSize (1..100 honored), KeyWords,
//                 SpecialType:0, PortalId, Category?: ["2"|"3"], …}
//           resp {Code:200, Count, Data:[…]} — rows carry full Duty/Require.
//           (verified 2026-07-11: Count=169 total; KeyWords=工程师 → 114;
//           Category ["2"] 校园招聘=27, ["3"] 实习生招聘=142; keyword+category
//           combine server-side: 工程师+["2"]=24, +["3"]=90)
//
//    CAVEAT: the JobAdIds body field is silently IGNORED by this upstream
//    (verified 2026-07-11: JobAdIds:[561271266] still returns Count:169 and
//    the unfiltered first page) — this was the root cause of the 1.1.14
//    detail bug where every `vivo detail <id>` returned the same first-page
//    job. Detail for numeric Beisen ids is therefore a bounded page sweep
//    with a strict JobAdId equality check.
//
// vivo.zhiye.com (employee portal) is intentionally no longer queried.
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Channel map (1.2.x rewrite):
 *
 * `--scope social` → hr.vivo.com  /api/social/webSite/portal/page
 * `--scope campus` → hr-campus.vivo.com Beisen Category ["2"] (校园招聘)
 * `--scope intern` → hr-campus.vivo.com Beisen Category ["3"] (实习生招聘)
 * `--scope all`    → social + whole campus portal (no Category), merged
 * omitted          → social (hr.vivo.com is vivo's primary careers site)
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const;

const SOCIAL_SOURCE = "hr.vivo.com";
const CAMPUS_SOURCE = "hr-campus.vivo.com";
const MERGED_SOURCE = "hr.vivo.com + hr-campus.vivo.com";

const SOCIAL_ROOT = "https://hr.vivo.com";
const CAMPUS_ROOT = "https://hr-campus.vivo.com";
// Beisen tenant 612022 campus portal (from BSGlobal in the page HTML).
const CAMPUS_PORTAL_ID = "903cbcbf-4898-46e1-817c-da522a9752b1";

const SOCIAL_DETAIL_PAGE = (id: string) =>
  `${SOCIAL_ROOT}/job-detail?_irjid=${encodeURIComponent(id)}`;
// Beisen 2022 portal registers /campus/detail and /intern/detail routes
// (both respond 200 on hr-campus.vivo.com, verified 2026-07-11).
const CAMPUS_DETAIL_PAGE = (id: string, categoryId?: string) =>
  `${CAMPUS_ROOT}/${categoryId === "3" ? "intern" : "campus"}/detail?jobAdId=${encodeURIComponent(id)}`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// ---------- low-level fetch (single backoff retry for WAF/5xx hiccups) ----------

async function postJson(url: string, referer: string, body: unknown): Promise<{
  ok: boolean;
  status?: number;
  payload?: unknown;
  message: string;
}> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Content-Type": "application/json",
          Referer: referer,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return {
        ok: false,
        message: `network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!response.ok) {
      // Some hr.vivo.com API errors ride on HTTP 500 with a JSON envelope
      // (e.g. bogus job_id → 500 {"code":100000,...}). If the error body is
      // parseable JSON it is a deterministic API error — surface it to the
      // caller instead of retrying.
      try {
        const payload = await response.json();
        return {
          ok: false,
          status: response.status,
          payload,
          message: `HTTP ${response.status}`,
        };
      } catch {
        /* non-JSON body — fall through to retry/report */
      }
      // Back off once on rate-limit / transient upstream errors, then give up
      // cleanly instead of hammering the WAF.
      if (attempt < 1 && (response.status === 429 || response.status >= 500)) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return {
        ok: false,
        status: response.status,
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    try {
      return { ok: true, status: response.status, payload: await response.json(), message: "ok" };
    } catch (err) {
      return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
    }
  }
}

// ---------- social channel (hr.vivo.com /api/social/webSite) ----------

interface SocialLocation {
  city?: string;
  location?: string;
}

interface SocialJob {
  job_id?: string;
  job_code?: string;
  job_title?: string;
  requirement_org_name?: string;
  degree_range_name?: string;
  yoe_min?: number;
  yoe_max?: number;
  job_location_list?: SocialLocation[];
  head_count?: number;
  job_desc?: string;
  job_category?: string;
  hot?: boolean;
  publish_timestamp?: number;
}

interface SocialEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
  meta?: { page?: number; total?: number; page_count?: number; max_results?: number };
  success?: boolean;
}

async function socialCall<T>(path: string, body: unknown): Promise<{
  ok: boolean;
  data?: T;
  meta?: SocialEnvelope<T>["meta"];
  message: string;
}> {
  const r = await postJson(`${SOCIAL_ROOT}/api/social/webSite/${path}`, `${SOCIAL_ROOT}/jobs`, body);
  // API errors can arrive on non-2xx statuses with a JSON envelope — prefer
  // the envelope's own code/message over a bare "HTTP 500".
  if (!r.ok && r.payload === undefined) return { ok: false, message: r.message };
  const payload = r.payload as SocialEnvelope<T>;
  if (payload.code !== 0) {
    return { ok: false, message: payload.message || `upstream code ${payload.code}` };
  }
  return { ok: true, data: payload.data, meta: payload.meta, message: "ok" };
}

function socialCities(job: SocialJob): string {
  const list = Array.isArray(job.job_location_list) ? job.job_location_list : [];
  const cities = [...new Set(list.map((l) => (l.city ?? "").trim()).filter(Boolean))];
  return cities.join(", ");
}

function summarizeSocial(job: SocialJob): PositionSummary {
  const id = String(job.job_id ?? "");
  return {
    post_id: id,
    title: (job.job_title ?? "").trim(),
    project: (job.requirement_org_name ?? "").trim(),
    recruit_label: "社会招聘",
    bgs: (job.job_category ?? "").trim(),
    work_cities: socialCities(job),
    apply_url: id ? SOCIAL_DETAIL_PAGE(id) : `${SOCIAL_ROOT}/jobs`,
  };
}

async function searchSocial(opts: { keyword?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const body = {
    keyword: (opts.keyword ?? "").trim().slice(0, 60),
    page,
    max_results: pageSize,
    city_code_list: [] as string[],
    yoe_list: [] as string[],
    company_id: 1,
    group_id: 1,
  };
  const r = await socialCall<SocialJob[]>("portal/page", body);
  if (!r.ok) {
    return {
      ok: false as const,
      source: SOCIAL_SOURCE,
      message: r.message,
      query: body as Record<string, unknown>,
      positions: [] as PositionSummary[],
    };
  }
  const rows = r.data ?? [];
  return {
    ok: true as const,
    source: SOCIAL_SOURCE,
    query: body as Record<string, unknown>,
    page,
    page_size: pageSize,
    // meta.total is the server-side keyword-filtered count (verified:
    // 工程师 → 257 while data carries one page) — never the page length.
    total: r.meta?.total ?? rows.length,
    positions: rows.map(summarizeSocial),
  };
}

// ---------- campus channel (hr-campus.vivo.com Beisen portal) ----------

interface RawJobAd {
  Id?: string;
  JobAdId?: number | string;
  JobAdName?: string;
  Category?: string;
  CategoryId?: string;
  Org?: string;
  LocNames?: string[];
  Salary?: string;
  Kind?: string;
  HeadCount?: number;
  PostDate?: string;
  Duty?: string;
  Require?: string;
}

interface BeisenEnvelope<T> {
  Code?: number;
  Message?: string;
  Data?: T;
  Count?: number;
}

/** Beisen Category axis on the hr-campus portal: "2"=校园招聘, "3"=实习生招聘. */
function campusCategoryFromScope(scope?: PositionScope): string[] | undefined {
  if (scope === "campus") return ["2"];
  if (scope === "intern") return ["3"];
  return undefined; // whole portal (used by scope=all fan-out + detail sweep)
}

async function campusCall(
  body: Record<string, unknown>,
  root: string = CAMPUS_ROOT
): Promise<{
  ok: boolean;
  data?: RawJobAd[];
  count?: number;
  message: string;
}> {
  const r = await postJson(`${root}/api/Jobad/GetJobAdPageList`, `${root}/jobs`, body);
  if (!r.ok && r.payload === undefined) return { ok: false, message: r.message };
  const payload = r.payload as BeisenEnvelope<RawJobAd[]>;
  if (payload.Code !== 200) {
    return { ok: false, message: payload.Message || `upstream Code ${payload.Code}` };
  }
  return { ok: true, data: payload.Data ?? [], count: payload.Count, message: "ok" };
}

function summarizeCampus(item: RawJobAd): PositionSummary {
  const id = String(item.JobAdId ?? item.Id ?? "");
  return {
    post_id: id,
    title: (item.JobAdName ?? "").trim(),
    project: (item.Org ?? "").trim(),
    recruit_label: (item.Category ?? "").trim(),
    bgs: "",
    work_cities: Array.isArray(item.LocNames) ? item.LocNames.join(", ") : "",
    apply_url: id ? CAMPUS_DETAIL_PAGE(id, item.CategoryId) : `${CAMPUS_ROOT}/jobs`,
  };
}

async function searchCampus(opts: {
  keyword?: string;
  page?: number;
  pageSize?: number;
  scope?: PositionScope;
}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const body: Record<string, unknown> = {
    // Beisen PageIndex is zero-based (verified: PageIndex 0..3 @50 → 169
    // unique JobAdIds, short last page of 19).
    PageIndex: page - 1,
    PageSize: pageSize,
    // KeyWords filters server-side (verified: 工程师 → Count 114 vs 169).
    KeyWords: (opts.keyword ?? "").trim().slice(0, 60),
    SpecialType: 0,
    PortalId: CAMPUS_PORTAL_ID,
    DisplayFields: ["Category", "Kind", "LocId", "Org", "HeadCount", "PostDate", "Salary"],
  };
  const category = campusCategoryFromScope(opts.scope);
  if (category) body.Category = category;

  const r = await campusCall(body);
  if (!r.ok) {
    return {
      ok: false as const,
      source: CAMPUS_SOURCE,
      message: r.message,
      query: body,
      positions: [] as PositionSummary[],
    };
  }
  const rows = r.data ?? [];
  return {
    ok: true as const,
    source: CAMPUS_SOURCE,
    query: body,
    page,
    page_size: pageSize,
    // Count is the server-side filtered total for the requested
    // KeyWords/Category combination — never the page length.
    total: r.count ?? rows.length,
    positions: rows.map(summarizeCampus),
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
   * Canonical CLI-side scope flag. `social` → hr.vivo.com; `campus`/`intern`
   * → hr-campus.vivo.com (Beisen Category 2/3); `all` → both merged;
   * omitted → `social` (hr.vivo.com is vivo's primary careers site — the
   * pre-1.2 vivo.zhiye.com employee-portal default is retired).
   */
  scope?: PositionScope;
  /** @deprecated kept for 1.0.93 callers — same value space as `scope`. */
  recruitType?: PositionScope;
}

// ---------- searchPositions ----------

async function searchMerged(opts: SearchOptions) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const merged: PositionSummary[] = [];
  const seen = new Set<string>();
  const totals: Record<string, number> = {};

  const [social, campus] = await Promise.all([
    searchSocial({ keyword: opts.keyword, page, pageSize }),
    searchCampus({ keyword: opts.keyword, page, pageSize }),
  ]);
  const failures: string[] = [];
  for (const [name, r] of [
    ["social", social],
    ["campus", campus],
  ] as const) {
    if (!r.ok) {
      failures.push(`[${name}] ${r.message}`);
      continue;
    }
    totals[name] = r.total;
    for (const p of r.positions) {
      if (seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      merged.push(p);
    }
  }
  if (failures.length === 2) {
    return {
      ok: false as const,
      source: MERGED_SOURCE,
      message: `all channels failed: ${failures.join("; ")}`,
      query: { keyword: opts.keyword ?? "", page, page_size: pageSize, scope: "all" },
      positions: [] as PositionSummary[],
    };
  }
  return {
    ok: true as const,
    source: MERGED_SOURCE,
    query: {
      keyword: opts.keyword ?? "",
      page,
      page_size: pageSize,
      scope: "all",
      totals,
      ...(failures.length ? { channel_errors: failures } : {}),
    },
    page,
    page_size: pageSize,
    total: (totals.social ?? 0) + (totals.campus ?? 0),
    positions: merged,
  };
}

export async function searchPositions(opts: SearchOptions = {}) {
  const scope = opts.scope ?? opts.recruitType;
  if (scope === "all") return searchMerged(opts);
  if (scope === "campus" || scope === "intern") {
    return searchCampus({
      keyword: opts.keyword,
      page: opts.page,
      pageSize: opts.pageSize,
      scope,
    });
  }
  return searchSocial({ keyword: opts.keyword, page: opts.page, pageSize: opts.pageSize });
}

// ---------- fetchAllPositions ----------

type SweepChannel =
  | { name: "social"; scope?: undefined }
  | { name: "campus"; scope?: PositionScope };

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
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 20);
  const scope = opts.scope ?? opts.recruitType;

  const channels: SweepChannel[] =
    scope === "all"
      ? [{ name: "social" }, { name: "campus" }]
      : scope === "campus" || scope === "intern"
        ? [{ name: "campus", scope }]
        : [{ name: "social" }];
  const source =
    scope === "all" ? MERGED_SOURCE : channels[0].name === "campus" ? CAMPUS_SOURCE : SOCIAL_SOURCE;

  const seen = new Set<string>();
  const bucket: PositionSummary[] = [];
  const totals: Record<string, number> = {};
  let truncated = false;

  channelLoop: for (const channel of channels) {
    let channelTotal: number | undefined;
    let fetchedThisChannel = 0;
    let complete = false;
    for (let page = 1; page <= maxPages; page++) {
      const r =
        channel.name === "social"
          ? await searchSocial({ keyword: opts.keyword, page, pageSize })
          : await searchCampus({ keyword: opts.keyword, page, pageSize, scope: channel.scope });
      if (!r.ok) {
        if (bucket.length === 0) {
          return {
            ok: false as const,
            source,
            message: r.message,
            total: 0,
            fetched: 0,
            positions: [] as PositionSummary[],
          };
        }
        // Mid-sweep failure: return what we have, flagged as truncated.
        truncated = true;
        break channelLoop;
      }
      channelTotal = r.total;
      fetchedThisChannel += r.positions.length;
      // De-dupe by post_id so an upstream paging regression can never
      // inflate the result with duplicates.
      let added = 0;
      for (const p of r.positions) {
        if (seen.has(p.post_id)) continue;
        seen.add(p.post_id);
        bucket.push(p);
        added += 1;
      }
      if (channelTotal !== undefined && fetchedThisChannel >= channelTotal) {
        complete = true;
        break;
      }
      if (r.positions.length < pageSize) {
        // Short page — upstream has no more rows for this channel.
        complete = true;
        break;
      }
      if (added === 0) break; // full page, zero new ids: no forward progress
    }
    if (channelTotal !== undefined) totals[channel.name] = channelTotal;
    if (!complete && (channelTotal === undefined || fetchedThisChannel < channelTotal)) {
      truncated = true;
    }
  }

  const total = Object.values(totals).reduce((sum, n) => sum + n, 0);
  return {
    ok: true as const,
    source,
    // Sum of the upstream's own per-channel totals; with a keyword it is the
    // server-side-filtered count, matching `search` semantics.
    total,
    fetched: bucket.length,
    ...(channels.length > 1 ? { totals } : {}),
    ...(truncated ? { truncated: true as const } : {}),
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------
//
// Two id namespaces:
//   * social ids are Beisen-unrelated "M…" entity ids → dedicated detail
//     endpoint that echoes the id (strictly re-checked below anyway);
//   * campus ids are numeric Beisen JobAdIds. The Beisen list endpoint
//     IGNORES the JobAdIds filter (root cause of the 1.1.14 wrong-JD bug),
//     so we sweep the whole portal (bounded: Count=169 → 2 pages @100) and
//     match on JobAdId equality. Rows carry full Duty/Require.

const DETAIL_SWEEP_PAGE_SIZE = 100;
const DETAIL_SWEEP_MAX_PAGES = 10; // 1000 postings — portal has ~169 today

async function fetchSocialDetail(id: string) {
  const r = await socialCall<SocialJob>("portal/job/detail", { job_id: id });
  if (!r.ok || !r.data) {
    return {
      ok: false as const,
      source: SOCIAL_SOURCE,
      message: r.message === "ok" ? "no detail returned" : r.message,
      post_id: id,
    };
  }
  const job = r.data;
  // Strict id check: never present another posting's JD as this id's detail.
  if (String(job.job_id ?? "") !== id) {
    return {
      ok: false as const,
      source: SOCIAL_SOURCE,
      message: `upstream returned job_id ${job.job_id} for requested ${id}`,
      post_id: id,
    };
  }
  const yoe =
    job.yoe_min !== undefined && job.yoe_min !== null
      ? job.yoe_max && job.yoe_max > 0
        ? `${job.yoe_min}-${job.yoe_max}年`
        : `${job.yoe_min}年以上`
      : "";
  return {
    ok: true as const,
    source: SOCIAL_SOURCE,
    post_id: id,
    title: job.job_title ?? "",
    project: job.requirement_org_name ?? "",
    recruit_label: "社会招聘",
    // job_desc carries the full JD (岗位职责 + 任职要求 in one text blob).
    description: (job.job_desc ?? "").trim(),
    requirements: "",
    work_cities: socialCities(job),
    salary: "",
    kind: job.job_category ?? "",
    degree: job.degree_range_name ?? "",
    experience: yoe,
    head_count: job.head_count,
    post_date: job.publish_timestamp ? new Date(job.publish_timestamp).toISOString() : "",
    apply_url: SOCIAL_DETAIL_PAGE(id),
  };
}

// Legacy employee portal (the 1.1.14 adapter's only source). Kept ONLY as a
// detail-lookup fallback so numeric ids printed by older CLI versions still
// resolve; list/search no longer touch it.
const EMPLOYEE_ROOT = "https://vivo.zhiye.com";
const EMPLOYEE_SOURCE = "vivo.zhiye.com";

function employeeDetailPage(id: string, categoryId?: string): string {
  const bt = categoryId === "3" ? "intern" : categoryId === "5" ? "campus" : "social";
  return `${EMPLOYEE_ROOT}/${bt}/detail?jobAdId=${encodeURIComponent(id)}`;
}

interface BeisenSweepHit {
  hit?: RawJobAd;
  count?: number;
  error?: string;
}

async function sweepBeisenPortal(
  id: string,
  root: string,
  portalId: string
): Promise<BeisenSweepHit> {
  let count: number | undefined;
  let scanned = 0;
  for (let page = 1; page <= DETAIL_SWEEP_MAX_PAGES; page++) {
    const r = await campusCall(
      {
        PageIndex: page - 1,
        PageSize: DETAIL_SWEEP_PAGE_SIZE,
        KeyWords: "",
        SpecialType: 0,
        PortalId: portalId,
        DisplayFields: ["Category", "Kind", "LocId", "Org", "HeadCount", "PostDate", "Salary"],
      },
      root
    );
    if (!r.ok) return { error: r.message, count };
    count = r.count ?? count;
    const rows = r.data ?? [];
    scanned += rows.length;
    const hit = rows.find((row) => String(row.JobAdId ?? row.Id ?? "") === id);
    if (hit) return { hit, count };
    if (rows.length < DETAIL_SWEEP_PAGE_SIZE) break; // exhausted
    if (count !== undefined && scanned >= count) break;
  }
  return { count: count ?? scanned };
}

async function fetchCampusDetail(id: string) {
  // Primary: the campus portal. Fallback: the legacy employee portal, so ids
  // from pre-1.2 CLI output don't dead-end.
  const campus = await sweepBeisenPortal(id, CAMPUS_ROOT, CAMPUS_PORTAL_ID);
  if (campus.error) {
    return { ok: false as const, source: CAMPUS_SOURCE, message: campus.error, post_id: id };
  }
  let source = CAMPUS_SOURCE;
  let hit = campus.hit;
  if (!hit) {
    const employee = await sweepBeisenPortal(id, EMPLOYEE_ROOT, "");
    if (employee.hit) {
      source = EMPLOYEE_SOURCE;
      hit = employee.hit;
    }
  }
  if (!hit) {
    return {
      ok: false as const,
      source: CAMPUS_SOURCE,
      message: `post ${id} not found among ${campus.count ?? 0} live hr-campus.vivo.com postings (nor the legacy vivo.zhiye.com employee portal; the Beisen upstream has no working by-id filter — the post may be closed, or it is a social id: social ids start with "M")`,
      post_id: id,
    };
  }
  return {
    ok: true as const,
    source,
    post_id: id,
    title: hit.JobAdName ?? "",
    project: hit.Org ?? "",
    recruit_label: hit.Category ?? "",
    description: (hit.Duty ?? "").trim(),
    requirements: (hit.Require ?? "").trim(),
    work_cities: Array.isArray(hit.LocNames) ? hit.LocNames.join(", ") : "",
    salary: hit.Salary ?? "",
    kind: hit.Kind ?? "",
    head_count: hit.HeadCount,
    post_date: hit.PostDate ?? "",
    apply_url:
      source === EMPLOYEE_SOURCE
        ? employeeDetailPage(id, hit.CategoryId)
        : CAMPUS_DETAIL_PAGE(id, hit.CategoryId),
  };
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return {
      ok: false as const,
      source: MERGED_SOURCE,
      message: "post_id is required",
      post_id: id,
    };
  }
  // Numeric → Beisen campus JobAdId; anything else (M-prefixed) → social.
  if (/^\d+$/.test(id)) return fetchCampusDetail(id);
  return fetchSocialDetail(id);
}

// ---------- fetchDictionaries ----------

async function getJson(url: string, referer: string): Promise<{
  ok: boolean;
  payload?: unknown;
  message: string;
}> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: referer,
      },
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
  try {
    return { ok: true, payload: await response.json(), message: "ok" };
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
}

export async function fetchDictionaries() {
  // The campus portal's GetJobAdSearchConditions rejects every body variant
  // probed 2026-07-11 (Code:400 "parameter exception"), so campus facets are
  // the areas tree (GET, verified) plus live per-category counts from the
  // list endpoint itself.
  const [jobCategory, workplace, areas, campusHire, internHire] = await Promise.all([
    socialCall<unknown>("portal/jobCategory", {}),
    socialCall<unknown>("portal/workplace", {}),
    getJson(`${CAMPUS_ROOT}/api/Jobad/SearchAreasTreeConditions`, `${CAMPUS_ROOT}/jobs`),
    searchCampus({ pageSize: 1, scope: "campus" }),
    searchCampus({ pageSize: 1, scope: "intern" }),
  ]);
  const areasPayload = areas.ok ? (areas.payload as BeisenEnvelope<unknown>) : undefined;
  return {
    ok: jobCategory.ok || workplace.ok || areas.ok,
    source: MERGED_SOURCE,
    verified_at: new Date().toISOString(),
    social: {
      api_host: SOCIAL_ROOT,
      job_categories: jobCategory.data ?? null,
      workplaces: workplace.data ?? null,
    },
    campus: {
      api_host: CAMPUS_ROOT,
      portal_id: CAMPUS_PORTAL_ID,
      areas_tree: areasPayload?.Data ?? null,
      category_map: { "2": "校园招聘", "3": "实习生招聘" },
      live_counts: {
        campus: campusHire.ok ? campusHire.total : null,
        intern: internHire.ok ? internHire.total : null,
      },
    },
  };
}

// ---------- notices ----------

const NO_NOTICES =
  "vivo careers (hr.vivo.com / hr-campus.vivo.com) does not expose a public notices endpoint.";

export async function listNotices() {
  return { ok: false as const, source: MERGED_SOURCE, message: NO_NOTICES, notices: [] as never[] };
}
export async function getNotice(noticeId: string) {
  return { ok: false as const, source: MERGED_SOURCE, message: NO_NOTICES, notice_id: noticeId };
}
export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    source: MERGED_SOURCE,
    question,
    message: NO_NOTICES,
    matches: [] as never[],
  };
}

// ---------- matchResume ----------

export async function matchResume(text: string, opts: { topN?: number; candidates?: number } = {}) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 800);

  // Sweep every channel so campus/intern candidates are matched too.
  const all = await fetchAllPositions({
    scope: "all",
    pageSize: 100,
    maxPages: Math.max(1, Math.ceil(candidates / 100)),
  });
  if (!all.ok) {
    return {
      ok: false as const,
      source: MERGED_SOURCE,
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
    source: MERGED_SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    candidate_pool: all.positions.length,
    matches,
  };
}

export { extractResumeSignals, scoreOverlap };
