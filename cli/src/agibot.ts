// Thin client for 智元机器人 (Agibot / AGIBOT Innovation) campus & social recruiting.
//
// ============================================================
// API DISCOVERY (probed 2026-05)
//
// Infrastructure:
//   The corporate site www.agibot.com links to the Lark Hire (飞书招聘) SaaS portal:
//     https://agirobot.jobs.feishu.cn/
//   which hosts four separate recruiting portals:
//     /index               — 高端岗位 (senior / executive)   website_id: 7314554416651995443
//     /socialrecruitment   — 社会招聘 (social / experienced)  website_id: 7212468858346785082
//     /campusrecruitment   — 校园招聘 (campus / new-grad)     website_id: 7212468542670309689
//     /internrecruitment   — 实习招聘 (intern)
//
// Dead ends probed:
//   https://www.zhiyuan-robot.com/careers  — returns 404 (redirects to agibot.com.cn)
//   https://careers.agibot.com/            — connection refused / no server
//   https://hr.agibot.com/                 — connection refused / no server
//   Moka orgId 145143                      — auth-gated, not publicly accessible
//
// WORKING APPROACH — Lark Hire SaaS JSON API:
//   All four portals share a single unauthenticated POST endpoint:
//     POST https://agirobot.jobs.feishu.cn/api/v1/search/job/posts
//
//   Discovered by reverse-engineering the webpack bundle
//   lf-package-cn.feishucdn.com/…/saas-career/static/js/4026.f23f1edc.js:
//     getPositionList  = i + "/search/job/posts"    (POST)
//     getPositionDetail = i + "/job/posts/" + id    (GET)
//     getPositionFilter = i + "/config/job/filters/" + path (GET)
//
// API call details (POST /api/v1/search/job/posts) — RE-PROBED 2026-07-11:
//   * Pagination params are `limit` + `offset` ONLY. `page_index`/`page_size`
//     are silently ignored: {page_size:3, page_index:2} returns the default
//     10 rows from offset 0, while {limit:3, offset:3} returns rows 4-6.
//     Verified: offset=0 → 战略规划专家 7660842791669532937;
//     offset=5 → 融资总监 7660336662136801586 (different rows, count=873).
//   * Portal selection IS honored via the `portal-channel` + `website-path`
//     request headers (the 2026-05 note "Referer does not affect results"
//     only held because no portal-channel header was being sent).
//     Measured 2026-07-11 with {limit:2, offset:0}:
//       (no channel header)              count=873  — union of all portals
//       portal-channel: socialrecruitment count=763  全职/社招
//       portal-channel: campusrecruitment count=137  正式/校招
//       portal-channel: internrecruitment count=259  实习/校招
//       portal-channel: index             count=68   高端 (labelled 社招)
//   * `keyword` is a real server-side filter and combines with channel +
//     offset (campus + "工程师" → count=93, offset pages through it).
//   * `recruitment_id_list:["201"]` returns count=0 on this tenant — the
//     canonical feishu recruitment-ID filter does NOT work here; channel
//     headers are the only working scope mechanism.
//   Response: { code:0, data:{ job_post_list:[...], count:<int> } }
//
// Note: department_id is always null in public search results — no BG/部门 field available.
//
// ============================================================
// PositionSummary field mapping (canonical keys — matches all other adapters):
//   post_id       — item.id (string)
//   title         — item.title
//   project       — item.job_category.name (e.g. "研发" / "智能制造 / 工业互联网")
//   recruit_label — item.recruit_type.name + " / " + item.recruit_type.parent.name
//                   (e.g. "全职 / 社招" / "实习 / 校招")
//   bgs           — "" (department_id is always null in public API)
//   work_cities   — city_list[].name joined with " / " (e.g. "上海" / "北京 / 上海")
//   apply_url     — https://agirobot.jobs.feishu.cn/{portal}/position/{id}/detail
//                   (portal = the searched channel, or inferred from recruit_type
//                   on the unified feed: 正式/校招 → campusrecruitment,
//                   实习/校招 → internrecruitment, else socialrecruitment)
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

