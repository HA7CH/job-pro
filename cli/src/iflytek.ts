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
// RE-PROBED 2026-07-11: the Category dictionary drifted. Live labels/IDs are
// 1=社会招聘 (695), 3=飞YOUNG实习生 (27), 4=飞星计划 (8), 5=飞凡计划 (3),
// 6=校园大使 (1) — 734 total. GetJobAdSearchConditions now requires the
// `{"displayFilters":[...]}` body (older `{PortalId,SpecialType}` → 400).
//
// Endpoint inventory (all anon, all on iflytek.zhiye.com):
//   POST /api/Jobad/GetJobAdPageList            → paginated job list
//   POST /api/Jobad/GetJobAdSearchConditions    → filter taxonomy
//   GET  /api/Jobad/GetSpecialJobAdList         → hot/special jobs
//   GET  /api/Jobad/SearchAreasTreeConditions   → city tree
//   GET  /api/Common/GetPortalAIRobot           → portal config
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume, pickDistinctiveTerms } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Beisen iTalent Category-axis mapping for the iflytek tenant.
 *
 * IMPORTANT (re-probed 2026-07-11): this tenant does NOT share vivo's
 * Category IDs. The live dictionary (POST /api/Jobad/GetJobAdSearchConditions
 * with `{"displayFilters":["Category"]}` — payload shape extracted from the
 * portal SPA chunk 4934-8a8526c1…chk.js; the older `{PortalId,SpecialType}`
 * body now 400s "parameter exception") is:
 *
 *   1 = 社会招聘   (social hire — 695 jobs on 2026-07-11)
 *   3 = 飞YOUNG实习生 (intern program — 27 jobs)
 *   4 = 飞星计划   (campus special program — 8 jobs)
 *   5 = 飞凡计划   (campus special program — 3 jobs)
 *   6 = 校园大使   (campus ambassador — 1 job)
 *
 * `--scope social` → `Category: ["1"]`
 * `--scope campus` → `Category: ["4","5","6"]` (all campus-channel programs)
 * `--scope intern` → `Category: ["3"]`
 * `--scope all` / undefined → no Category filter (mixed feed across all
 * channels, matching iFlytek's historical 1.0.93 default).
 *
 * Because the dictionary already drifted once (2026-05-16 labels were
 * 员工社招/员工校招/实习生 on vivo-style IDs), `categoriesForScope` re-probes
 * the live dictionary per process and classifies categories by label,
 * falling back to the static snapshot above if the probe fails.
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const;

const SOURCE = "iflytek.zhiye.com";
const API_ROOT = "https://iflytek.zhiye.com";
const SITE_ROOT = "https://iflytek.zhiye.com/jobs";
// Beisen recruitment-portal SPA only registers `/campus/detail`, `/social/detail`,
// `/intern/detail` (extracted from the route table inside pc-app-*.chk.js).
// `/jobs?jobAdId=<id>` matches only the list-page route, not the detail route —
// same xiaohongshu-class symptom as 1.1.4.
function businessTypeForJob(
  categoryId?: string,
  category?: string,
): "campus" | "social" | "intern" {
  // iFlytek-tenant numeric codes (probed 2026-07-11): 1=社会招聘,
  // 3=飞YOUNG实习生, 4=飞星计划, 5=飞凡计划, 6=校园大使.
  if (categoryId === "1") return "social";
  if (categoryId === "3") return "intern";
  if (categoryId === "4" || categoryId === "5" || categoryId === "6") return "campus";
  const label = (category ?? "").toString();
  if (label.includes("实习")) return "intern";
  if (
    label.includes("校园") ||
    label.includes("校招") ||
    label.includes("飞星") ||
    label.includes("飞凡")
  )
    return "campus";
  if (label.includes("社招") || label.includes("社会")) return "social";
  return "social";
}
const DETAIL_PAGE = (
  id: string,
  businessType: "campus" | "social" | "intern" = "social",
) =>
  `https://iflytek.zhiye.com/${businessType}/detail?jobAdId=${encodeURIComponent(id)}`;

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
  /**
   * Canonical CLI-side scope flag (1.1.0+). Mapped via `categoriesForScope`
   * to this tenant's Beisen Category axis (live-probed, static fallback):
   * `social`=["1"], `campus`=["4","5","6"], `intern`=["3"],
   * `all`/undefined = no filter (mixed feed).
   */
  scope?: PositionScope;
  /**
   * @deprecated kept for backward compatibility with 1.0.93 callers — use
   * `scope` instead. Same string-value space as `scope`.
   */
  recruitType?: PositionScope;
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
  const businessType = businessTypeForJob(item.CategoryId, item.Category);
  return {
    post_id: id,
    title: (item.JobAdName ?? "").trim(),
    project: (item.Org ?? "").trim(),
    recruit_label: (item.Category ?? "").trim(),
    bgs: "",
    work_cities: cities,
    apply_url: id ? DETAIL_PAGE(id, businessType) : SITE_ROOT,
  };
}

// Beisen tenants encode recruit type via numeric Category IDs, but the ID
// dictionary is PER-TENANT and has drifted on this tenant before (2026-05-16
// it looked vivo-shaped; 2026-07-11 it is 1=社会招聘, 3=飞YOUNG实习生,
// 4=飞星计划, 5=飞凡计划, 6=校园大使). Static snapshot used as fallback when
// the live dictionary probe fails (offline / WAF / schema change).
const STATIC_SCOPE_CATEGORIES: Record<"social" | "campus" | "intern", string[]> = {
  social: ["1"],
  campus: ["4", "5", "6"],
  intern: ["3"],
};

