// 地平线 (Horizon Robotics) — stub adapter for `job-pro`.
//
// STATUS: stub-only. Horizon's careers portal is hosted on Moka and gated
// behind the Moka SPA's login flow; the per-slug JSON endpoint returns the
// "您访问的页面不存在" Moka error page for anonymous requests.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://career.horizon.ai             — 000 (no public DNS / unreachable)
//   https://campus.horizon.ai             — 000 (no public DNS / unreachable)
//   https://horizon.app.mokahr.com        — Moka SPA shell renders, but
//     /api/career/website/horizon/jobs returns {"code":-1,"message":"您访问的页面不存在"}
//
//   Feishu ATSX:    horizonrobotics.jobs.feishu.cn — HTTP 405 (DNS but no portal)
//                   horizon.jobs.feishu.cn         — HTTP 405
//                   horizon-robotics.jobs.feishu.cn — HTTP 400 (no portal)
//   Greenhouse:     horizon / horizon-robotics    — HTTP 404
//   Lever:          horizonrobotics                — HTTP 404
//
//   The Moka portal exists (the slug 'horizonrobotics' returns 200 page
//   shell) but the underlying job-list endpoint requires the Moka SPA's
//   user-session JWT, which is only minted post-login.
//
// Conclusion: no unauthenticated public API. Visit Moka careers shell at
// https://app.mokahr.com/social-recruitment/horizonrobotics for the portal.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "app.mokahr.com/horizonrobotics";
const STUB_MESSAGE =
  "Horizon Robotics (地平线): Moka careers portal (slug horizonrobotics) is gated — the public " +
  "/api/career/website/horizon/jobs endpoint returns the Moka 'page not found' error for anonymous " +
  "requests; positions are visible only after a candidate session is established. No Greenhouse / Lever / " +
  "Feishu tenant provisioned. No unauthenticated public API available.";

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
