// 蚂蚁集团 (Ant Group) careers adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16 via puppeteer-core network capture)
//
// `talent.antgroup.com` is an Ant Bigfish SPA. Its public-facing job feed
// is served by `hrcareersweb.antgroup.com` with two anonymous endpoints:
//
//   POST /api/campus/position/search   — 467 校招 / 实习 positions
//   POST /api/social/position/search   — 922 社招 positions
//
// Both accept JSON `{ key, pageIndex, pageSize, channel?, language, … }`
// and return:
//   { success:true, errorMsg:"成功", content:[…RawPosition], totalCount,
//     pageSize, currentPage }
//
// The `channel` field is required only on the social endpoint
// (`"group_official_site"`). The `ctoken=…` query parameter that the
// browser SPA appends is NOT required for unauthenticated reads.
//
// queryCollections / favoritePosition / login-required endpoints return
// `errorCode:"LOGIN_EXPIRED"` for anonymous callers — those are user
// dashboard surfaces, not the public search.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/**
 * Ant Group supports social + campus + intern + all (1.1.0+). The campus
 * endpoint lumps intern + new-grad together, so `intern` maps to `campus`.
 *
 * Scope translation to internal `recruitType`:
 *   social  → "social"   (~922 posts via /api/social/position/search)
 *   campus  → "campus"   (~467 posts via /api/campus/position/search, incl. intern)
 *   intern  → "campus"
 *   all     → "all"      (fan out both endpoints, merged)
 *   undefined → "all"    (historical default — preserves 1.0.93 merged feed)
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

function recruitTypeFromScope(s: PositionScope | undefined): "campus" | "social" | "all" {
  if (s === "social") return "social";
  if (s === "campus" || s === "intern") return "campus";
  if (s === "all") return "all";
  return "all";
}

const SOURCE = "hrcareersweb.antgroup.com";
const API_ROOT = "https://hrcareersweb.antgroup.com/api";
const CAMPUS_PAGE = "https://talent.antgroup.com/campus-list";
const SOCIAL_PAGE = "https://talent.antgroup.com/off-campus-position";
const DETAIL_URL = (recruitType: "campus" | "social", id: string) =>
  recruitType === "campus"
    ? `https://talent.antgroup.com/campus-list?positionId=${encodeURIComponent(id)}`
    : `https://talent.antgroup.com/off-campus-position-detail?positionId=${encodeURIComponent(id)}`;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Content-Type": "application/json;charset=UTF-8",
  Origin: "https://talent.antgroup.com",
};

interface AntEnvelope<T> {
  success?: boolean;
  errorMsg?: string;
  errorCode?: string;
  content?: T;
  totalCount?: number;
  currentPage?: number;
  pageSize?: number;
  traceId?: string;
}

interface RawPosition {
  bucket?: string;
  positionUrl?: string;
  id?: number | string;
  code?: string;
  name?: string;
  categories?: string[];
  categoryName?: string;
  publishTime?: string;
  graduationTime?: string;
  workLocations?: string[];
  workLocationsCodes?: string[];
  interviewLocations?: string[];
  tags?: unknown;
  requirement?: string;
  description?: string;
  experience?: string;
  degree?: string;
  teamDescription?: string;
  department?: string;
  project?: string;
  positionType?: string;
}

async function post<T>(path: string, body: unknown, referer: string): Promise<{
  ok: boolean;
  content?: T;
  totalCount?: number;
  message: string;
}> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers: { ...DEFAULT_HEADERS, Referer: referer },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, message: `network error: ${err instanceof Error ? err.message : err}` };
  }
  if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
  let env: AntEnvelope<T>;
  try {
    env = (await response.json()) as AntEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }
  if (env.success !== true) {
    return { ok: false, message: env.errorMsg ?? `errorCode=${env.errorCode ?? "?"}` };
  }
  return { ok: true, content: env.content, totalCount: env.totalCount ?? 0, message: "ok" };
}

// ---------- canonical types ----------

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
  /** "campus" → 校招/实习 endpoint; "social" → 社招 endpoint; omit = merge both. */
  recruitType?: "campus" | "social" | "all";
  /** CLI `--scope` echo (1.1.0+). When set and `recruitType` is omitted, scope
   *  picks the upstream endpoint. `recruitType` takes precedence. */
  scope?: PositionScope;
  /** Filter by BG code (社招 only); e.g. "19887" 支付宝事业群. */
  bgCode?: string;
}

function summarize(item: RawPosition, recruitType: "campus" | "social"): PositionSummary {
  const id = String(item.id ?? item.code ?? "");
  const locs = Array.isArray(item.workLocations) ? item.workLocations.filter(Boolean).join(" / ") : "";
  return {
    post_id: id,
    title: (item.name ?? "").trim(),
    project:
      item.project?.trim() ||
      item.categoryName?.trim() ||
      (Array.isArray(item.categories) ? item.categories.filter(Boolean).join(" / ") : ""),
    recruit_label: (item.positionType ?? "").trim() || (recruitType === "campus" ? "校招" : "社招"),
    bgs: (item.department ?? "").trim(),
    work_cities: locs,
    apply_url: id ? DETAIL_URL(recruitType, id) : recruitType === "campus" ? CAMPUS_PAGE : SOCIAL_PAGE,
  };
}

