// 顺丰 (SF Express) campus recruiting — stub adapter for `job-pro`.
//
// STATUS: stub-only. The campus portal lives at campus.sf-express.com but
// the JSON job-list endpoint is gated behind a Spring Security 401 for any
// request lacking a logged-in user session bound to a GeeTest v4 captcha token.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://campus.sf-express.com/        — Vue SPA, /cr/static/js/app.*.js
//                                            ships GeeTest gt4.js for captcha.
//   POST https://campus.sf-express.com/api/zp/jobList →
//     {"timestamp":...,"status":401,"error":"Unauthorized","path":"/zp/jobList"}
//     (Spring Security returns 401 immediately when no session JWT is present.)
//   GET  https://campus.sf-express.com/cr/api/zp/jobList → openresty 404
//
//   The SPA acquires its session by completing a GeeTest captcha after the
//   user clicks "查看职位" on the entry page; only then is the bearer token
//   injected into subsequent /api/zp/* requests.
//
//   Feishu ATSX:  sf.jobs.feishu.cn — HTTP 400 (no portal configured)
//   Moka:         app.mokahr.com/social-recruitment/sf → 200 page shell but
//                  per-slug feed returns "您访问的页面不存在".
//
// Conclusion: no unauthenticated public API. Visit
// https://campus.sf-express.com/ for the official campus portal.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "campus.sf-express.com";
const STUB_MESSAGE =
  "SF Express (顺丰): campus.sf-express.com /api/zp/jobList returns HTTP 401 (Spring Security) " +
  "for unauthenticated requests. Session JWT is only issued after a GeeTest v4 captcha is completed " +
  "in-browser. No unauthenticated public API available. Visit https://campus.sf-express.com/ for the portal.";

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
