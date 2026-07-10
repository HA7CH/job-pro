// 文远知行 (WeRide) careers — dual source: Moka China portals (primary) +
// Lever global board.
//
// ============================================================
// Discovery notes:
//
//   The 2026-05 probe wrongly concluded "weride.app.mokahr.com — no Moka
//   tenant": it probed the slug `weride`. WeRide's Moka org slug is its
//   original company name 景驰 → `jingchi` (re-probed 2026-07-11):
//
//     social  https://app.mokahr.com/apply/jingchi/2138
//             (byte-identical portal is also served at
//              /social-recruitment/jingchi/2138 — verified 2026-07-11: same
//              102954-byte HTML with the same SSR init-data — so the moka.ts
//              factory's canonical "social-recruitment" kind works as-is)
//     campus  https://app.mokahr.com/campus_apply/jingchi/2137
//
//   jobs/v2 probed 2026-07-11: social total=235 (keyword 工程师→150, 算法→45),
//   campus total=139 (工程师→88, 算法→41). Server-side `keyword` + real
//   limit/offset pagination via the shared moka.ts factory.
//
//   Lever board (global / US arm): https://api.lever.co/v0/postings/weride
//   31 postings (probed 2026-07-11), 4 with team="Campus Recruiting"
//   ("New Grads 2026" ×3 + "2026 Summer Intern - PhD").
//
// Merge semantics (Moka-primary):
//   --scope social (default)  Moka social (2138)  + Lever non-campus postings
//   --scope campus            Moka campus (2137)  + Lever "Campus Recruiting"
//   --scope all               Moka both channels  + full Lever board
//
// `search` pages through the Moka side first (server-side keyword + offset)
// and fills the page tail from the Lever board (fetched whole — 31 rows,
// bounded enumeration; Lever has no server-side keyword parameter, its
// factory filters the full board client-side). `total` is Moka's
// server-reported total plus the Lever filtered count. `all` sweeps both
// sources exhaustively and dedupes by post_id.
//
// Both ATSes use UUID post_ids, so `detail` cannot route on id shape — it
// probes both sources in parallel and returns whichever hits.

import { createAdapter as createMokaAdapter } from "./moka.js";
import type { PositionSummary } from "./moka.js";
import { createAdapter as createLeverAdapter } from "./lever.js";
import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { PositionScope } from "./adapter.js";

export { checkResume };

const SOURCE = "app.mokahr.com/jingchi + api.lever.co/weride";

const moka = createMokaAdapter({
  orgSlug: "jingchi",
  label: "WeRide",
  channels: [
    { siteId: 2138, kind: "social-recruitment", recruitType: "social" },
    { siteId: 2137, kind: "campus_apply", recruitType: "campus" },
  ],
  defaultScope: "social",
});

const lever = createLeverAdapter({ slug: "weride", label: "WeRide" });

export const supportedScopes: ReadonlyArray<PositionScope> = [
  "social",
  "campus",
  "all",
] as const;

// Moka rejects limit > 50 (code 102), and the merged page math assumes one
// consistent page size across both sources — clamp like the factory does.
function clampPageSize(n: number): number {
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

/**
 * Lever board campus test. Lever tags its campus postings with
 * team="Campus Recruiting" (probed 2026-07-11: "New Grads 2026" ×3 +
 * "2026 Summer Intern - PhD", the only Intern-commitment row, sits in that
 * team too). `project` carries the Lever team in the canonical summary.
 */
function isLeverCampus(p: PositionSummary): boolean {
  return /campus/i.test(p.project) || /intern/i.test(p.recruit_label);
}

/**
 * Fetch the whole Lever board (31 rows, one cached GET — Lever has no
 * pagination or server-side keyword) already keyword-filtered by the lever
 * factory, then partition by scope.
 */
async function leverPool(
  scope: PositionScope | undefined,
  keyword: string
): Promise<
  | { ok: true; positions: PositionSummary[] }
  | { ok: false; message: string; positions: PositionSummary[] }
> {
  const r = await lever.fetchAllPositions({ keyword });
  if (!r.ok) return { ok: false, message: r.message, positions: [] };
  const want = scope ?? "social";
  const positions = r.positions.filter((p) =>
    want === "all" ? true : want === "campus" ? isLeverCampus(p) : !isLeverCampus(p)
  );
  return { ok: true, positions };
}

interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  scope?: PositionScope;
}