async function searchSingle(
  recruitType: "campus" | "social",
  opts: SearchOptions
): Promise<{
  ok: boolean;
  total: number;
  positions: PositionSummary[];
  message: string;
}> {
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);

  const body: Record<string, unknown> = {
    key: keyword,
    pageIndex: page,
    pageSize,
    language: "zh",
  };
  if (recruitType === "social") {
    body.channel = "group_official_site";
    body.regions = "";
    body.categories = "";
    body.subCategories = "";
    body.bgCode = opts.bgCode ?? "";
    body.socialQrCode = "";
  }
  const referer = recruitType === "campus" ? CAMPUS_PAGE : SOCIAL_PAGE;
  const r = await post<RawPosition[]>(`/${recruitType}/position/search`, body, referer);
  if (!r.ok) {
    return { ok: false, total: 0, positions: [], message: r.message };
  }
  return {
    ok: true,
    total: r.totalCount ?? 0,
    positions: (r.content ?? []).map((p) => summarize(p, recruitType)),
    message: "ok",
  };
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const recruitType = opts.recruitType ?? recruitTypeFromScope(opts.scope);
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);

  if (recruitType === "campus" || recruitType === "social") {
    const r = await searchSingle(recruitType, opts);
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        message: r.message,
        query: { recruitType, page, pageSize, keyword: opts.keyword ?? "" },
        positions: [] as PositionSummary[],
      };
    }
    return {
      ok: true as const,
      source: SOURCE,
      query: { recruitType, page, pageSize, keyword: opts.keyword ?? "" },
      page,
      page_size: pageSize,
      total: r.total,
      positions: r.positions,
    };
  }
  // "all" → ask both endpoints for the same page
  const [campus, social] = await Promise.all([
    searchSingle("campus", opts),
    searchSingle("social", opts),
  ]);
  const positions = [...campus.positions, ...social.positions];
  const total = (campus.ok ? campus.total : 0) + (social.ok ? social.total : 0);
  if (!campus.ok && !social.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: campus.message,
      query: { recruitType: "all", page, pageSize, keyword: opts.keyword ?? "" },
      positions: [] as PositionSummary[],
    };
  }
  return {
    ok: true as const,
    source: SOURCE,
    query: { recruitType: "all", page, pageSize, keyword: opts.keyword ?? "" },
    page,
    page_size: pageSize,
    total,
    positions,
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const recruitType = opts.recruitType ?? recruitTypeFromScope(opts.scope);
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 30));
  const maxPages = Math.max(1, opts.maxPages ?? 40);

  async function drain(rt: "campus" | "social"): Promise<{ ok: boolean; total: number; positions: PositionSummary[]; message: string }> {
    const bucket: PositionSummary[] = [];
    let total = 0;
    let lastMsg = "ok";
    for (let page = 1; page <= maxPages; page++) {
      const r = await searchSingle(rt, { ...opts, page, pageSize });
      if (!r.ok) {
        lastMsg = r.message;
        if (bucket.length === 0) return { ok: false, total: 0, positions: [], message: r.message };
        break;
      }
      if (total === 0) total = r.total;
      if (!r.positions.length) break;
      bucket.push(...r.positions);
      if (bucket.length >= total) break;
    }
    return { ok: true, total, positions: bucket, message: lastMsg };
  }

  if (recruitType === "campus" || recruitType === "social") {
    const r = await drain(recruitType);
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        message: r.message,
        total: 0,
        fetched: 0,
        positions: [] as PositionSummary[],
      };
    }
    return {
      ok: true as const,
      source: SOURCE,
      total: r.total,
      fetched: r.positions.length,
      positions: r.positions,
    };
  }
  const [c, s] = await Promise.all([drain("campus"), drain("social")]);
  return {
    ok: true as const,
    source: SOURCE,
    total: (c.ok ? c.total : 0) + (s.ok ? s.total : 0),
    fetched: c.positions.length + s.positions.length,
    positions: [...c.positions, ...s.positions],
  };
}

