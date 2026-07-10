// 小鹏汽车 (XPeng Motors) careers adapter, built on the Feishu Hire factory.
//
// ============================================================
// MIGRATION (re-probed 2026-07-11)
//
// Until 1.1.x this adapter pointed at XPeng's US Greenhouse board
// (boards-api.greenhouse.io/v1/boards/xpengmotors — 19 English positions,
// almost all Santa Clara). That board is XPeng's US AI subsidiary only and
// misses the main China channel entirely (audit: keyword 工程师 → 0 via
// Greenhouse vs 732 on the official site). The China portal lives on
// Feishu Hire at https://xiaopeng.jobs.feishu.cn/ — same
// `POST /api/v1/search/job/posts` surface as every *.jobs.feishu.cn tenant.
//
// Portal channels (`portal-channel` / `website-path` headers, probed
// 2026-07-11 with portal_type 3; the site itself sends 6 — both accepted):
//
//   "index"  → 社招 main site  (https://xiaopeng.jobs.feishu.cn/index,
//               1551 posts; keyword 工程师 → 732, matching the官网 count.
//               The empty channel "" also resolves but returns slightly
//               fewer posts, 1546 — "index" is the channel the visible
//               portal uses, so we use it.)
//   "campus" → 校招 site       (https://xiaopeng.jobs.feishu.cn/campus,
//               456 posts = 276 正式 [recruitment_id 201] + 180 实习 [202])
//   "social" / "society" / "internship" → code -9000003 "site not exist"
//
// Scope mapping:
//   social → channel "index"    (dedicated socialChannel)
//   campus → channel "campus"   (dedicated campusChannel)
//   intern → channel "campus" + recruitment_id_list ["202"]  — there is no
//            dedicated intern channel, and the factory's fallback would be
//            default-channel ("index") + ["202"] which returns count 0
//            (interns are only published on the campus portal). The local
//            wrapper below rewrites intern → campus + ["202"] (180 posts
//            at probe time) before handing off to the factory.
//   all / undefined → channel "index" (historical default = main site)
//
// Detail: unlike NIO/SenseTime this tenant exposes a real per-post endpoint
//   GET /api/v1/job/posts/<id>?portal_type=3
//     → { code:0, data:{ job_post_detail:{ title, description, requirement,
//         city_list, recruit_type, … } } }
//     works for BOTH channels regardless of the portal-channel header;
//     unknown id → code:0 with data.recommend_job_post_List and NO
//     job_post_detail (clean not-found detection).
// We use it instead of the factory's paged-search sweep because the main
// channel holds 1551 posts and the sweep only scans the first 500/channel.
//
// apply_url: https://xiaopeng.jobs.feishu.cn/index/position/<id>/detail
// SSR-renders both social and campus posts (verified 2026-07-11);
// /position/<id>/detail without a channel prefix 404s. Campus/intern
// results and campus details are rewritten to the canonical
// /campus/position/<id>/detail (recruit_type.parent.id "2" = 校招).
//
// The US Greenhouse board (xpengmotors) is intentionally dropped rather
// than merged: 19 posts vs 2000+, and merging two upstreams would break
// total/pagination semantics. See git history for the old adapter.

import { createAdapter, type SearchOptions, type PositionSummary } from "./feishu.js";
import type { PositionScope } from "./adapter.js";

const HOST = "xiaopeng.jobs.feishu.cn";
const SOURCE = HOST;
const SOCIAL_CHANNEL = "index";
const CAMPUS_CHANNEL = "campus";

const adapter = createAdapter({
  host: HOST,
  label: "XPeng / 小鹏汽车",
  channel: SOCIAL_CHANNEL,
  socialChannel: SOCIAL_CHANNEL,
  campusChannel: CAMPUS_CHANNEL,
  applyUrlPrefix: `https://${HOST}/${SOCIAL_CHANNEL}/position`,
  supportedScopes: ["social", "campus", "intern", "all"] as const,
});

