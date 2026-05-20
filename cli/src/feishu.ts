// Generic Feishu Recruiting (ATSX) adapter factory.
//
// Feishu Recruiting (飞书招聘) is ByteDance's SaaS ATS platform. Multiple companies
// self-host it at dedicated subdomains:
//
//   *.jobs.feishu.cn   — standard Feishu subdomains (NIO, etc.)
//   *.jobs.f.mioffice.cn — Xiaomi fork (not this adapter)
//   {tenant}.jobs.feishu.cn/{companyId}/ — multi-tenant portals (MiniMax)
//
// API surface (identical across all hosts, verified 2026-05):
//   POST https://<host>/api/v1/search/job/posts
//   GET  https://<host>/api/v1/config/job/filters/<channel>
//
// Portal scoping is controlled by two required headers:
//   portal-channel:  the channel slug ("campus", "internship", or company-path like "379481")
//   website-path:    same value as portal-channel
//
// For NIO (nio.jobs.feishu.cn):
//   host    = "nio.jobs.feishu.cn"
//   channel = "campus"
//   apply_url prefix = "https://nio.jobs.feishu.cn/campus/position"
//
// For MiniMax (vrfi1sk8a0.jobs.feishu.cn / company path 379481):
//   host    = "vrfi1sk8a0.jobs.feishu.cn"
//   channel = "379481"            ← company PATH is the portal-channel!
//   apply_url prefix = "https://vrfi1sk8a0.jobs.feishu.cn/379481/position"
//
// ---- PositionSummary field mapping (Feishu → canonical) ----
//   post_id       ← String(item.id)
//   title         ← item.title
//   project       ← item.job_category.name  (or job_function.name if category null)
//   recruit_label ← item.recruit_type.name
//   bgs           ← ""  (not exposed in public search)
//   work_cities   ← city_list joined " / " (city_info used as fallback)
//   apply_url     ← `${applyUrlPrefix}/${id}/detail`
//
// ---- Discovery notes (2026-05) ----
//   - "site not exist" (-9000003) → wrong portal-channel header
//   - 400 empty body → tenant subdomain not configured on Feishu backend
//   - NIO: job_category is null; project comes from job_function.name
//   - MiniMax: job_function is null; project comes from job_category.name
//   - Both: city_info is null; city_list always populated

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { ApplyFormSchema, ApplyQuestion } from "./apply.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

// ---------- shared apply-schema helper (re-used by bespoke Feishu adapters) ----------
//
// xiaomi.ts / zhipu.ts / iqiyi.ts / agibot.ts / lilith.ts each predate the
// factory and have their own searchPositions implementations. To give them
// the same Phase-2 behaviour as factory-using adapters (nio / minimax /
// baichuan / zerooneai), each can call `buildFeishuApplySchema()` from
// its own fetchApplicationSchema function.

/**
 * Wire fetchApplicationSchema for a bespoke Feishu adapter that doesn't use
 * createAdapter. The callback `fetchTitle(id)` is the adapter's own
 * fetchPositionDetail (or any function that returns `{ ok, title }`).
 *
 * Usage:
 *   export const fetchApplicationSchema = makeFeishuApplyFn({
 *     host: HOST, source: SOURCE, channel: CHANNEL,
 *     applyUrlPrefix: APPLY_PREFIX,
 *     fetchTitle: (id) => fetchPositionDetail(id),
 *     submitKind: "feishu-3-step",  // override for lilith → "cdp-real-browser"
 *   });
 */
export function makeFeishuApplyFn(opts: {
  host: string;
  source: string;
  channel: string;
  applyUrlPrefix: string;
  fetchTitle: (postId: string) => Promise<unknown>;
  submitKind?: "feishu-3-step" | "cdp-real-browser";
}) {
  return async function fetchApplicationSchema(postId: string): Promise<
    { ok: true; schema: ApplyFormSchema } | { ok: false; source: string; message: string }
  > {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false, source: opts.source, message: "post_id is required" };
    let title = "";
    try {
      const detail = (await opts.fetchTitle(id)) as { ok?: boolean; title?: string; message?: string };
      if (detail?.ok === false) {
        return { ok: false, source: opts.source, message: detail.message ?? "post not found" };
      }
      title = detail?.title ?? "";
    } catch {
      // detail call failures aren't fatal for the schema — we can still
      // return what we know.
    }
    const schema = buildFeishuApplySchema({
      host: opts.host,
      source: opts.source,
      channel: opts.channel,
      applyUrlPrefix: opts.applyUrlPrefix,
      postId: id,
      jobTitle: title,
    });
    if (opts.submitKind === "cdp-real-browser") {
      schema.submit_kind = "cdp-real-browser";
      schema.submit_notes =
        "Lilith's Feishu tenant requires a runtime-minted `_signature` token. " +
        "Submission must drive a real browser (puppeteer-core) — staged dry-run " +
        "only for now.";
    }
    return { ok: true, schema };
  };
}