// ---------- fetchPositionDetail ----------
// The list endpoint already returns description/requirement/teamDescription
// inline — no separate detail endpoint needed. Scan campus then social.

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };

  for (const rt of ["campus", "social"] as const) {
    // pageSize >= 50 triggers a silent upstream rejection (returns
    // {totalCount: 0, content: []}). 20 is the SPA's own default and the
    // largest size that reliably returns data. Compensate by widening
    // maxPages from 20 → 50 to preserve ~the same scan depth.
    const pageSize = 20;
    const maxPages = 50;
    for (let page = 1; page <= maxPages; page++) {
      const body: Record<string, unknown> = {
        key: "",
        pageIndex: page,
        pageSize,
        language: "zh",
      };
      if (rt === "social") {
        body.channel = "group_official_site";
        body.regions = "";
        body.categories = "";
        body.subCategories = "";
        body.bgCode = "";
        body.socialQrCode = "";
      }
      const referer = rt === "campus" ? CAMPUS_PAGE : SOCIAL_PAGE;
      const r = await post<RawPosition[]>(`/${rt}/position/search`, body, referer);
      if (!r.ok) break;
      const found = (r.content ?? []).find((p) => String(p.id ?? p.code) === id);
      if (found) {
        return {
          ok: true as const,
          source: SOURCE,
          post_id: id,
          title: found.name ?? "",
          project: found.project ?? found.categoryName ?? "",
          recruit_label: found.positionType ?? (rt === "campus" ? "校招" : "社招"),
          department: found.department ?? "",
          work_cities: found.workLocations ?? [],
          publish_time: found.publishTime ?? "",
          graduation_time: found.graduationTime ?? "",
          experience: found.experience ?? "",
          degree: found.degree ?? "",
          description: found.description ?? "",
          requirements: found.requirement ?? "",
          team_description: found.teamDescription ?? "",
          apply_url: DETAIL_URL(rt, id),
        };
      }
      if (r.totalCount && (r.content?.length ?? 0) < pageSize) break;
    }
  }
  return {
    ok: false as const,
    source: SOURCE,
    post_id: id,
    message: `post ${id} not found in campus or social feeds`,
  };
}

// ---------- fetchDictionaries ----------

let _dictCache:
  | { ok: true; source: string; bgs: Array<{ code: string; name: string }>; regions: Array<{ code: string; name: string }>; categories: unknown[] }
  | { ok: false; source: string; message: string }
  | null = null;

export async function fetchDictionaries() {
  if (_dictCache !== null) return _dictCache;
  const [depRes, regRes, catRes] = await Promise.all([
    post<Array<{ code?: string; name?: string }>>("/social/category/listDept", { channel: "group_official_site", language: "zh" }, SOCIAL_PAGE),
    post<Array<{ code?: string; name?: string }>>("/region/hot", { channel: "group_official_site", language: "zh" }, SOCIAL_PAGE),
    post<unknown[]>("/social/category/list", { channel: "group_official_site", language: "zh" }, SOCIAL_PAGE),
  ]);
  if (!depRes.ok && !regRes.ok && !catRes.ok) {
    const r = { ok: false as const, source: SOURCE, message: depRes.message };
    _dictCache = r;
    return r;
  }
  const result = {
    ok: true as const,
    source: SOURCE,
    bgs: (depRes.content ?? []).map((d) => ({ code: d.code ?? "", name: d.name ?? "" })),
    regions: (regRes.content ?? []).map((d) => ({ code: d.code ?? "", name: d.name ?? "" })),
    categories: catRes.content ?? [],
  };
  _dictCache = result;
  return result;
}

// ---------- notices ----------

const NOTICES_MSG = "Ant Group (蚂蚁集团): no public notices endpoint on hrcareersweb";

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: NOTICES_MSG, notices: [] as never[] };
}

export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: NOTICES_MSG, notice_id: noticeId };
}

export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return { ok: false as const, source: SOURCE, question, message: NOTICES_MSG, matches: [] as unknown[] };
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
  const keyword = terms.slice(0, 3).join(" ");
  const list = await searchPositions({ keyword, page: 1, pageSize: 50, recruitType: "all" });
  if (!list.ok) {
    return { ok: false as const, source: SOURCE, message: list.message, positions: [] };
  }
  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];
  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.bgs, p.work_cities].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = list.positions.slice(0, candidates).map((position) => ({ score: 0, position, reasons: [] }));
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


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_antgroup } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_antgroup } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_antgroup } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "hrcareersweb.antgroup.com", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://hrcareersweb.antgroup.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "hrcareersweb.antgroup.com", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_antgroup({
      source: "hrcareersweb.antgroup.com",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: "https://hrcareersweb.antgroup.com/api/social/application/apply",
      submitKind: "multipart-session",
      endpointVerified: true,
      submitNotes:
        "Ant Group — POST /api/social/application/apply (or /api/campus/application/apply for campus). Endpoint extracted from talent.antgroup.com's Yuyan/Alipay umi bundle 180020010001257966/umi.6f081e74.js (3.9MB). Anon-probed → HTTP 200 + {success:false, errorMsg:\"登录过期\", errorCode:\"LOGIN_EXPIRED\"} = real auth-gated route. The original /api/social/position/apply was wrong path (position → application). Alipay OAuth session required.",
    }),
  };
}