// Classify a Category label into a CLI scope. On this tenant every
// non-social non-intern category is a campus-channel program (飞星计划,
// 飞凡计划, 校园大使 — confirmed live 2026-07-11), so campus is the default
// bucket for unrecognized labels.
function scopeForCategoryLabel(label: string): "social" | "campus" | "intern" {
  if (/社会|社招/.test(label)) return "social";
  if (/实习/.test(label)) return "intern";
  return "campus";
}

let _scopeCategoriesCache: Record<"social" | "campus" | "intern", string[]> | null =
  null;

async function categoriesForScope(s?: PositionScope): Promise<string[] | undefined> {
  if (!s || s === "all") return undefined;
  if (_scopeCategoriesCache === null) {
    const dict = await fetchDictionaries();
    if (dict.ok) {
      const axis = dict.conditions.find((c) => c.field === "Category");
      if (axis && axis.options.length) {
        const probed: Record<"social" | "campus" | "intern", string[]> = {
          social: [],
          campus: [],
          intern: [],
        };
        for (const o of axis.options) {
          if (o.id) probed[scopeForCategoryLabel(o.name)].push(o.id);
        }
        _scopeCategoriesCache = probed;
      }
    }
    if (_scopeCategoriesCache === null) _scopeCategoriesCache = STATIC_SCOPE_CATEGORIES;
  }
  const ids = _scopeCategoriesCache[s];
  // Never send an empty Category filter — fall back to the static snapshot
  // if the live dictionary somehow had no entries for this scope.
  return ids && ids.length ? ids : STATIC_SCOPE_CATEGORIES[s];
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
  const category = await categoriesForScope(opts.scope ?? opts.recruitType);
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
  opts: {
    keyword?: string;
    maxPages?: number;
    pageSize?: number;
    scope?: PositionScope;
    /** @deprecated use `scope` */
    recruitType?: PositionScope;
  } = {}
) {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 30));
  const maxPages = Math.max(1, opts.maxPages ?? 30);

  const bucket: PositionSummary[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let exhausted = false;

  for (let page = 1; page <= maxPages; page++) {
    const r = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
      scope: opts.scope ?? opts.recruitType,
    });
    if (!r.ok) {
      return { ok: false as const, source: SOURCE, message: r.message, total: 0, fetched: bucket.length, positions: bucket };
    }
    if (total === undefined) total = r.total;
    // Dedupe by post_id and stop when a page yields nothing new — guards
    // against Beisen serving overlapping/repeating pages.
    let added = 0;
    for (const p of r.positions) {
      const key = p.post_id || `${p.title}|${p.work_cities}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.push(p);
      added++;
    }
    if (!r.positions.length || added === 0) {
      exhausted = true;
      break;
    }
    if (total !== undefined && bucket.length >= total) {
      exhausted = true;
      break;
    }
    // Short page = upstream ran out of rows even if its Count over-reports.
    if (r.positions.length < pageSize) {
      exhausted = true;
      break;
    }
  }
  if (total !== undefined && bucket.length >= total) exhausted = true;
  return {
    ok: true as const,
    source: SOURCE,
    total: total ?? bucket.length,
    fetched: bucket.length,
    truncated: !exhausted,
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
      // Upstream does not populate PostDate/HeadCount on this feed — it
      // returns the .NET zero-date sentinel "0001-01-01T00:00:00" and 0
      // (confirmed live 2026-07-11). Null them out instead of forwarding
      // the sentinels verbatim.
      const rawDate = (found.PostDate ?? "").trim();
      const postDate = rawDate && !rawDate.startsWith("0001-01-01") ? rawDate : null;
      const headCount =
        typeof found.HeadCount === "number" && found.HeadCount > 0
          ? found.HeadCount
          : null;
      return {
        ok: true as const,
        source: SOURCE,
        post_id: id,
        title: found.JobAdName ?? "",
        project: summary.project,
        recruit_label: summary.recruit_label,
        description: found.Duty ?? "",
        requirements: found.Require ?? "",
        head_count: headCount,
        post_date: postDate,
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
// Payload re-probed 2026-07-11: GetJobAdSearchConditions wants
// `{"displayFilters":["Category","LocId",...]}` (camelCase; shape lifted from
// the portal SPA chunk 4934-8a8526c1…chk.js which calls it as
// `{PageId, displayFilters:[...]}`). The pre-1.1.15 `{PortalId,SpecialType}`
// body now returns Code 400 "parameter exception". Response items are
// `{Name, Value, Data:[{Text, Value, StrValue}]}` — only the Category and
// LocId axes carry options on this tenant (Kind/Org/etc come back empty).

interface RawSearchCondition {
  Name?: string | null;
  Value?: string;
  Data?: Array<{ Text?: string; Value?: number | string; StrValue?: string }> | null;
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
    { displayFilters: ["Category", "LocId"] }
  );
  if (!r.ok || !r.data) {
    const result = { ok: false as const, source: SOURCE, message: r.message };
    _filterCache = result;
    return result;
  }
  const conditions = r.data.map((c) => ({
    field: c.Value ?? "",
    name: c.Name ?? "",
    options: (c.Data ?? []).map((o) => ({
      id: o.StrValue ?? (o.Value !== undefined && o.Value !== null ? String(o.Value) : ""),
      name: o.Text ?? "",
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
  const queries = pickDistinctiveTerms(terms, 3);
  if (!queries.length) queries.push(terms[0] ?? "");
  const lists = await Promise.all(queries.map((q) => searchPositions({ keyword: q, page: 1, pageSize: 50 })));
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
    const broad = await searchPositions({ page: 1, pageSize: 50 });
    if (broad.ok) pool.push(...broad.positions);
  }
  if (!pool.length) {
    return { ok: false as const, source: SOURCE, message: lastErr ?? "no positions returned", positions: [] };
  }
  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];
  for (const p of pool) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
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
