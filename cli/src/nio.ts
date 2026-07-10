// Thin adapter for NIO / 蔚来 recruiting via Feishu Recruiting (ATSX).
//
// NIO self-hosts the Feishu Recruiting platform at:
//   https://nio.jobs.feishu.cn/
//
// Two portals live on the same host (re-probed 2026-07-11 with curl):
//
//   ROOT portal  (社会招聘)  portal-channel: ""        → 2428 posts, all
//       recruit_type.parent == 社招; keyword 工程师 → 360. The bare domain
//       https://nio.jobs.feishu.cn/ IS the social-hire portal — page title
//       reads「社会招聘」, and the API accepts empty portal-channel /
//       website-path headers exactly like hr.sensetime.com's main site.
//   CAMPUS portal (校园招聘) portal-channel: "campus"  → 431 posts
//       (2 正式 via recruitment_id_list ["201"], 429 实习 via ["202"];
//        keyword 工程师 → 94).
//
// API:
//   POST https://nio.jobs.feishu.cn/api/v1/search/job/posts
//   GET  https://nio.jobs.feishu.cn/api/v1/config/job/filters/<channel>
//
// Stale-probe correction (2026-07-11): the 2026-05-20 note claiming every
// social probe returned HTTP 405 is obsolete. Named channel slugs are still
// dead — `portal-channel: society` returns code -9000003 "site not exist"
// today — but the EMPTY channel ("") works: HTTP 200 / code 0 / count 2428.
// recruitment_id_list ["101"] on the campus channel returns count 0, so the
// factory's rid-101 fallback would silently miss everything; the dedicated
// `socialChannel: ""` route below is required.
//
// Field notes:
//   - job_category is null; project ← job_function.name
//   - city_info is null; work_cities ← city_list
//
// apply_url pattern: https://nio.jobs.feishu.cn/campus/position/<id>/detail
//   Verified 2026-07-11: the /campus/position/<id>/detail page server-renders
//   the correct <title> even for ROOT-portal (social) post ids, while the
//   root-path /position/<id>/detail returns HTTP 404 — so the campus prefix
//   is the correct canonical detail URL for BOTH channels.

import { createAdapter } from "./feishu.js";
import type { SearchOptions, PositionSummary } from "./feishu.js";
import type { PositionScope } from "./adapter.js";

/**
 * All four scopes supported (1.2.0):
 *   social → root portal ("" channel, 2428 posts as of 2026-07-11)
 *   campus → campus channel + recruitment_id_list ["201"] (正式校招)
 *   intern → campus channel + recruitment_id_list ["202"] (实习)
 *   all    → BOTH portals fan-out + merge (per adapter.ts canon: `"all"`
 *            means "explicitly fetch every channel and merge"; implemented
 *            in the wrappers below because the generic Feishu factory maps
 *            `all` to the single default channel only)
 *   undefined (no --scope) → campus channel, no recruit filter — the
 *            adapter's historical 1.0.x default, unchanged.
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

const SOURCE = "nio.jobs.feishu.cn";

const adapter = createAdapter({
  host: SOURCE,
  channel: "campus",
  // Root portal (empty channel) is NIO's official 社会招聘 site.
  // Tested 2026-07-11: portal-channel "" → count 2428 (all 社招);
  // "society" / "social" / "experienced" slugs → -9000003 "site not exist".
  socialChannel: "",
  label: "NIO / 蔚来",
  applyUrlPrefix: "https://nio.jobs.feishu.cn/campus/position",
  supportedScopes,
});

export const {
  fetchPositionDetail,
  fetchDictionaries,
  listNotices,
  getNotice,
  findNoticesByQuestion,
  matchResume,
  checkResume,
} = adapter;

/** The two independent portals `scope === "all"` must cover. `undefined`
 *  keeps the factory on the historical default (campus, no recruit filter);
 *  `"social"` swaps to the root portal. */
const ALL_CHANNEL_SCOPES: ReadonlyArray<PositionScope | undefined> = [undefined, "social"];

/**
 * searchPositions with canonical `scope === "all"` semantics.
 *
 * The generic Feishu factory maps `all` to the default channel only, which
 * on this two-portal tenant would silently drop the 2428-post social feed.
 * Mirror the Moka factory precedent: fetch the same page from every channel
 * in parallel, merge, dedupe by post_id, sum totals, slice to pageSize.
 */