export function buildFeishuApplySchema(args: {
  host: string;
  source: string;
  channel: string;
  applyUrlPrefix: string;
  postId: string;
  jobTitle: string;
}): ApplyFormSchema {
  const standard: ApplyQuestion[] = [
    { label: "Name",   required: true, fields: [{ name: "name",   type: "input_text" }] },
    { label: "Email",  required: true, fields: [{ name: "email",  type: "input_text" }] },
    { label: "Phone",  required: true, fields: [{ name: "phone",  type: "input_text" }] },
    { label: "Resume", required: true, fields: [{ name: "resume", type: "input_file" }] },
  ];
  return {
    source: args.source,
    post_id: args.postId,
    job_title: args.jobTitle,
    apply_url: `${args.applyUrlPrefix}/${encodeURIComponent(args.postId)}/detail`,
    submit_endpoint: `https://${args.host}/api/v1/user/applications`,
    submit_method: "POST",
    submit_kind: "feishu-3-step",
    endpoint_verified: true,
    submit_notes:
      "Feishu apply is a 3-step token flow: POST /api/v1/attachment/upload/tokens → " +
      "PUT presigned URL on lf-package-cn.feishucdn.com → POST /api/v1/attachment/exchange/tokens → " +
      "POST /api/v1/user/applications with { post_id, attachment_id, applicant_info }. " +
      "Endpoint extracted from atsx-throne/hire-fe-prod/saas-career/4026.f23f1edc.js " +
      "(/user/applications path) and anon-probed → HTTP 405 = real REST route in Feishu's " +
      "routing table (method/csrf requirements differ from anon POST). Requires candidate " +
      "session cookies (capture via extension/, drop under ~/.jobpro/<adapter>.session.json).",
    questions: standard,
  };
}

// ---------- adapter config ----------

export interface FeishuAdapterConfig {
  /** e.g. "nio.jobs.feishu.cn" or "vrfi1sk8a0.jobs.feishu.cn" */
  host: string;
  /** portal-channel / website-path header value ("campus" | "379481" | etc.).
   *  Used when scope is undefined OR scope === "all" OR scope === "campus".
   *  Treated as the adapter's historical default channel. */
  channel: string;
  /** Optional dedicated channel for `scope=social`. If absent, the factory
   *  falls back to `channel` + `recruitment_id_list:["101"]` semantics. */
  socialChannel?: string;
  /** Optional dedicated channel for `scope=intern`. If absent, the factory
   *  falls back to `channel` + `recruitment_id_list:["202"]` semantics. */
  internChannel?: string;
  /** Human-readable label for error/source fields */
  label: string;
  /** URL prefix for detail pages: `${applyUrlPrefix}/${id}/detail` */
  applyUrlPrefix: string;
  /** Scopes this adapter can actually query. `undefined` = accepts all four. */
  supportedScopes?: ReadonlyArray<PositionScope>;
}

// ---------- raw response types ----------

interface RawCityInfo {
  code?: string;
  name?: string;
  en_name?: string;
}

interface RawJobCategory {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  depth?: number;
  parent?: RawJobCategory | null;
  children?: RawJobCategory[] | null;
}

interface RawJobFunction {
  id?: string;
  name?: string;
  en_name?: string;
  i18n_name?: string;
  parent_id?: string | null;
  parent?: RawJobFunction | null;
}

interface RawRecruitType {
  id?: string;
  name?: string;
  en_name?: string;
  depth?: number;
  parent?: { id?: string; name?: string } | null;
}

interface RawJobSubject {
  id?: string;
  name?: { zh_cn?: string; en_us?: string | null; i18n?: string };
  limit_count?: number | null;
  active_status?: number;
}

interface RawJobPost {
  id?: string | number;
  title?: string;
  sub_title?: string | null;
  description?: string;
  requirement?: string;
  job_category?: RawJobCategory | null;
  job_function?: RawJobFunction | null;
  city_info?: RawCityInfo | null;
  city_list?: RawCityInfo[];
  recruit_type?: RawRecruitType;
  publish_time?: number;
  code?: string;
  job_subject?: RawJobSubject;
  job_post_info?: unknown;
  tag_list?: unknown[];
}

