// Generic Beisen Wecruit (北森 招聘云) adapter factory.
//
// Beisen Wecruit is one of two Beisen recruitment products we hit:
//   * Beisen iTalent  — hosted on `<tenant>.zhiye.com` (covered by vivo.ts /
//                       iflytek.ts / oppo.ts; envelope { Code, Data, Count }).
//   * Beisen Wecruit  — multi-tenant on `wecruit.hotjob.cn` and customer-owned
//                       hosts like `hr.sensetime.com`, `careers.<co>.com`.
//                       This module.
//
// Wecruit's distinguishing path is `/wecruit/...` at the host root. The
// public SPA bundles at `/{SU…}/pb/<channel>.html` are red herrings —
// every POST to that prefix returns nginx `405 Not Allowed`. The actual
// XHR the SPA fires is:
//
//   POST https://<host>/wecruit/positionInfo/listPosition/{SU…}
//        ?iSaJAx=isAjax&request_locale=zh_CN&t=<unix-ms>
//
//   Content-Type: application/x-www-form-urlencoded
//   Body: isFrompb=true&recruitType=<1|2>&pageSize=15&currentPage=1
//
// (Yes, form-urlencoded — not JSON — even though the response is JSON.)
//
// Response envelope:
//   { data:{ pageForm:{ totalPage, pageSize, pageData:[…], currentPage,
//                       dataCount }, positonNum },
//     state:"200", type:"success" }
//
// recruitType encoding: 1 = 校园 (campus / 应届 / 实习), 2 = 社招 (experienced).
// Each tenant has separate `SU…` channel ids per recruit type. See:
//   * `sensetime.ts`        — social `SU60fa3bdabef57c1023fc1cbc`
//   * `horizonrobotics.ts`  — school `SU6409ef49bef57c635fd390a6`,
//                             social `SU64819a4f2f9d2433ba8b043a`
//
// Probed 2026-05-16. Apply URL deep-links to the SPA detail route at
// `/{SU…}/pb/<channel>.html#/postDetail?postId=<postId>`.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { ApplyFormSchema, ApplyQuestion } from "./apply.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

// ---------- adapter config ----------

export interface WecruitChannel {
  /** SU… id from /{SU…}/pb/<channel>.html — campus or social. */
  channelId: string;
  /** Recruit type for this channel: "campus" → 1, "social" → 2. */
  recruitType: "campus" | "social";
  /** Page filename on the host — usually "school" / "social" / "interns". */
  pagePath: string;
}

export interface WecruitAdapterConfig {
  /** Tenant host — e.g. `hr.sensetime.com` or `wecruit.hotjob.cn`. */
  host: string;
  /** Human-readable label for source / error fields. */
  label: string;
  /** Channels (campus + social) to merge into the unified position list. */
  channels: WecruitChannel[];
}

// ---------- raw response types ----------

interface RawPosition {
  postId?: string;
  postName?: string;
  postCode?: string;
  postType?: string;
  postTypeName?: string;
  recruitType?: number;
  recruitNumStr?: string;
  recruitmentType?: string;
  workPlaceStr?: string;
  company?: string;
  department?: string;
  orgCode?: string;
  orgLogoUrl?: string;
  projectName?: string;
  projectId?: number;
  externalKey?: string;
  publishDate?: string;
  publishFirstDate?: string;
  endDate?: string;
  pageViews?: number;
  description?: string;
  duty?: string;
  responsibility?: string;
  require?: string;
  requirement?: string;
}

interface RawPageForm {
  totalPage?: number;
  pageSize?: number;
  pageData?: RawPosition[];
  currentPage?: number;
  dataCount?: number;
}

interface RawListData {
  pageForm?: RawPageForm;
  positonNum?: number;
}

interface RawEnvelope<T> {
  data?: T;
  state?: string;
  type?: string;
  msg?: string;
}

