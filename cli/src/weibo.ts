// Weibo / Sina campus + social recruiting adapter.
//
// ============================================================
// API DISCOVERY (probed 2026-05-15)
//
// Weibo/Sina posts every position through their Moka (北森's competitor)
// recruitment portal at app.mokahr.com under the `sina` tenant. The original
// career.sina.com.cn 302-loop was a red herring — that host just redirects
// into the Moka SPA at:
//
//   campus: https://app.mokahr.com/campus-recruitment/sina/43534 (dark)
//   social: https://app.mokahr.com/social-recruitment/sina/43535
//
// Moka exposes a fully anonymous JSON endpoint for the position list:
//
//   POST https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2
//
// Required body fields: `orgId` ("sina"), `siteId` (the trailing site id from
// the URL — 43534 campus, 43535 social), plus pagination/keyword. Every
// endpoint rejects the dark campus siteId 43534: /website/job answers inner
// code=102 参数错误, filterFieldsAggregations answers 703002 未找到对应的官网
// (both re-probed 2026-07-11) — always send 43535. The response body is
// AES-128-CBC encrypted:
//
//   {
//     "data": <base64 ciphertext>,
//     "necromancer": <hex string AES key>
//   }
//
// Decryption parameters:
//   key  = utf-8 bytes of `necromancer` (per-response, 16 chars / 16 bytes)
//   iv   = utf-8 bytes of a static `aesIv` embedded in the SPA page HTML
//          (`window.TurboApply.data.aesIv`). For the sina tenant the iv is
//          "de7c21ed8d6f50fe" and has remained stable across page reloads.
//   mode = CBC, padding = PKCS#7
//
// Endpoint inventory (all anon, all app.mokahr.com):
//   POST /api/outer/ats-apply/website/jobs/v2                → paginated list
//   POST /api/outer/ats-apply/website/group-by-job           → grouped list
//   POST /api/outer/ats-apply/website/job                    → single posting
//   POST /api/outer/ats-apply/website/jobs/v2/filterFieldsAggregations
//                                                            → filter taxonomy
//   POST /api/outer/ats-apply/website/manage-job-count       → counts only
//   POST /api/outer/ats-apply/privacy-policy/get             → site privacy
// ============================================================

import { createDecipheriv } from "node:crypto";
import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

// Weibo's campus siteId 43534 returns "未找到对应的官网" — campus channel
// is dark. Only siteId 43535 (social) is live. Declare social/all so the
// dispatcher refuses `--scope campus` instead of returning a confusing error.
export const supportedScopes: ReadonlyArray<PositionScope> = ["social", "all"] as const;

const SOURCE = "app.mokahr.com/sina";
const API_ROOT = "https://app.mokahr.com";
const ORG_ID = "sina";
const CAMPUS_SITE_ID = 43534;
const SOCIAL_SITE_ID = 43535;
const CAMPUS_PAGE = `https://app.mokahr.com/campus-recruitment/sina/${CAMPUS_SITE_ID}`;
const SOCIAL_PAGE = `https://app.mokahr.com/social-recruitment/sina/${SOCIAL_SITE_ID}`;
// AES IV embedded in `window.TurboApply.data.aesIv` of the sina recruitment SPA.
const AES_IV = "de7c21ed8d6f50fe";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
  // Campus portal 43534 is dark — default every request to the live social page.
  Referer: SOCIAL_PAGE,
  Origin: API_ROOT,
};

function decryptResponse(b64Cipher: string, hexKey: string): unknown {
  const cipherBuf = Buffer.from(b64Cipher, "base64");
  const key = Buffer.from(hexKey, "utf-8");
  const iv = Buffer.from(AES_IV, "utf-8");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  const plain = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  return JSON.parse(plain.toString("utf-8"));
}

interface MokaEnvelope {
  // Base64 ciphertext on encrypted replies; some endpoints (e.g.
  // filterFieldsAggregations) answer success as plaintext with the payload
  // object directly in `data` and no `necromancer` (probed 2026-07-11).
  data?: string | Record<string, unknown> | unknown[];
  necromancer?: string;
  // unencrypted error envelope
  code?: number;
  codeType?: number;
  msg?: string;
  success?: boolean;
}