export const supportedScopes: ReadonlyArray<PositionScope> = [
  "social",
  "campus",
  "intern",
  "all",
] as const;

type AllOptions = SearchOptions & { maxPages?: number };

/**
 * intern → campus channel + recruitment_id_list ["202"].
 *
 * Probed 2026-07-11: default channel ("index") + ["202"] → count 0, while
 * campus channel + ["202"] → count 180 (titles like "Robotaxi VLA 大模型
 * 算法实习生", recruit_type 实习/校招). A caller-provided recruitmentIdList
 * wins (factory semantics preserved).
 */
function translateScope<T extends AllOptions>(opts: T): T {
  if (opts.scope !== "intern") return opts;
  const caller = opts.recruitmentIdList;
  return {
    ...opts,
    scope: "campus",
    recruitmentIdList: Array.isArray(caller) && caller.length > 0 ? caller : ["202"],
  };
}

/** Rewrite campus-portal positions to their canonical /campus/ apply URL. */
function toCampusUrl(p: PositionSummary): PositionSummary {
  return {
    ...p,
    apply_url: p.apply_url.replace(`/${SOCIAL_CHANNEL}/position/`, `/${CAMPUS_CHANNEL}/position/`),
  };
}

export async function searchPositions(opts: SearchOptions = {}) {
  const result = await adapter.searchPositions(translateScope(opts));
  if (!result.ok) return result;
  if (opts.scope === "campus" || opts.scope === "intern") {
    return { ...result, scope: opts.scope, positions: result.positions.map(toCampusUrl) };
  }
  return result;
}

/**
 * Exhaustive fetch with post_id dedup, short-page / no-progress stop and a
 * `truncated` flag. Replaces the factory loop because (a) the main channel
 * holds 1551 posts and the factory default of 5 pages silently stops at 500
 * without flagging it, and (b) *.jobs.feishu.cn hosts sit behind a WAF that
 * can 405 rapid anonymous bursts — we back off and retry instead of failing
 * the whole crawl.
 *
 * `--scope all` merges BOTH portals (index 社招 + campus 校招/实习), per the
 * adapter.ts contract ("all" = explicitly fetch every channel and merge);
 * omitting --scope keeps the historical default (main 社招 site only).
 * The two portals are disjoint id spaces (campus posts are absent from the
 * index channel: index + recruitment_id_list ["201"/"202"] → count 0), but
 * we dedupe across them anyway.
 */
export async function fetchAllPositions(opts: AllOptions = {}) {
  if (opts.scope === "all") {
    const social = await crawlChannel({ ...opts, scope: "social" });
    if (!social.ok) return social;
    const campus = await crawlChannel({ ...opts, scope: "campus" });
    if (!campus.ok) {
      // Social half succeeded — return it as an explicitly-truncated partial
      // rather than throwing away 1500+ fetched posts.
      return {
        ...social,
        scope: "all" as const,
        truncated: true,
        note: `campus channel failed: ${campus.message}`,
      };
    }
    const seen = new Set(social.positions.map((p) => p.post_id));
    const positions = [...social.positions];
    for (const p of campus.positions) {
      if (seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      positions.push(p);
    }
    return {
      ok: true as const,
      source: SOURCE,
      scope: "all" as const,
      total: social.total + campus.total,
      fetched: positions.length,
      truncated: social.truncated || campus.truncated,
      positions,
    };
  }
  return crawlChannel(opts);
}

async function crawlChannel(opts: AllOptions) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 25);

  const seen = new Set<string>();
  const positions: PositionSummary[] = [];
  let total: number | undefined;
  let stopNote: string | undefined;

  for (let page = 1; page <= maxPages; page++) {
    let result = await searchPositions({ ...opts, page, pageSize });
    // WAF backoff: a burst of anonymous requests can get HTTP 405; wait and
    // retry (twice) before giving up on the page.
    for (let attempt = 0; !result.ok && /HTTP 405/.test(result.message ?? "") && attempt < 2; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      result = await searchPositions({ ...opts, page, pageSize });
    }
    if (!result.ok) {
      if (positions.length === 0) {
        return { ok: false as const, message: result.message, source: SOURCE, fetched: 0, positions };
      }
      stopNote = `stopped early at page ${page}: ${result.message}`;
      break;
    }
    if (total === undefined) total = result.total;
    const before = positions.length;
    for (const p of result.positions) {
      if (!p.post_id || seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      positions.push(p);
    }
    if (result.positions.length < pageSize) break; // short page → exhausted
    if (positions.length === before) break; // page yielded nothing new
    if (total !== undefined && positions.length >= total) break;
  }

  const truncated = (total !== undefined && positions.length < total) || stopNote !== undefined;
  return {
    ok: true as const,
    source: SOURCE,
    scope: opts.scope,
    total: total ?? positions.length,
    fetched: positions.length,
    truncated,
    ...(stopNote ? { note: stopNote } : {}),
    positions,
  };
}