// ---------- PositionSummary (canonical) ----------

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
  /** "campus" → recruitType=1 ; "social" → recruitType=2 ; omit = all. */
  recruitType?: "campus" | "social" | "all";
  /**
   * Unified CLI scope flag (`--scope`). Translated into `recruitType` by the
   * factory: `social`/`campus`/`all` map 1:1; `intern` is treated as `campus`
   * since Wecruit's recruitType=1 covers 校园 / 应届 / 实习. If both `scope`
   * and `recruitType` are present, `scope` wins.
   */
  scope?: PositionScope;
}

// ---------- factory ----------

export function createAdapter(cfg: WecruitAdapterConfig) {
  const SOURCE = cfg.host;
  const SITE_ROOT = `https://${cfg.host}`;
  const detailUrl = (channelId: string, pagePath: string, postId: string) =>
    `${SITE_ROOT}/${encodeURIComponent(channelId)}/pb/${encodeURIComponent(pagePath)}.html#/postDetail?postId=${encodeURIComponent(postId)}`;

  const HEADERS = (channelId: string, pagePath: string): Record<string, string> => ({
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: SITE_ROOT,
    Referer: `${SITE_ROOT}/${channelId}/pb/${pagePath}.html`,
    "X-Requested-With": "XMLHttpRequest",
  });

  function urlEncode(form: Record<string, string | number | boolean | undefined>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.join("&");
  }

  async function postChannel(
    channel: WecruitChannel,
    pageNum: number,
    pageSize: number,
    keyword: string
  ): Promise<{ ok: boolean; pageForm?: RawPageForm; message: string }> {
    const ts = Date.now();
    const url = `${SITE_ROOT}/wecruit/positionInfo/listPosition/${channel.channelId}?iSaJAx=isAjax&request_locale=zh_CN&t=${ts}`;
    const recruitType = channel.recruitType === "social" ? 2 : 1;
    const form: Record<string, string | number | boolean> = {
      isFrompb: true,
      recruitType,
      pageSize,
      currentPage: pageNum,
    };
    if (keyword) form.postName = keyword;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: HEADERS(channel.channelId, channel.pagePath),
        body: urlEncode(form),
      });
    } catch (err) {
      return { ok: false, message: `network error: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
    }
    let payload: RawEnvelope<RawListData>;
    try {
      payload = (await response.json()) as RawEnvelope<RawListData>;
    } catch (err) {
      return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
    }
    if (payload.state !== "200" || !payload.data) {
      return { ok: false, message: payload.msg ?? `upstream state=${payload.state}` };
    }
    return { ok: true, pageForm: payload.data.pageForm, message: "ok" };
  }

  function summarize(item: RawPosition, channel: WecruitChannel): PositionSummary {
    const id = String(item.postId ?? "");
    const labelFromRecruitType =
      item.recruitmentType ?? (item.recruitType === 2 ? "社招" : item.recruitType === 1 ? "校园" : "");
    return {
      post_id: id,
      title: (item.postName ?? "").trim(),
      project: (item.postTypeName ?? "").trim(),
      recruit_label: labelFromRecruitType,
      bgs: (item.department ?? item.company ?? "").trim(),
      work_cities: (item.workPlaceStr ?? "").trim(),
      apply_url: id ? detailUrl(channel.channelId, channel.pagePath, id) : `${SITE_ROOT}/${channel.channelId}/pb/${channel.pagePath}.html`,
    };
  }

  function channelsForType(t: SearchOptions["recruitType"]): WecruitChannel[] {
    if (!t || t === "all") return cfg.channels;
    return cfg.channels.filter((c) => c.recruitType === t);
  }

  /**
   * Translate the unified CLI `--scope` flag to this factory's `recruitType`
   * key. `intern` collapses to `campus` because Wecruit's recruitType=1
   * channel covers 校园 / 应届 / 实习 in one bucket. `social`, `campus`, and
   * `all` map 1:1 onto the existing recruitType domain.
   */
  function recruitTypeForScope(s: PositionScope | undefined): SearchOptions["recruitType"] {
    if (s === undefined) return undefined;
    if (s === "intern") return "campus";
    return s;
  }

  /** Resolve effective recruitType, with `scope` winning over legacy `recruitType`. */
  function effectiveRecruitType(opts: SearchOptions): SearchOptions["recruitType"] {
    if (opts.scope !== undefined) return recruitTypeForScope(opts.scope);
    return opts.recruitType;
  }

  /**
   * Scopes this adapter can actually serve, derived from the configured
   * channels' `recruitType` values. `all` is always supported.
   */
  const supportedScopes: ReadonlyArray<PositionScope> = (() => {
    const set = new Set<PositionScope>();
    for (const ch of cfg.channels) {
      if (ch.recruitType === "social") set.add("social");
      if (ch.recruitType === "campus") set.add("campus");
    }
    set.add("all");
    return Object.freeze([...set]);
  })();

  async function searchPositions(opts: SearchOptions = {}) {
    const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 15));
    const page = Math.max(1, opts.page ?? 1);
    const keyword = (opts.keyword ?? "").trim().slice(0, 60);
    const channels = channelsForType(effectiveRecruitType(opts));
    if (!channels.length) {
      return {
        ok: false as const,
        source: SOURCE,
        message: `no channels match recruitType=${opts.recruitType ?? "all"}`,
        query: opts,
        positions: [] as PositionSummary[],
      };
    }
    // For single-channel adapters this is one call. For multi-channel
    // (campus+social) we round-robin: we ask each channel for the same
    // page index and merge the resulting positions. Total reflects the
    // sum across channels.
    const positions: PositionSummary[] = [];
    let total = 0;
    let lastMsg = "ok";
    let anyOk = false;
    for (const ch of channels) {
      const r = await postChannel(ch, page, pageSize, keyword);
      if (!r.ok || !r.pageForm) {
        lastMsg = r.message;
        continue;
      }
      anyOk = true;
      total += (r.pageForm.dataCount ?? 0) || (r.pageForm.totalPage ?? 0) * (r.pageForm.pageSize ?? 0);
      for (const p of r.pageForm.pageData ?? []) positions.push(summarize(p, ch));
    }
    if (!anyOk) {
      return {
        ok: false as const,
        source: SOURCE,
        message: lastMsg,
        query: opts,
        positions,
      };
    }
    return {
      ok: true as const,
      source: SOURCE,
      query: opts,
      page,
      page_size: pageSize,
      total,
      positions,
    };
  }

  async function fetchAllPositions(opts: SearchOptions & { maxPages?: number } = {}) {
    const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 15));
    const maxPages = Math.max(1, opts.maxPages ?? 30);
    const keyword = (opts.keyword ?? "").trim().slice(0, 60);
    const channels = channelsForType(effectiveRecruitType(opts));
    const bucket: PositionSummary[] = [];
    let total = 0;
    let lastMsg = "ok";
    let anyOk = false;

    for (const ch of channels) {
      let chTotal: number | undefined;
      for (let page = 1; page <= maxPages; page++) {
        const r = await postChannel(ch, page, pageSize, keyword);
        if (!r.ok || !r.pageForm) {
          lastMsg = r.message;
          break;
        }
        anyOk = true;
        if (chTotal === undefined) {
          chTotal = (r.pageForm.totalPage ?? 0) * (r.pageForm.pageSize ?? 0) || (r.pageForm.dataCount ?? 0);
          total += chTotal;
        }
        const data = r.pageForm.pageData ?? [];
        if (!data.length) break;
        for (const p of data) bucket.push(summarize(p, ch));
        if (page >= (r.pageForm.totalPage ?? 0)) break;
      }
    }
    if (!anyOk) {
      return {
        ok: false as const,
        source: SOURCE,
        message: lastMsg,
        total: 0,
        fetched: bucket.length,
        positions: bucket,
      };
    }
    return {
      ok: true as const,
      source: SOURCE,
      total,
      fetched: bucket.length,
      positions: bucket,
    };
  }

  async function fetchPositionDetail(postId: string) {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };
    // Wecruit's listPosition includes description-light fields only.
    // We scan pages until we find the post.
    const pageSize = 50;
    const maxPages = 20;
    for (const ch of cfg.channels) {
      for (let page = 1; page <= maxPages; page++) {
        const r = await postChannel(ch, page, pageSize, "");
        if (!r.ok || !r.pageForm) break;
        const found = (r.pageForm.pageData ?? []).find((p) => p.postId === id);
        if (found) {
          const summary = summarize(found, ch);
          return {
            ok: true as const,
            source: SOURCE,
            post_id: id,
            title: found.postName ?? "",
            project: summary.project,
            recruit_label: summary.recruit_label,
            company: found.company ?? "",
            department: found.department ?? "",
            work_cities: found.workPlaceStr ?? "",
            recruit_num: found.recruitNumStr ?? "",
            page_views: found.pageViews ?? 0,
            publish_date: found.publishDate ?? found.publishFirstDate ?? "",
            end_date: found.endDate ?? "",
            apply_url: summary.apply_url,
          };
        }
        if (page >= (r.pageForm.totalPage ?? 0)) break;
      }
    }
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `post ${id} not found across ${cfg.channels.length} channel(s)`,
    };
  }

  // ---------- fetchDictionaries ----------
  // Synthesize from one page per channel (postTypeName, workPlaceStr, etc.).

  let _dictCache:
    | {
        ok: true;
        source: string;
        channels: Array<{ channelId: string; recruitType: string; pagePath: string; total: number }>;
        post_types: string[];
        cities: string[];
        companies: string[];
      }
    | { ok: false; source: string; message: string }
    | null = null;

  async function fetchDictionaries() {
    if (_dictCache !== null) return _dictCache;
    const types = new Set<string>();
    const cities = new Set<string>();
    const companies = new Set<string>();
    const channelInfo: Array<{ channelId: string; recruitType: string; pagePath: string; total: number }> = [];
    let anyOk = false;
    let lastMsg = "ok";
    for (const ch of cfg.channels) {
      const r = await postChannel(ch, 1, 50, "");
      if (!r.ok || !r.pageForm) {
        lastMsg = r.message;
        continue;
      }
      anyOk = true;
      const total = (r.pageForm.totalPage ?? 0) * (r.pageForm.pageSize ?? 0) || (r.pageForm.dataCount ?? 0);
      channelInfo.push({
        channelId: ch.channelId,
        recruitType: ch.recruitType,
        pagePath: ch.pagePath,
        total,
      });
      for (const p of r.pageForm.pageData ?? []) {
        if (p.postTypeName) types.add(p.postTypeName);
        if (p.workPlaceStr) cities.add(p.workPlaceStr);
        if (p.company) companies.add(p.company);
      }
    }
    if (!anyOk) {
      const r = { ok: false as const, source: SOURCE, message: lastMsg };
      _dictCache = r;
      return r;
    }
    const result = {
      ok: true as const,
      source: SOURCE,
      channels: channelInfo,
      post_types: [...types].sort(),
      cities: [...cities].sort(),
      companies: [...companies].sort(),
    };
    _dictCache = result;
    return result;
  }

  // ---------- notices (stub) ----------

  const NOTICES_STUB = {
    ok: false as const,
    source: SOURCE,
    message: `${cfg.label}: Wecruit tenants have no public notices endpoint`,
  };

  async function listNotices() {
    return { ...NOTICES_STUB, notices: [] as never[] };
  }

  async function getNotice(noticeId: string) {
    return { ...NOTICES_STUB, notice_id: noticeId };
  }

  async function findNoticesByQuestion(
    question: string,
    _opts: { questionTime?: string; topK?: number } = {}
  ) {
    return { ...NOTICES_STUB, question, matches: [] as never[] };
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
        ok: false as const,
        source: SOURCE,
        message: "could not extract any technical signals from the text",
        preview: (text ?? "").slice(0, 120),
      };
    }
    const keyword = terms.slice(0, 3).join(" ");
    const list = await searchPositions({ keyword, page: 1, pageSize: 50 });
    if (!list.ok) {
      return { ok: false as const, source: SOURCE, message: list.message, positions: [] };
    }
    type Scored = { score: number; position: PositionSummary; reasons: string[] };
    const scored: Scored[] = [];
    for (const p of list.positions) {
      const blob = [p.title, p.project, p.recruit_label, p.work_cities, p.bgs].join(" ");
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

  // ---------- Phase 2: fetchApplicationSchema ----------
  //
  // Beisen Wecruit apply endpoints discovered in
  // hr.sensetime.com/pb/js/vendor.js (probed 2026-05-16, 3.8 MB bundle):
  //
  //   POST /wecruit/resume/upload/file/save/<channelId>  — upload resume PDF/DOCX
  //   POST /wecruit/resume/info/add/<channelId>          — create/update profile
  //   POST /wecruit/resume/info/get/<channelId>          — read existing profile
  //   POST /wecruit/delivery/resume/<channelId>          — final submission
  //
  // The candidate session is established by Wecruit's WeChat-OAuth or
  // phone-OTP login at /pb/<channel>/login.html. Cookies for that session
  // are captured by the browser extension and dropped under
  // ~/.jobpro/<adapter>.session.json.
  async function fetchApplicationSchema(postId: string): Promise<
    { ok: true; schema: ApplyFormSchema } | { ok: false; source: string; message: string }
  > {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false, source: SOURCE, message: "post_id is required" };
    const ch = cfg.channels[0];
    if (!ch) return { ok: false, source: SOURCE, message: "no channels configured" };
    const detail = await fetchPositionDetail(id);
    const detailAny = detail as { ok?: boolean; title?: string; message?: string };
    const questions: ApplyQuestion[] = [
      { label: "Name",   required: true, fields: [{ name: "name",   type: "input_text" }] },
      { label: "Email",  required: true, fields: [{ name: "email",  type: "input_text" }] },
      { label: "Phone",  required: true, fields: [{ name: "phone",  type: "input_text" }] },
      { label: "Resume", required: true, fields: [{ name: "resume", type: "input_file" }] },
    ];
    return {
      ok: true,
      schema: {
        source: SOURCE,
        post_id: id,
        job_title: detailAny.title ?? "",
        apply_url: `${SITE_ROOT}/${encodeURIComponent(ch.channelId)}/pb/${ch.pagePath}.html`,
        submit_endpoint: `${SITE_ROOT}/wecruit/delivery/resume/${encodeURIComponent(ch.channelId)}`,
        submit_method: "POST",
        submit_kind: "beisen-wecruit",
        endpoint_verified: true,
        submit_notes:
          "Beisen Wecruit apply flow: POST /wecruit/resume/upload/file/save/<SU> → " +
          "POST /wecruit/resume/info/add/<SU> → POST /wecruit/delivery/resume/<SU> with " +
          "{ post_id, resume_attachment_id, channel_id }. Endpoint verified by reading " +
          "/pb/js/vendor.js (Beisen Wecruit's vendor bundle) which lists /delivery/resume/, " +
          "/resume/info/add/, /resume/upload/file/save/ etc as quoted paths. Anon-probe with " +
          "X-Requested-With:XMLHttpRequest header → HTTP 200 + {type:\"error\",state:\"809\"," +
          "msg:\"您尚未登录...\"} = real auth gate (without that header, Nginx returns the SPA HTML). " +
          "Requires candidate session (WeChat OAuth or phone OTP via /pb/<channel>/login.html).",
        questions,
      },
    };
  }

  return {
    supportedScopes,
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