/** Recruit scopes Agibot can serve — all four canonical scopes.
 *  Verified 2026-07-11: the shared /api/v1/search/job/posts endpoint filters
 *  by portal when the `portal-channel` + `website-path` headers are set
 *  (social → /socialrecruitment 763, campus → /campusrecruitment 137,
 *  intern → /internrecruitment 259; no header → 873 union = "all"). */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

const SOURCE = "agirobot.jobs.feishu.cn";
const API_ROOT = "https://agirobot.jobs.feishu.cn/api/v1";
const PORTAL_BASE = "https://agirobot.jobs.feishu.cn";
const LIST_PAGE = `${PORTAL_BASE}/socialrecruitment`;
const DETAIL_URL = (id: string, portal: string = "socialrecruitment") =>
  `${PORTAL_BASE}/${portal}/position/${encodeURIComponent(id)}/detail`;

/** Map a CLI --scope to the Feishu portal channel path segment.
 *  undefined ⇒ no channel header ⇒ upstream returns the union of all
 *  portals (the "all" feed, count=873 on 2026-07-11). */
function channelForScope(scope?: PositionScope): string | undefined {
  if (scope === "social") return "socialrecruitment";
  if (scope === "campus") return "campusrecruitment";
  if (scope === "intern") return "internrecruitment";
  return undefined; // "all" / not given → unified feed
}

function makeHeaders(channel?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: PORTAL_BASE,
    Referer: channel ? `${PORTAL_BASE}/${channel}` : LIST_PAGE,
  };
  if (channel) {
    // These two headers are what actually scopes the result set to one
    // portal (verified 2026-07-11; Referer alone has no effect).
    headers["portal-channel"] = channel;
    headers["website-path"] = channel;
  }
  return headers;
}

const DEFAULT_HEADERS: Record<string, string> = makeHeaders();

// ---------- API envelope ----------

