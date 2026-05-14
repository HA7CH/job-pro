// 寒武纪 (Cambricon) — stub adapter for `job-pro`.
//
// STATUS: stub-only. Cambricon's careers domains do not resolve over public
// DNS, and no third-party ATS tenant (Feishu, Moka, Greenhouse, Lever) is
// provisioned for the company. Recruiting runs through internal channels.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://hr.cambricon.com             — 000 (no public DNS / unreachable)
//   https://careers.cambricon.com        — 000 (no public DNS / unreachable)
//   https://campus.cambricon.com         — 000 (no public DNS / unreachable)
//
//   Feishu ATSX:  cambricon.jobs.feishu.cn — HTTP 400 (no portal)
//   Greenhouse:   cambricon                 — HTTP 404 (no board)
//   Lever:        cambricon                 — HTTP 404 (no posting)
//   Moka:         app.mokahr.com/social-recruitment/cambricon → 302 (unprovisioned)
//
//   Cambricon's official careers blurb on cambricon.com points to the
//   public WeChat 寒武纪招聘 official account, which posts openings as
//   articles and routes applications to internal HR contacts.
//
// Conclusion: no unauthenticated public API. Visit the 寒武纪招聘 WeChat
// official account, or send a resume to the careers email listed at
// https://www.cambricon.com/.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "cambricon.com";
const STUB_MESSAGE =
  "Cambricon (寒武纪): hr / careers / campus.cambricon.com all fail to resolve over public DNS. " +
  "No Greenhouse / Lever / Feishu / Moka tenant provisioned. Recruiting runs through the " +
  "WeChat 寒武纪招聘 official account. No unauthenticated public API available.";

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