export async function searchPositions(opts: SearchOptions = {}) {
  const scope = opts.scope; // undefined = adapter default (social view)
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = clampPageSize(opts.pageSize ?? 20);
  const keyword = (opts.keyword ?? "").trim();
  const query = { keyword, page, pageSize, scope: scope ?? "social" };

  const [mokaRes, leverRes] = await Promise.all([
    moka.searchPositions({ keyword, page, pageSize, scope: scope ?? "social" }),
    leverPool(scope, keyword),
  ]);

  const warnings: string[] = [];
  if (!mokaRes.ok) warnings.push(`moka (jingchi) failed: ${mokaRes.message}`);
  if (!leverRes.ok) warnings.push(`lever (weride) failed: ${leverRes.message}`);
  if (!mokaRes.ok && !leverRes.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `all sources failed: ${warnings.join("; ")}`,
      query,
      positions: [] as PositionSummary[],
      total: 0,
    };
  }

  // Global ordering: Moka positions first (indices 0..mokaTotal-1), then the
  // Lever pool. A page starts at globalOffset; whatever the Moka page didn't
  // cover is filled from the Lever list at the corresponding index, so Lever
  // rows surface on the pages after the Moka side is exhausted instead of
  // being sliced away.
  const mokaTotal = mokaRes.ok ? mokaRes.total ?? 0 : 0;
  const mokaPage: PositionSummary[] = mokaRes.ok ? mokaRes.positions : [];
  const seen = new Set<string>();
  const positions: PositionSummary[] = [];
  for (const p of mokaPage) {
    if (seen.has(p.post_id)) continue;
    seen.add(p.post_id);
    positions.push(p);
  }
  const globalOffset = (page - 1) * pageSize;
  if (leverRes.ok && positions.length < pageSize) {
    const leverOffset = Math.max(0, globalOffset + positions.length - mokaTotal);
    for (const p of leverRes.positions.slice(
      leverOffset,
      leverOffset + (pageSize - positions.length)
    )) {
      if (seen.has(p.post_id)) continue;
      seen.add(p.post_id);
      positions.push(p);
    }
  }

  const total = mokaTotal + (leverRes.ok ? leverRes.positions.length : 0);
  return {
    ok: true as const,
    source: SOURCE,
    query,
    page,
    page_size: pageSize,
    total,
    totals: {
      moka: mokaRes.ok ? mokaTotal : null,
      lever: leverRes.ok ? leverRes.positions.length : null,
    },
    positions,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function fetchAllPositions(
  opts: SearchOptions & { maxPages?: number } = {}
) {
  const scope = opts.scope;
  const keyword = (opts.keyword ?? "").trim();

  const [mokaRes, leverRes] = await Promise.all([
    moka.fetchAllPositions({
      keyword,
      // Sweep at Moka's max page size so 235 social + 139 campus rows fit
      // well inside the default 50-page budget.
      pageSize: clampPageSize(opts.pageSize ?? 50),
      maxPages: opts.maxPages,
      scope: scope ?? "social",
    }),
    leverPool(scope, keyword),
  ]);

  const warnings: string[] = [];
  if (!mokaRes.ok) warnings.push(`moka (jingchi) failed: ${mokaRes.message}`);
  if (!leverRes.ok) warnings.push(`lever (weride) failed: ${leverRes.message}`);
  if (!mokaRes.ok && !leverRes.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `all sources failed: ${warnings.join("; ")}`,
      total: 0,
      fetched: 0,
      positions: [] as PositionSummary[],
    };
  }

  const seen = new Set<string>();
  const positions: PositionSummary[] = [];
  const pools = [
    ...(mokaRes.ok ? mokaRes.positions : []),
    ...(leverRes.ok ? leverRes.positions : []),
  ];
  for (const p of pools) {
    if (seen.has(p.post_id)) continue;
    seen.add(p.post_id);
    positions.push(p);
  }
  const total =
    (mokaRes.ok ? mokaRes.total ?? 0 : 0) +
    (leverRes.ok ? leverRes.positions.length : 0);
  return {
    ok: true as const,
    source: SOURCE,
    total,
    fetched: positions.length,
    positions,
    ...(positions.length < total ? { truncated: true } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function fetchPositionDetail(postId: string) {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false as const, source: SOURCE, message: "post_id is required" };
  // Moka jingchi and Lever both mint UUID job ids (verified 2026-07-11), so
  // there is no shape to route on — probe both in parallel, prefer Moka.
  const [m, l] = await Promise.all([
    moka.fetchPositionDetail(id),
    lever.fetchPositionDetail(id),
  ]);
  if (m.ok) return m;
  if (l.ok) return l;
  return {
    ok: false as const,
    source: SOURCE,
    post_id: id,
    message: `job not found in either source — moka (jingchi): ${m.message}; lever (weride): ${l.message}`,
  };
}

export async function fetchDictionaries() {
  const [m, l] = await Promise.all([moka.fetchDictionaries(), lever.fetchDictionaries()]);
  if (!m.ok && !l.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      message: `all sources failed — moka: ${m.message}; lever: ${l.message}`,
    };
  }
  return { ok: true as const, source: SOURCE, moka: m, lever: l };
}

// Neither Moka tenants nor Lever boards expose an announcements endpoint —
// delegate to the Moka factory's clean stubs.
export const listNotices = moka.listNotices;
export const getNotice = moka.getNotice;
export const findNoticesByQuestion = moka.findNoticesByQuestion;

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  // Sweep every channel (moka social+campus + lever) so ranking sees the
  // whole 235+139+31 board; 50-row pages keep that under 10 requests.
  const all = await fetchAllPositions({ scope: "all", pageSize: 50 });
  if (!all.ok) {
    return {
      ok: false as const,
      source: SOURCE,
      extracted_terms: terms,
      city_preferences: cities,
      matches: [] as PositionSummary[],
      message: all.message,
    };
  }
  const topN = Math.max(1, opts.topN ?? 10);
  const scored = all.positions
    .map((p) => ({
      p,
      score: scoreOverlap(`${p.title} ${p.project} ${p.bgs}`, terms, cities).score,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.p);
  return {
    ok: true as const,
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    matches: scored,
  };
}