interface RawSearchData {
  job_post_list?: RawJobPost[];
  count?: number;
}

interface RawFilterJobType {
  id?: string;
  name?: string;
  en_name?: string;
  depth?: number;
  parent?: RawFilterJobType | null;
  children?: RawFilterJobType[] | null;
}

interface RawFilterCity {
  code?: string;
  name?: string;
  en_name?: string;
}

interface RawFilterSubject {
  id?: string;
  name?: { zh_cn?: string; en_us?: string | null; i18n?: string };
  limit_count?: number | null;
  active_status?: number;
  subject_group_info?: { id?: string; name?: string; en_name?: string } | null;
}

interface RawFilterData {
  job_type_list?: RawFilterJobType[];
  job_function_list?: Array<{ id?: string; name?: string; en_name?: string }>;
  city_list?: RawFilterCity[];
  job_subject_list?: RawFilterSubject[];
  recruitment_type_list?: null;
}

interface FsEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
  error?: { message?: string } | null;
}

// ---------- PositionSummary (canonical shape) ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Filter by recruitment type IDs. Pass [] to get all types. */
  recruitmentIdList?: string[];
  /** Filter by job category IDs. */
  jobCategoryIdList?: string[];
  /** Filter by city location codes (e.g. "CT_11" = 北京). */
  cityIdList?: string[];
  /** Filter by subject/program IDs. */
  subjectIdList?: string[];
  /** Caller-requested recruit scope. Adapter translates to either an alternate
   *  `portal-channel` (if `socialChannel`/`internChannel` is configured) or to
   *  the canonical `recruitment_id_list` filter on the default channel. */
  scope?: PositionScope;
}

// ---------- createAdapter ----------

