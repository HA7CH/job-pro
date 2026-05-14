// 菜鸟 (Cainiao Network) — stub adapter for `job-pro`.
//
// STATUS: stub-only. Both campus and social recruiting are routed through
// Alibaba's unified careers infrastructure, which is hosted on subdomains
// that fail to resolve over public DNS (likely group-network-only A records).
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://campus.cainiao.com           — 000 (no public DNS / unreachable)
//   https://recruit.cainiao.com          — 000 (no public DNS / unreachable)
//   https://job.cainiao.com              — 000 (no public DNS / unreachable)
//
//   The corporate careers blurb on www.cainiao.com links out to
//   "campus-talent.alibaba.com" (already covered by the `alibaba` adapter),
//   suggesting cainiao postings are merged into the Alibaba Group careers feed
//   when they go public. The dedicated Cainiao SPA is internal-only.
//
//   Feishu ATSX:  cainiao.jobs.feishu.cn — HTTP 400 (no portal configured)
//   Greenhouse / Lever / Moka: no `cainiao` slug found on any of them.
//
// Conclusion: no unauthenticated public API outside of the Alibaba Group
// feed. Use `job-pro alibaba search "菜鸟"` to surface group-listed roles, or
// visit https://www.cainiao.com/ for direct contact info.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "cainiao.com";
const STUB_MESSAGE =
  "Cainiao (菜鸟): dedicated careers subdomains (campus / recruit / job.cainiao.com) fail to resolve " +
  "over public DNS. Public-facing roles are surfaced through the Alibaba Group careers feed " +
  "(use `job-pro alibaba search \"菜鸟\"`). No standalone unauthenticated public API.";

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
}

export async function searchPositions(_opts: SearchOptions = {}) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, query: {}, positions: [] as PositionSummary[] };
}

export async function fetchAllPositions(_opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, total: 0, fetched: 0, positions: [] as PositionSummary[] };
}

export async function fetchPositionDetail(postId: string) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, post_id: postId };
}

export async function fetchDictionaries() {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE };
}

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, notices: [] as never[] };
}

export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, notice_id: noticeId };
}

export async function findNoticesByQuestion(question: string, _opts: { questionTime?: string; topK?: number } = {}) {
  return { ok: false as const, source: SOURCE, question, message: STUB_MESSAGE, matches: [] as never[] };
}

export async function matchResume(text: string, _opts: { topN?: number; candidates?: number } = {}) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  return {
    ok: false as const,
    source: SOURCE,
    extracted_terms: terms,
    city_preferences: cities,
    matches: [] as PositionSummary[],
    message: STUB_MESSAGE,
  };
}

export { extractResumeSignals, scoreOverlap };
