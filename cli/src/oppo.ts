// OPPO — stub adapter for `job-pro`.
//
// STATUS: stub-only. OPPO's careers portal exists at careers.oppo.com and
// exposes an `/api/job/list` endpoint, but every probed payload variation
// returns HTTP 500 from the upstream Spring Boot service, suggesting the
// route requires session-bound CSRF / fingerprint headers that the page's
// JS bundle injects only after the browser passes a runtime check.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://careers.oppo.com/                  — SPA shell (Vite, /assets/js/campus_oppo-*.js)
//   POST https://careers.oppo.com/api/job/list — HTTP 500 internal error
//     payload variants tried:
//       {} → 500
//       {"page":1,"pageSize":10} → 500
//       {"keyword":"","page":1,"pageSize":10,"recruitType":"campus"} → 500
//       {"keyword":"","jobLineCode":"","jobNature":"","cityCode":"","page":1,"pageSize":10,"locale":"zh-CN"} → 500
//     All return Spring-style {"timestamp":..,"status":500,"path":"/api/job/list"}.
//
//   Feishu ATSX tenants:
//     oppo.jobs.feishu.cn — HTTP 400 (no portal configured)
//
//   Moka:
//     app.mokahr.com/social-recruitment/oppo — Moka SPA shell renders but
//       per-slug job feed returns the "您访问的页面不存在" error page.
//
// Conclusion: OPPO publishes positions through their own bespoke Spring Boot
// API which requires browser-runtime headers (likely a CSRF + WAF cookie pair)
// before any 200 response is returned. No anonymous JSON path is currently
// reachable. Visit https://careers.oppo.com/ for the official portal.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "careers.oppo.com";
const STUB_MESSAGE =
  "OPPO: careers.oppo.com /api/job/list returns HTTP 500 for every anonymous payload " +
  "variant probed — the endpoint appears to require browser-runtime CSRF / WAF cookies. " +
  "No unauthenticated public API available. Visit https://careers.oppo.com/ for the portal.";

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
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    query: {},
    positions: [] as PositionSummary[],
  };
}

export async function fetchAllPositions(
  _opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}
) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    total: 0,
    fetched: 0,
    positions: [] as PositionSummary[],
  };
}

export async function fetchPositionDetail(postId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    post_id: postId,
  };
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

export async function findNoticesByQuestion(
  question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    source: SOURCE,
    question,
    message: STUB_MESSAGE,
    matches: [] as never[],
  };
}

export async function matchResume(
  text: string,
  _opts: { topN?: number; candidates?: number } = {}
) {
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