export function createAdapter(cfg: FeishuAdapterConfig) {
  const API_ROOT = `https://${cfg.host}/api/v1`;
  const source = cfg.host;
  const supportedScopes: ReadonlyArray<PositionScope> =
    cfg.supportedScopes ?? (["social", "campus", "intern", "all"] as const);

  /**
   * Translate a CLI `--scope` value into Feishu wire-level params.
   *
   * Two strategies, in priority order:
   *   1. If the tenant has a dedicated `socialChannel`/`internChannel`
   *      configured (typical of NIO's separate campus/society subdomains),
   *      swap the `portal-channel` header value.
   *   2. Otherwise stay on the default channel and constrain by
   *      `recruitment_id_list`. Feishu's canonical IDs are
   *      `101` = 社招 (social), `201` = 校招 (campus), `202` = 实习 (intern).
   *
   * `scope === undefined` (caller didn't pass --scope) and `scope === "all"`
   * both preserve historical behaviour — the adapter's original `channel`
   * with no extra recruitment filter (so 1.0.93 callers get bit-for-bit
   * identical queries).
   */
  function channelForScope(
    s: PositionScope | undefined
  ): { channel: string; recruitmentIdList?: string[] } {
    if (s === undefined || s === "all") return { channel: cfg.channel };
    if (s === "social") {
      if (cfg.socialChannel) return { channel: cfg.socialChannel };
      return { channel: cfg.channel, recruitmentIdList: ["101"] };
    }
    if (s === "intern") {
      if (cfg.internChannel) return { channel: cfg.internChannel };
      return { channel: cfg.channel, recruitmentIdList: ["202"] };
    }
    if (s === "campus") return { channel: cfg.channel, recruitmentIdList: ["201"] };
    return { channel: cfg.channel };
  }

  function makeHeaders(channel: string): Record<string, string> {
    return {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "portal-channel": channel,
      "portal-platform": "pc",
      "website-path": channel,
      Referer: `https://${cfg.host}/${channel}/position`,
    };
  }

  async function call<T>(
    path: string,
    body: unknown,
    channel: string = cfg.channel
  ): Promise<{ ok: boolean; data?: T; message: string }> {
    const url = `${API_ROOT}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: makeHeaders(channel),
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

    let payload: FsEnvelope<T>;
    try {
      payload = (await response.json()) as FsEnvelope<T>;
    } catch (err) {
      return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
    }

    return {
      ok: payload.code === 0,
      data: payload.data,
      message: payload.message || (payload.code === 0 ? "ok" : "upstream error"),
    };
  }

  function summarizePosition(item: RawJobPost): PositionSummary {
    const id = String(item.id ?? "");
    const cityList = item.city_list ?? [];
    let work_cities: string;
    if (cityList.length > 1) {
      work_cities = cityList.map((c) => c.name ?? "").filter(Boolean).join(" / ");
    } else {
      work_cities = cityList[0]?.name ?? item.city_info?.name ?? "";
    }
    // NIO: job_category null, job_function has the name.
    // MiniMax: job_function null, job_category has the name.
    const project =
      item.job_category?.name ??
      item.job_function?.name ??
      "";
    return {
      post_id: id,
      title: item.title ?? "",
      project,
      recruit_label: item.recruit_type?.name ?? "",
      bgs: "",
      work_cities,
      apply_url: id ? `${cfg.applyUrlPrefix}/${encodeURIComponent(id)}/detail` : `https://${cfg.host}/${cfg.channel}/position`,
    };
  }

  const asStringList = (v: unknown): string[] | undefined => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.map(String);
  };

  // ---------- searchPositions ----------

  async function searchPositions(opts: SearchOptions = {}) {
    const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * pageSize;
    const keyword = (opts.keyword ?? "").trim().slice(0, 60);
    const scopeTranslation = channelForScope(opts.scope);

    const payload: Record<string, unknown> = {
      keyword,
      limit: pageSize,
      offset,
      portal_type: 3,
      portal_entrance: 1,
      language: "zh",
    };

    // Caller's explicit recruitmentIdList wins over the scope-derived one.
    // This preserves any 1.0.93 callsite that passed recruitmentIdList directly.
    const callerRecruitmentIdList = asStringList(opts.recruitmentIdList);
    const recruitmentIdList =
      callerRecruitmentIdList !== undefined && callerRecruitmentIdList.length > 0
        ? callerRecruitmentIdList
        : scopeTranslation.recruitmentIdList;
    if (recruitmentIdList !== undefined && recruitmentIdList.length > 0) {
      payload.recruitment_id_list = recruitmentIdList;
    }
    const jobCategoryIdList = asStringList(opts.jobCategoryIdList);
    if (jobCategoryIdList?.length) {
      payload.job_category_id_list = jobCategoryIdList;
    }
    const cityIdList = asStringList(opts.cityIdList);
    if (cityIdList?.length) {
      payload.location_code_list = cityIdList;
    }
    const subjectIdList = asStringList(opts.subjectIdList);
    if (subjectIdList?.length) {
      payload.subject_id_list = subjectIdList;
    }

    const response = await call<RawSearchData>(
      "/search/job/posts",
      payload,
      scopeTranslation.channel
    );
    if (!response.ok || !response.data) {
      return {
        ok: false,
        message: response.message,
        source,
        query: payload,
        positions: [] as PositionSummary[],
      };
    }

    const rows = response.data.job_post_list ?? [];
    return {
      ok: true,
      source,
      query: payload,
      scope: opts.scope,
      page,
      page_size: pageSize,
      total: response.data.count ?? rows.length,
      positions: rows.map(summarizePosition),
    };
  }

  // ---------- fetchAllPositions ----------

  async function fetchAllPositions(
    opts: SearchOptions & { maxPages?: number } = {}
  ) {
    const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
    const maxPages = Math.max(1, opts.maxPages ?? 5);

    const bucket: PositionSummary[] = [];
    let total: number | undefined;

    for (let page = 1; page <= maxPages; page++) {
      const result = await searchPositions({ ...opts, page, pageSize });
      if (!result.ok) {
        return {
          ok: false,
          message: result.message,
          source,
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
      source,
      total: total ?? bucket.length,
      fetched: bucket.length,
      positions: bucket,
    };
  }

  // ---------- fetchPositionDetail ----------
  // Feishu has no public per-post detail REST endpoint.
  // Paginate search and filter by id.

  async function fetchPositionDetail(postId: string) {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false, source, message: "post_id is required" };

    const pageSize = 100;
    const maxPages = 5;

    for (let page = 1; page <= maxPages; page++) {
      const offset = (page - 1) * pageSize;
      const payload = {
        keyword: "",
        limit: pageSize,
        offset,
        portal_type: 3,
        portal_entrance: 1,
        language: "zh",
      };
      const response = await call<RawSearchData>("/search/job/posts", payload);
      if (!response.ok || !response.data) break;

      const posts = response.data.job_post_list ?? [];
      const found = posts.find((p) => String(p.id) === id);
      if (found) {
        const summary = summarizePosition(found);
        return {
          ok: true,
          source,
          post_id: id,
          title: found.title ?? "",
          direction: found.sub_title ?? "",
          description: found.description ?? "",
          requirements: found.requirement ?? "",
          work_cities: found.city_list ?? (found.city_info ? [found.city_info] : []),
          apply_url: summary.apply_url,
        };
      }
      if (posts.length < pageSize) break;
    }

    return {
      ok: false,
      source,
      post_id: id,
      message: `post ${id} not found in public search results (searched up to ${maxPages * 100} posts)`,
    };
  }

  // ---------- fetchDictionaries ----------

  let _filterCache:
    | {
        ok: true;
        source: string;
        jobCategories: Array<{
          id: string;
          name: string;
          en_name: string;
          depth: number;
          parent_id: string | null;
        }>;
        cities: Array<{ code: string; name: string; en_name: string }>;
        subjects: Array<{ id: string; name: string; group: string }>;
        recruitmentTypes: Array<{ id: string; name: string }>;
      }
    | { ok: false; source: string; message: string }
    | null = null;

  async function fetchDictionaries() {
    if (_filterCache !== null) return _filterCache;

    const url = `${API_ROOT}/config/job/filters/${cfg.channel}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: makeHeaders(cfg.channel) });
    } catch (err) {
      const r = {
        ok: false as const,
        source,
        message: `network error: ${err instanceof Error ? err.message : String(err)}`,
      };
      _filterCache = r;
      return r;
    }

    if (!response.ok) {
      const r = { ok: false as const, source, message: `HTTP ${response.status}` };
      _filterCache = r;
      return r;
    }

    let payload: { code?: number; data?: RawFilterData; message?: string };
    try {
      payload = await response.json();
    } catch (err) {
      const r = {
        ok: false as const,
        source,
        message: `bad JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
      _filterCache = r;
      return r;
    }

    if (payload.code !== 0 || !payload.data) {
      const r = {
        ok: false as const,
        source,
        message: payload.message ?? "upstream error",
      };
      _filterCache = r;
      return r;
    }

    const d = payload.data;

    const jobCategories = (d.job_type_list ?? []).map((cat) => ({
      id: cat.id ?? "",
      name: cat.name ?? "",
      en_name: cat.en_name ?? "",
      depth: cat.depth ?? 1,
      parent_id: cat.parent?.id ?? null,
    }));

    const cities = (d.city_list ?? []).map((c) => ({
      code: c.code ?? "",
      name: c.name ?? "",
      en_name: c.en_name ?? "",
    }));

    const subjects = (d.job_subject_list ?? []).map((s) => ({
      id: s.id ?? "",
      name: s.name?.zh_cn ?? s.name?.i18n ?? "",
      group: s.subject_group_info?.name ?? "",
    }));

    const recruitmentTypes = [
      { id: "201", name: "正式" },
      { id: "202", name: "实习" },
    ];

    const result = {
      ok: true as const,
      source,
      jobCategories,
      cities,
      subjects,
      recruitmentTypes,
    };
    _filterCache = result;
    return result;
  }

  // ---------- stub notices ----------

  const NOTICES_STUB = {
    ok: false as const,
    source,
    message: `${cfg.label}: no public notices endpoint`,
  };

  async function listNotices(): Promise<typeof NOTICES_STUB> {
    return NOTICES_STUB;
  }

  async function getNotice(
    _id: string
  ): Promise<{ ok: false; source: string; message: string }> {
    return { ok: false, source, message: `${cfg.label}: no public notices endpoint` };
  }

  async function findNoticesByQuestion(
    _question: string,
    _opts: { questionTime?: string; topK?: number } = {}
  ): Promise<{ ok: false; source: string; message: string }> {
    return { ok: false, source, message: `${cfg.label}: no public notices endpoint` };
  }

  // ---------- matchResume ----------

  async function matchResume(
    text: string,
    opts: { topN?: number; candidates?: number } = {}
  ) {
    const topN = Math.max(1, opts.topN ?? 5);
    const candidates = Math.max(topN, opts.candidates ?? 20);
    const { terms, cities } = extractResumeSignals(text ?? "");

    if (!terms.length) {
      return {
        ok: false,
        source,
        message: "could not extract any technical signals from the text",
        preview: (text ?? "").slice(0, 120),
      };
    }

    const keyword = terms.slice(0, 3).join(" ");
    const list = await searchPositions({ keyword, page: 1, pageSize: 100 });
    if (!list.ok) {
      return { ok: false, source, message: list.message, positions: [] };
    }

    const payload = {
      keyword,
      limit: 100,
      offset: 0,
      portal_type: 3,
      portal_entrance: 1,
      language: "zh",
    };
    const raw = await call<RawSearchData>("/search/job/posts", payload);
    const rawPosts: RawJobPost[] = raw.ok ? (raw.data?.job_post_list ?? []) : [];

    const rawById = new Map<string, RawJobPost>();
    for (const p of rawPosts) {
      rawById.set(String(p.id ?? ""), p);
    }

    type Scored = {
      score: number;
      position: PositionSummary;
      reasons: string[];
      description?: string;
      requirements?: string;
    };
    const scored: Scored[] = [];

    for (const p of list.positions) {
      const rp = rawById.get(p.post_id);
      const blob = [
        p.title,
        p.project,
        p.recruit_label,
        p.work_cities,
        rp?.description ?? "",
        rp?.requirement ?? "",
      ].join(" ");
      const { score, reasons } = scoreOverlap(blob, terms, cities);
      if (score > 0) {
        scored.push({
          score,
          position: p,
          reasons,
          description: rp?.description,
          requirements: rp?.requirement,
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    let shortlist = scored.slice(0, Math.max(topN, candidates));
    if (!shortlist.length) {
      shortlist = list.positions.slice(0, candidates).map((position) => ({
        score: 0,
        position,
        reasons: [],
        description: rawById.get(position.post_id)?.description,
        requirements: rawById.get(position.post_id)?.requirement,
      }));
    }

    const matches = shortlist.slice(0, topN).map((s) => {
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
      source,
      extracted_terms: terms,
      city_preferences: cities,
      matches,
      note:
        "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
        "The only authority on selection is HR.",
    };
  }

  // ---------- fetchApplicationSchema (Phase 2) ----------
  //
  // Feishu's apply funnel is a 3-step token flow, not a single multipart
  // POST. Discovered via JS-bundle inspection of nio.jobs.feishu.cn
  // (lf-package-cn.feishucdn.com/obj/atsx-throne/hire-fe-prod/portal/
  // saas-career/static/js/*.js) — the routes baked into the bundle are:
  //
  //   1. POST {API_ROOT}/attachment/upload/tokens
  //        → returns short-lived presigned upload URL + attachment_id
  //   2. PUT  <presigned-URL on lf-package-cn.feishucdn.com>
  //        → uploads the resume PDF/DOCX bytes directly
  //   3. POST {API_ROOT}/attachment/exchange/tokens
  //        → exchanges short-lived id for a permanent attachment_id
  //   4. POST {API_ROOT}/user/delivery/check (pre-flight, optional)
  //   5. POST {API_ROOT}/resume/apply
  //        body: { post_id, attachment_id, applicant_info: { name, email,
  //                phone, ... }, ... }
  //        → returns { code:0, data:{ application_id } } on success
  //
  // The whole flow requires the user to be logged in as a candidate; the
  // session cookie set during login authorizes every call above. Capture
  // via the browser extension (~/.jobpro/<co>.session.json), then a
  // future iteration adds an `executeSubmission` hook that drives the
  // 3-step flow with the captured cookies.
  //
  // For now `fetchApplicationSchema` returns the contact-info schema
  // (sufficient for dry-run staging) plus `submit_kind: "feishu-3-step"`
  // so the dispatcher refuses --really-submit with a useful pointer.

  async function fetchApplicationSchema(postId: string): Promise<
    { ok: true; schema: ApplyFormSchema } | { ok: false; source: string; message: string }
  > {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false, source, message: "post_id is required" };
    const detail = await fetchPositionDetail(id);
    const detailAny = detail as { ok?: boolean; title?: string; message?: string };
    if (!detailAny.ok) {
      return { ok: false, source, message: detailAny.message ?? "post not found" };
    }
    return {
      ok: true,
      schema: buildFeishuApplySchema({
        host: cfg.host,
        source,
        channel: cfg.channel,
        applyUrlPrefix: cfg.applyUrlPrefix,
        postId: id,
        jobTitle: detailAny.title ?? "",
      }),
    };
  }

  return {
    supportedScopes,
    channelForScope,
    searchPositions,
    fetchAllPositions,
    fetchPositionDetail,
    fetchDictionaries,
    listNotices,
    getNotice,
    findNoticesByQuestion,
    matchResume,
    checkResume,
    fetchApplicationSchema,
  };
}