interface AgibotEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T>(
  path: string,
  body: unknown,
  channel?: string
): Promise<{ ok: boolean; data?: T; message: string }> {
  const url = `${API_ROOT}${path}`;
  let response: Response | undefined;
  let lastMessage = "";

  // Feishu's WAF answers bursts with 405/429/5xx — back off and retry
  // instead of hammering (attempt delays: 0ms, 600ms, 1800ms).
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * Math.pow(3, attempt - 1));
    try {
      response = await fetch(url, {
        method: "POST",
        headers: makeHeaders(channel),
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastMessage = `network error: ${err instanceof Error ? err.message : String(err)}`;
      response = undefined;
      continue;
    }
    if (response.ok) break;
    lastMessage = `HTTP ${response.status}: ${response.statusText}`;
    const s = response.status;
    if (s !== 405 && s !== 429 && s < 500) break; // non-retryable
  }
  if (!response) return { ok: false, message: lastMessage };
  if (!response.ok) {
    return { ok: false, message: lastMessage };
  }

  let payload: AgibotEnvelope<T>;
  try {
    payload = (await response.json()) as AgibotEnvelope<T>;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  return {
    ok: payload.code === 0,
    data: payload.data,
    message: payload.message || (payload.code === 0 ? "ok" : "upstream error"),
  };
}

// ---------- raw response types ----------

interface RawCityInfo {
  code?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
}

interface RawRecruitType {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  depth?: number;
  parent?: RawRecruitType | null;
}

interface RawJobCategory {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  depth?: number;
}

interface RawJobPost {
  id?: string | number;
  title?: string;
  sub_title?: string | null;
  description?: string;
  requirement?: string;
  job_category?: RawJobCategory | null;
  city_info?: RawCityInfo | null;
  city_list?: RawCityInfo[] | null;
  recruit_type?: RawRecruitType | null;
  publish_time?: number;
  job_hot_flag?: unknown;
  job_subject?: unknown;
  code?: string | null;
  department_id?: string | null;
  job_function?: unknown | null;
  job_process_id?: string | null;
  process_type?: number | null;
}

interface RawSearchData {
  job_post_list?: RawJobPost[];
  count?: number;
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

/** Pick the portal whose SPA detail page should host this item's apply_url.
 *  When the row came from an explicit channel search, that channel wins;
 *  otherwise infer from recruit_type. Parent label first: the default feed
 *  carries a few 实习/社招 posts that live on the social portal, so only
 *  校招-parented rows route to campus/intern (实习/校招 → intern portal,
 *  正式/校招 → campus portal — both verified served by those channels). */
function portalForItem(item: RawJobPost, channel?: string): string {
  if (channel) return channel;
  const rt = item.recruit_type;
  const name = rt?.name ?? "";
  const parent = rt?.parent?.name ?? "";
  if (parent.includes("校招") || (!parent && name.includes("校招"))) {
    return name.includes("实习") ? "internrecruitment" : "campusrecruitment";
  }
  return "socialrecruitment";
}

function summarizePosition(item: RawJobPost, channel?: string): PositionSummary {
  const id = String(item.id ?? "");

  // work_cities: prefer city_list for multi-city; fall back to city_info
  const cityList = item.city_list ?? [];
  let work_cities: string;
  if (cityList.length >= 1) {
    work_cities = cityList.map((c) => c.name ?? "").filter(Boolean).join(" / ");
  } else {
    work_cities = item.city_info?.name ?? "";
  }

  // recruit_label: "全职 / 社招" or "实习 / 校招" style
  const rt = item.recruit_type;
  const rtName = rt?.name ?? "";
  const rtParent = rt?.parent?.name ?? "";
  const recruit_label = rtParent ? `${rtName} / ${rtParent}` : rtName;

  return {
    post_id: id,
    title: item.title ?? "",
    project: item.job_category?.name ?? "",
    recruit_label,
    bgs: "", // department_id is always null in public search results
    work_cities,
    apply_url: id ? DETAIL_URL(id, portalForItem(item, channel)) : LIST_PAGE,
  };
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Canonical CLI scope. Translated to a portal channel via the
   *  `portal-channel`/`website-path` headers (social/campus/intern);
   *  "all"/omitted hits the unified no-channel feed. */
  scope?: PositionScope;
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const keyword = (opts.keyword ?? "").trim().slice(0, 60);
  const channel = channelForScope(opts.scope);

  // Real pagination params are limit + offset — page_index/page_size are
  // silently ignored by this tenant (verified 2026-07-11; see header).
  const payload: Record<string, unknown> = {
    keyword,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    portal_type: 3,
    portal_entrance: 1,
    language: "zh",
  };

  const response = await call<RawSearchData>("/search/job/posts", payload, channel);
  if (!response.ok || !response.data) {
    return {
      ok: false as const,
      message: response.message,
      source: SOURCE,
      query: payload,
      positions: [] as PositionSummary[],
    };
  }

  const rows = response.data.job_post_list ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    query: payload,
    scope: opts.scope,
    page,
    page_size: pageSize,
    total: response.data.count ?? rows.length,
    positions: rows.map((r) => summarizePosition(r, channel)),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 15); // per channel; 15×100 ≥ any 2026-07 channel

  // Which channels to sweep. Verified 2026-07-11: the default (no-channel)
  // catalog does NOT contain campus/intern portal posts — e.g. keyword
  // "优才-空间智能算法研究员" hits 0 rows on the default feed but 3 rows
  // (正式/校招) on campusrecruitment. So an exhaustive "all" must sweep the
  // default catalog (873, all 社招-parented) PLUS campus (137) and intern
  // (259) channels, de-duplicating by post_id.
  const sweeps: (PositionScope | undefined)[] =
    opts.scope === undefined || opts.scope === "all"
      ? [undefined, "campus", "intern"]
      : [opts.scope];

  const bucket: PositionSummary[] = [];
  const seen = new Set<string>();
  const channels: { scope: string; total: number; fetched: number }[] = [];
  let truncated = false;

  for (const scope of sweeps) {
    const channelSeen = new Set<string>(); // ids this channel has served
    let channelTotal: number | undefined;
    let channelNew = 0; // rows this channel contributed to the bucket
    let exhausted = false;

    for (let page = 1; page <= maxPages; page++) {
      const result = await searchPositions({ ...opts, scope, page, pageSize });
      if (!result.ok) {
        return {
          ok: false as const,
          message: result.message,
          source: SOURCE,
          fetched: bucket.length,
          positions: bucket,
        };
      }
      if (channelTotal === undefined) channelTotal = result.total;

      // freshHere: rows this channel hasn't served before (loop guard).
      // The bucket additionally de-duplicates across channels.
      let freshHere = 0;
      for (const p of result.positions) {
        if (!p.post_id) {
          bucket.push(p);
          continue;
        }
        if (!channelSeen.has(p.post_id)) {
          channelSeen.add(p.post_id);
          freshHere++;
        }
        if (seen.has(p.post_id)) continue;
        seen.add(p.post_id);
        bucket.push(p);
        channelNew++;
      }

      if (result.positions.length < pageSize) {
        exhausted = true; // short page — this channel has no more rows
        break;
      }
      if (channelSeen.size >= (channelTotal ?? Infinity)) {
        exhausted = true; // served everything upstream claims to have
        break;
      }
      if (freshHere === 0) {
        exhausted = true; // full page of re-served rows — upstream looping
        break;
      }
    }

    if (!exhausted) truncated = true;
    channels.push({
      scope: scope ?? "default",
      total: channelTotal ?? 0,
      fetched: channelNew,
    });
  }

  // total: when every swept channel was exhausted, the deduped bucket IS the
  // real universe for this query, so report that. If we had to stop early,
  // report the sum of upstream per-channel counts (upper bound — see
  // `channels` for the per-portal breakdown) alongside truncated: true.
  const upstreamSum = channels.reduce((n, c) => n + c.total, 0);
  return {
    ok: true as const,
    source: SOURCE,
    total: truncated ? upstreamSum : bucket.length,
    fetched: bucket.length,
    ...(truncated ? { truncated: true as const } : {}),
    channels,
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

interface RawDetailData {
  job_post_detail?: {
    id?: string | number;
    title?: string;
    sub_title?: string | null;
    description?: string;
    requirement?: string;
    job_category?: RawJobCategory | null;
    city_list?: RawCityInfo[] | null;
    recruit_type?: RawRecruitType | null;
  };
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) {
    return { ok: false as const, source: SOURCE, message: "post_id is required" };
  }

  const url = `${API_ROOT}/job/posts/${encodeURIComponent(id)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { ...DEFAULT_HEADERS, Referer: DETAIL_URL(id) },
    });
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let payload: AgibotEnvelope<RawDetailData>;
  try {
    payload = (await response.json()) as AgibotEnvelope<RawDetailData>;
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `bad JSON: ${err instanceof Error ? err.message : err}`,
    };
  }

  if (payload.code !== 0 || !payload.data?.job_post_detail) {
    // Upstream answers unknown ids with code:0 + empty data + message "ok",
    // so surface a real not-found instead of echoing that misleading "ok".
    const upstreamMsg =
      payload.message && payload.message !== "ok" ? payload.message : undefined;
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message:
        payload.code === 0
          ? `position not found: ${id}`
          : upstreamMsg ?? "upstream error",
    };
  }

  const d = payload.data.job_post_detail;
  const cities = (d.city_list ?? []).map((c) => c.name ?? "").filter(Boolean);
  const rtName = d.recruit_type?.name ?? "";
  const rtParent = d.recruit_type?.parent?.name ?? "";

  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(d.id ?? id),
    title: d.title ?? "",
    direction: d.sub_title ?? "",
    project: d.job_category?.name ?? "",
    recruit_label: rtParent ? `${rtName} / ${rtParent}` : rtName,
    description: d.description ?? "",
    requirements: d.requirement ?? "",
    work_cities: cities,
    apply_url: DETAIL_URL(
      String(d.id ?? id),
      portalForItem({ recruit_type: d.recruit_type })
    ),
  };
}

// ---------- fetchDictionaries ----------
// Returns the job-type and city taxonomy from GET /api/v1/config/job/filters/index

interface RawFilterJobType {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  depth?: number;
  parent?: RawFilterJobType | null;
  children?: RawFilterJobType[] | null;
}

interface RawFilterCity {
  code?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
}

interface RawFilterData {
  job_type_list?: RawFilterJobType[];
  city_list?: RawFilterCity[];
  recruitment_type_list?: RawRecruitType[] | null;
  job_subject_list?: unknown[] | null;
}

export async function fetchDictionaries() {
  const url = `${API_ROOT}/config/job/filters/index`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers: DEFAULT_HEADERS });
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `HTTP ${response.status}`,
    };
  }

  let payload: AgibotEnvelope<RawFilterData>;
  try {
    payload = (await response.json()) as AgibotEnvelope<RawFilterData>;
  } catch (err) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `bad JSON: ${err instanceof Error ? err.message : err}`,
    };
  }

  if (payload.code !== 0 || !payload.data) {
    return {
      ok: false as const,
      source: SOURCE,
      message: payload.message ?? "upstream error",
    };
  }

  const d = payload.data;
  const jobCategories = (d.job_type_list ?? []).map((c) => ({
    id: c.id ?? "",
    name: c.name ?? "",
    en_name: c.en_name ?? "",
    depth: c.depth ?? 1,
    parent_id: c.parent?.id ?? null,
  }));
  const cities = (d.city_list ?? []).map((c) => ({
    code: c.code ?? "",
    name: c.name ?? "",
    en_name: c.en_name ?? "",
  }));

  return {
    ok: true as const,
    source: SOURCE,
    portal: PORTAL_BASE,
    portals: {
      index: `${PORTAL_BASE}/index`,
      social: `${PORTAL_BASE}/socialrecruitment`,
      campus: `${PORTAL_BASE}/campusrecruitment`,
      intern: `${PORTAL_BASE}/internrecruitment`,
    },
    note:
      "All four Agibot recruiting portals share a single public API endpoint at " +
      "/api/v1/search/job/posts; the portal-channel/website-path headers select a " +
      "portal (--scope social/campus/intern), no header returns the union (--scope all). " +
      "department_id is always null in public results (no BG/部门 exposed). " +
      "2026-07 snapshot: 873 total (social 763 / campus 137 / intern 259 / 高端 68, overlapping).",
    jobCategories,
    cities,
  };
}

// ---------- notices (no public endpoint) ----------

const NOTICES_STUB = {
  ok: false as const,
  source: SOURCE,
  message: "Agibot: no public notices or announcement endpoint available",
};

export async function listNotices(): Promise<typeof NOTICES_STUB> {
  return NOTICES_STUB;
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return NOTICES_STUB;
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return NOTICES_STUB;
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
  const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
  if (!list.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: list.message,
      positions: [] as PositionSummary[],
    };
  }

  type Scored = { score: number; position: PositionSummary; reasons: string[] };
  const scored: Scored[] = [];

  for (const p of list.positions) {
    const blob = [p.title, p.project, p.recruit_label, p.work_cities, p.post_id].join(" ");
    const { score, reasons } = scoreOverlap(blob, terms, cities);
    if (score > 0) scored.push({ score, position: p, reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  let shortlist = scored.slice(0, Math.max(topN, candidates));
  if (!shortlist.length) {
    shortlist = list.positions.slice(0, candidates).map((position) => ({
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