// ---------- fetchPositionDetail (per-id endpoint) ----------

interface RawDetailRecruitType {
  id?: string;
  name?: string;
  parent?: { id?: string; name?: string } | null;
}

interface RawJobPostDetail {
  id?: string;
  title?: string;
  description?: string;
  requirement?: string;
  city_list?: Array<{ code?: string; name?: string; en_name?: string }>;
  recruit_type?: RawDetailRecruitType | null;
}

interface RawDetailEnvelope {
  code?: number;
  message?: string;
  data?: { job_post_detail?: RawJobPostDetail } | null;
}

function detailHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "portal-channel": SOCIAL_CHANNEL,
    "portal-platform": "pc",
    "website-path": SOCIAL_CHANNEL,
    Referer: `https://${HOST}/${SOCIAL_CHANNEL}/position`,
  };
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };

  const url = `https://${HOST}/api/v1/job/posts/${encodeURIComponent(id)}?portal_type=3`;
  let payload: RawDetailEnvelope | undefined;
  let transportError: string | undefined;

  // One retry with backoff for transient WAF 405s / network hiccups.
  for (let attempt = 0; attempt < 2 && payload === undefined; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const response = await fetch(url, { headers: detailHeaders() });
      if (!response.ok) {
        transportError = `HTTP ${response.status}: ${response.statusText}`;
        continue;
      }
      payload = (await response.json()) as RawDetailEnvelope;
    } catch (err) {
      transportError = `network error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (payload === undefined || payload.code !== 0) {
    // Transport-level failure or upstream error → fall back to the factory's
    // paged-search sweep (covers the "index" and "campus" channels).
    const fallback = await adapter.fetchPositionDetail(id);
    if (fallback.ok) return fallback;
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message:
        payload === undefined
          ? (transportError ?? "detail endpoint unreachable")
          : (payload.message ?? "upstream error"),
    };
  }

  const d = payload.data?.job_post_detail;
  if (!d) {
    // code:0 with no job_post_detail is the endpoint's clean "no such post"
    // signal (it returns recommend_job_post_List instead).
    return {
      ok: false as const,
      source: SOURCE,
      post_id: id,
      message: `post ${id} not found on ${HOST} (job may have been closed)`,
    };
  }

  // recruit_type.parent.id "2" = 校招 → canonical campus portal URL.
  const isCampus =
    d.recruit_type?.parent?.id === "2" || d.recruit_type?.parent?.name === "校招";
  const channel = isCampus ? CAMPUS_CHANNEL : SOCIAL_CHANNEL;

  return {
    ok: true as const,
    source: SOURCE,
    post_id: id,
    title: d.title ?? "",
    direction: "",
    recruit_label: [d.recruit_type?.parent?.name, d.recruit_type?.name].filter(Boolean).join(" / "),
    description: d.description ?? "",
    requirements: d.requirement ?? "",
    work_cities: d.city_list ?? [],
    apply_url: `https://${HOST}/${channel}/position/${encodeURIComponent(id)}/detail`,
  };
}

export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