interface MokaPayload<T> {
  code?: number;
  codeType?: number;
  msg?: string;
  success?: boolean;
  data?: T;
}

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  referer = SOCIAL_PAGE
): Promise<{ ok: boolean; data?: T; message: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers: { ...DEFAULT_HEADERS, Referer: referer },
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
  let env: MokaEnvelope;
  try {
    env = (await response.json()) as MokaEnvelope;
  } catch (err) {
    return { ok: false, message: `bad JSON: ${err instanceof Error ? err.message : err}` };
  }

  // Plaintext success envelope: code 0 with the payload object inline
  // (filterFieldsAggregations replies this way — probed 2026-07-11).
  if (env.code === 0 && env.data !== undefined && typeof env.data !== "string") {
    return { ok: true, data: env.data as T, message: env.msg || "ok" };
  }
  // Error envelope (no ciphertext): code != 0.
  if (env.code !== undefined && (!env.data || typeof env.data !== "string")) {
    return { ok: false, message: env.msg || `moka error code=${env.code}` };
  }
  if (!env.data || typeof env.data !== "string" || !env.necromancer) {
    return { ok: false, message: "missing ciphertext or key in moka response" };
  }
  let plain: MokaPayload<T>;
  try {
    plain = decryptResponse(env.data, env.necromancer) as MokaPayload<T>;
  } catch (err) {
    return {
      ok: false,
      message: `decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!plain.success || plain.code !== 0) {
    return { ok: false, message: plain.msg || `moka inner code=${plain.code}` };
  }
  return { ok: true, data: plain.data, message: plain.msg || "ok" };
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
  /** "social" (社招, default — campus site 43534 is dark) or "campus" (校招) */
  channel?: "campus" | "social";
  /** CLI-level scope flag; translated to `channel` internally.
   *  scope=social → siteId 43535, scope=campus → siteId 43534.
   *  scope=all and undefined default to social (the only live site). */
  scope?: PositionScope;
}

function channelFromScope(scope: PositionScope | undefined): "campus" | "social" | undefined {
  if (scope === "social") return "social";
  if (scope === "campus") return "campus";
  return undefined;
}

interface RawJob {
  id?: string;
  title?: string;
  department?: { id?: number; name?: string };
  locations?: Array<{ cityName?: string; provinceName?: string; country?: string }>;
  hireMode?: number;
  commitment?: string;
  status?: string;
  publishedAt?: string;
  openedAt?: string;
  projectFolder?: { name?: string };
}

function summarize(
  item: RawJob,
  channel: "campus" | "social",
  siteId: number
): PositionSummary {
  const id = String(item.id ?? "");
  const cities = (item.locations ?? [])
    .map((l) => [l.provinceName, l.cityName].filter(Boolean).join("·"))
    .filter((s) => s.length > 0)
    .join(", ");
  const label = channel === "social" ? "社招" : item.hireMode === 2 ? "校招" : "校招";
  return {
    post_id: id,
    title: (item.title ?? "").trim(),
    project: item.projectFolder?.name?.trim() ?? "",
    recruit_label: label,
    bgs: (item.department?.name ?? "").trim(),
    work_cities: cities,
    // Moka uses hash routing. Different tenants register different route
    // shapes — sina's portal uses `#/job/<id>` (singular). The old form
    // `/<channel>-recruitment/sina/<siteId>/job/<id>` (no fragment) hits the
    // tenant's "page not found" handler at the server level. Verified via
    // headless browser against the list page's own `<a href>` emit.
    apply_url: id
      ? `https://app.mokahr.com/${channel}-recruitment/sina/${siteId}#/job/${encodeURIComponent(id)}`
      : channel === "social"
      ? SOCIAL_PAGE
      : CAMPUS_PAGE,
  };
}

// ---------- searchPositions ----------

export async function searchPositions(opts: SearchOptions = {}) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  // Default channel is social because campus siteId 43534 is permanently
  // dark ("未找到对应的官网"). scope=campus is refused by the dispatcher.
  const channel = opts.channel ?? channelFromScope(opts.scope) ?? "social";
  const siteId = channel === "social" ? SOCIAL_SITE_ID : CAMPUS_SITE_ID;
  const refererPage = channel === "social" ? SOCIAL_PAGE : CAMPUS_PAGE;

  const body: Record<string, unknown> = {
    orgId: ORG_ID,
    siteId: String(siteId),
    limit: pageSize,
    offset: (page - 1) * pageSize,
    needStat: true,
    jobIdTopList: [],
    customFields: {},
    site: channel,
    locale: "zh-CN",
  };
  if (opts.keyword) body.keyword = opts.keyword.trim().slice(0, 60);

  const r = await post<{ jobs?: RawJob[]; jobStats?: { total?: number } }>(
    "/api/outer/ats-apply/website/jobs/v2",
    body,
    refererPage
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
  const rows = r.data.jobs ?? [];
  return {
    ok: true as const,
    source: SOURCE,
    query: body,
    page,
    page_size: pageSize,
    total: r.data.jobStats?.total ?? rows.length,
    positions: rows.map((j) => summarize(j, channel, siteId)),
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  opts: { keyword?: string; maxPages?: number; pageSize?: number; channel?: "campus" | "social"; scope?: PositionScope } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 50));
  const maxPages = Math.max(1, opts.maxPages ?? 20);

  const bucket: PositionSummary[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let exhausted = false;

  for (let page = 1; page <= maxPages; page++) {
    const r = await searchPositions({
      keyword: opts.keyword,
      page,
      pageSize,
      channel: opts.channel,
      scope: opts.scope,
    });
    if (!r.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        message: r.message,
        total: 0,
        fetched: bucket.length,
        positions: bucket,
      };
    }
    if (total === undefined) total = r.total;
    // Dedupe by post_id and stop when a page adds nothing new — guards
    // against upstream ignoring offset (seen on other Moka tenants).
    let added = 0;
    for (const p of r.positions) {
      if (!p.post_id || seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      bucket.push(p);
      added++;
    }
    if (added === 0) {
      exhausted = true;
      break;
    }
    if (total !== undefined && bucket.length >= total) {
      exhausted = true;
      break;
    }
    // Short page ⇒ upstream has no more rows.
    if (r.positions.length < pageSize) {
      exhausted = true;
      break;
    }
  }
  return {
    ok: true as const,
    source: SOURCE,
    total: total ?? bucket.length,
    fetched: bucket.length,
    // True only when we hit maxPages with rows still unread upstream.
    ...(exhausted ? {} : { truncated: true as const }),
    positions: bucket,
  };
}

// ---------- fetchPositionDetail ----------

/** Flatten Moka's rich-text jobDescription HTML into readable plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|ul|ol|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// /website/job response shape verified against the live API (2026-07-11):
// the JD lives in `jobDescription` (HTML, 职位描述+任职资格 in one blob);
// there are NO description/requirement/responsibility fields. Job function
// comes back as `zhineng` ({id, name}); projectFolder is absent.
interface RawJobDetail extends RawJob {
  jobDescription?: string;
  zhineng?: { id?: number; name?: string };
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required", post_id: id };
  // Campus siteId 43534 is dark and makes /website/job answer inner code=102
  // 参数错误 for every jobId; all live postings hang off social 43535
  // (verified 2026-07-11 — same body with siteId "43535" returns the full job).
  const r = await post<RawJobDetail>(
    "/api/outer/ats-apply/website/job",
    {
      orgId: ORG_ID,
      siteId: String(SOCIAL_SITE_ID),
      jobId: id,
      locale: "zh-CN",
    },
    SOCIAL_PAGE
  );
  if (!r.ok || !r.data) {
    return { ok: false as const, source: SOURCE, message: r.message || "no detail returned", post_id: id };
  }
  const raw = r.data;
  const cities = (raw.locations ?? [])
    .map((l) => [l.provinceName, l.cityName].filter(Boolean).join("·"))
    .join(", ");
  return {
    ok: true as const,
    source: SOURCE,
    post_id: String(raw.id ?? id),
    title: raw.title ?? "",
    project: raw.projectFolder?.name ?? raw.zhineng?.name ?? "",
    department: raw.department?.name ?? "",
    // Upstream ships one combined JD blob (职位描述 + 任职资格) — there is no
    // separate requirements field to split out.
    description: htmlToText(raw.jobDescription ?? ""),
    work_cities: cities,
    commitment: raw.commitment ?? "",
    published_at: raw.publishedAt ?? raw.openedAt ?? "",
    apply_url: `${SOCIAL_PAGE}#/job/${encodeURIComponent(String(raw.id ?? id))}`,
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries() {
  // Campus siteId 43534 answers 703002 未找到对应的官网; the live social site
  // 43535 replies with a plaintext success envelope (probed 2026-07-11).
  const r = await post<unknown>(
    "/api/outer/ats-apply/website/jobs/v2/filterFieldsAggregations",
    { orgId: ORG_ID, siteId: String(SOCIAL_SITE_ID), locale: "zh-CN" },
    SOCIAL_PAGE
  );
  return {
    ok: r.ok,
    source: SOURCE,
    api_host: API_ROOT,
    verified_at: new Date().toISOString(),
    filter_fields: r.data ?? null,
    channels: { campus: CAMPUS_SITE_ID, social: SOCIAL_SITE_ID },
  };
}

// ---------- notices (no public endpoint on Moka tenant) ----------

const NO_NOTICES = "Weibo/Sina Moka tenant does not expose a public notices/announcements endpoint.";

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: NO_NOTICES, notices: [] as never[] };
}
export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: NO_NOTICES, notice_id: noticeId };
}
export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return { ok: false as const, source: SOURCE, question, message: NO_NOTICES, matches: [] as never[] };
}

// ---------- matchResume ----------

export async function matchResume(text: string, opts: { topN?: number; candidates?: number } = {}) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  const topN = Math.max(1, opts.topN ?? 5);
  const candidates = Math.max(topN, opts.candidates ?? 200);

  const all = await fetchAllPositions({ pageSize: 50, maxPages: Math.ceil(candidates / 50) });
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