export async function searchPositions(opts: SearchOptions = {}) {
  if (opts.scope !== "all") return adapter.searchPositions(opts);

  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20));
  const page = Math.max(1, opts.page ?? 1);
  const results = await Promise.all(
    ALL_CHANNEL_SCOPES.map((scope) => adapter.searchPositions({ ...opts, scope }))
  );

  const merged: PositionSummary[] = [];
  const seen = new Set<string>();
  let totalSum = 0;
  const errors: string[] = [];
  for (const r of results) {
    if (!r.ok) {
      errors.push(r.message ?? "upstream error");
      continue;
    }
    totalSum += r.total ?? 0;
    for (const p of r.positions) {
      if (p.post_id && seen.has(p.post_id)) continue;
      if (p.post_id) seen.add(p.post_id);
      merged.push(p);
    }
  }
  if (merged.length === 0 && errors.length === results.length) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `all channels failed: ${errors.join("; ")}`,
      query: { scope: "all", keyword: opts.keyword ?? "", page, pageSize },
      positions: [] as PositionSummary[],
      total: 0,
    };
  }
  return {
    ok: true as const,
    source: SOURCE,
    query: { scope: "all", keyword: opts.keyword ?? "", page, pageSize },
    scope: opts.scope,
    page,
    page_size: pageSize,
    total: totalSum,
    positions: merged.slice(0, pageSize),
  };
}

/**
 * `all`-verb pagination wrapper over the factory's searchPositions.
 *
 * The generic Feishu factory caps fetchAllPositions at 5 pages, which
 * truncated NIO silently (audit: `all --page-size 50` fetched 250/431) and
 * could never exhaust the 2428-post social channel. This wrapper:
 *   - defaults maxPages to 50 (100/page × 50 = 5000 ≥ 2428 social posts);
 *   - dedupes by post_id and stops when a page adds nothing new, so an
 *     upstream that ignores `offset` can't loop us over duplicates;
 *   - stops on short page or when `total` is reached;
 *   - reports `truncated: true` whenever it stops early with fetched < total;
 *   - for `scope === "all"`, sweeps BOTH portals and merges (canonical
 *     dispatcher semantics; see supportedScopes doc above).
 */
export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  if (opts.scope !== "all") return fetchAllOneChannel(opts);

  const results: Array<Awaited<ReturnType<typeof fetchAllOneChannel>>> = [];
  // Sequential (not parallel) on purpose: each channel sweep is already up
  // to ~25 requests; interleaving two sweeps invites upstream rate limits.
  for (const scope of ALL_CHANNEL_SCOPES) {
    results.push(await fetchAllOneChannel({ ...opts, scope }));
  }

  const merged: PositionSummary[] = [];
  const seen = new Set<string>();
  let totalSum = 0;
  let truncated = false;
  const errors: string[] = [];
  for (const r of results) {
    if (!r.ok) {
      errors.push(r.message ?? "upstream error");
      continue;
    }
    totalSum += r.total ?? 0;
    if (r.truncated) truncated = true;
    for (const p of r.positions) {
      if (p.post_id && seen.has(p.post_id)) continue;
      if (p.post_id) seen.add(p.post_id);
      merged.push(p);
    }
  }
  if (merged.length === 0 && errors.length === results.length) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `all channels failed: ${errors.join("; ")}`,
      fetched: 0,
      positions: [] as PositionSummary[],
    };
  }
  // A failed channel means its posts are missing → the merged sweep is
  // incomplete even though the surviving channel finished.
  if (errors.length > 0) truncated = true;
  return {
    ok: true as const,
    source: SOURCE,
    total: totalSum,
    fetched: merged.length,
    ...(truncated ? { truncated: true as const } : {}),
    positions: merged,
  };
}

async function fetchAllOneChannel(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const maxPages = Math.max(1, opts.maxPages ?? 50);

  const seen = new Set<string>();
  const bucket: PositionSummary[] = [];
  let total: number | undefined;
  let exhausted = false;

  for (let page = 1; page <= maxPages; page++) {
    const result = await adapter.searchPositions({ ...opts, page, pageSize });
    if (!result.ok) {
      return {
        ok: false as const,
        message: result.message,
        source: SOURCE,
        fetched: bucket.length,
        truncated: undefined,
        positions: bucket,
      };
    }
    if (total === undefined) total = result.total;

    let added = 0;
    for (const p of result.positions) {
      if (p.post_id && seen.has(p.post_id)) continue;
      if (p.post_id) seen.add(p.post_id);
      bucket.push(p);
      added += 1;
    }

    // Short page → upstream has no more rows for this query.
    if (result.positions.length < pageSize) {
      exhausted = true;
      break;
    }
    // Full page but nothing new → upstream is looping us; treat as done
    // only if we already hold `total` rows, otherwise it's a truncation.
    if (added === 0) break;
    if (total !== undefined && bucket.length >= total) {
      exhausted = true;
      break;
    }
  }
  if (total !== undefined && bucket.length >= total) exhausted = true;

  const reportedTotal = total ?? bucket.length;
  return {
    ok: true as const,
    source: SOURCE,
    total: reportedTotal,
    fetched: bucket.length,
    truncated: exhausted ? undefined : (true as const),
    positions: bucket,
  };
}
