// Canonical contract every company adapter must satisfy.
//
// Previously the dispatcher leaned on `type CompanyAdapter = typeof tencent`
// plus `as unknown as CompanyAdapter` casts on every entry in the ADAPTERS
// map. That silenced every shape mismatch — if an adapter's return value
// drifted, TypeScript was happy and the bug surfaced at runtime.
//
// This module defines an explicit method-signature interface so adapters
// can be wired with `satisfies Record<string, CompanyAdapter>` and any
// future drift becomes a compile error.
//
// The result types are intentionally permissive (`Promise<unknown>`-shaped):
// adapter-specific success payloads have rich, per-company keys (Tencent has
// recruitment fields Feishu doesn't, etc.) that we don't want to flatten here.
// The contract is "this method exists and is async"; the per-company JSON
// shape is documented in each adapter's source.

import type { PositionSummary as TencentPositionSummary } from "./tencent.js";

/** Canonical position summary keys shared across every adapter. */
export type PositionSummary = TencentPositionSummary;

/**
 * One canonical scope name across the entire CLI surface (1.1.0+).
 *
 * The CLI `--scope` flag is parsed into this enum and passed straight into
 * each adapter's `searchPositions` / `fetchAllPositions` options bag. Each
 * adapter translates it to its own upstream channel / recruitType / jobType
 * / workType / zpType / seasonType key — `scope` is the UBIQUITOUS NAME on
 * the dispatcher side, the per-adapter shape is private.
 *
 * `undefined` (caller omitted `--scope`) is NOT the same as `"all"` — the
 * former means "use the adapter's historical default" (preserves 1.0.93
 * behaviour bit-for-bit); the latter means "explicitly fetch every channel
 * and merge". Adapters MUST distinguish these two cases.
 */
export type PositionScope = "social" | "campus" | "intern" | "all";

/** Permissive options bag — adapters validate their own keys. */
export interface AdapterSearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /**
   * Caller-requested recruit scope (1.1.0+). Adapters translate to their
   * upstream channel/recruitType/jobType/workType key. `undefined` =
   * adapter's historical default (preserves 1.0.93 behaviour).
   */
  scope?: PositionScope;
  [extra: string]: unknown;
}

export interface AdapterAllOptions extends AdapterSearchOptions {
  maxPages?: number;
}

export interface AdapterMatchOptions {
  topN?: number;
  candidates?: number;
}

export interface AdapterFlowOptions {
  questionTime?: string;
  topK?: number;
}

/**
 * The eight async verbs the dispatcher routes against, plus the synchronous
 * `checkResume`. Every adapter — full or stub — must implement all of them.
 *
 * Returns are deliberately wide: `unknown`-shaped success payloads vary by
 * upstream. The contract enforced here is "method exists with this signature".
 */
export interface CompanyAdapter {
  /**
   * Scopes this adapter can actually query (1.1.0+). Optional for backward
   * compatibility — `undefined` means "I accept all four" (`social`,
   * `campus`, `intern`, `all`). The dispatcher uses this to fail fast with
   * a useful message when a caller asks for `--scope <x>` and the adapter
   * has structurally no such channel (e.g. Greenhouse boards are 100%
   * social by convention; Tencent has no public social-hire API).
   */
  readonly supportedScopes?: ReadonlyArray<PositionScope>;
  searchPositions(opts?: AdapterSearchOptions): Promise<unknown>;
  fetchAllPositions(opts?: AdapterAllOptions): Promise<unknown>;
  fetchPositionDetail(postId: string): Promise<unknown>;
  fetchDictionaries(): Promise<unknown>;
  listNotices(): Promise<unknown>;
  getNotice(noticeId: string): Promise<unknown>;
  findNoticesByQuestion(question: string, opts?: AdapterFlowOptions): Promise<unknown>;
  matchResume(text: string, opts?: AdapterMatchOptions): Promise<unknown>;
  checkResume(text: string): unknown;
  /**
   * Phase 2 — return the application-form schema (questions, submit endpoint).
   * Optional: only Greenhouse + Lever boards implement it today; the rest
   * surface "Phase 2 not yet wired" via the default dispatcher path.
   */
  fetchApplicationSchema?(postId: string): Promise<unknown>;
}
