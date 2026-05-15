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

/** Permissive options bag — adapters validate their own keys. */
export interface AdapterSearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
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
  searchPositions(opts?: AdapterSearchOptions): Promise<unknown>;
  fetchAllPositions(opts?: AdapterAllOptions): Promise<unknown>;
  fetchPositionDetail(postId: string): Promise<unknown>;
  fetchDictionaries(): Promise<unknown>;
  listNotices(): Promise<unknown>;
  getNotice(noticeId: string): Promise<unknown>;
  findNoticesByQuestion(question: string, opts?: AdapterFlowOptions): Promise<unknown>;
  matchResume(text: string, opts?: AdapterMatchOptions): Promise<unknown>;
  checkResume(text: string): unknown;
}
