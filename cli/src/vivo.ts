// vivo — stub adapter for `job-pro`.
//
// STATUS: stub-only. vivo's careers portal at hr.vivo.com is a Vite SPA
// hosted on the company's internal BPM platform (it-static.vivo.xyz). The
// job-list endpoints under /wt/vivo/web/* exist but reject every unauthenticated
// POST with HTTP 405 (Method Not Allowed at the nginx layer), and GETs return
// the SPA shell instead of JSON. The platform requires browser-issued
// vmonitor / vui-tracking tokens to be added by the bundle before the API
// gateway will route the request.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://hr.vivo.com/                       — Vite SPA, /assets/index.*.js
//   POST https://hr.vivo.com/wt/vivo/web/queryJobsList — HTTP 405 (nginx)
//   POST https://hr.vivo.com/wt/vivo/web/list         — HTTP 405 (nginx)
//   GET  https://hr.vivo.com/wt/vivo/web/index?type=1 — returns SPA HTML
//
//   The page initializer pulls vmonitor.min.js and vui-tracking/index.js
//   from it-static.vivo.xyz before any API call is made; these libraries
//   are expected to inject runtime headers (suspected MD5-signed timestamp
//   + UID) that the gateway validates.
//
//   Feishu ATSX:
//     vivo.jobs.feishu.cn — HTTP 400 (no portal configured)
//
//   Moka:
//     app.mokahr.com/social-recruitment/vivo — 302 (slug not provisioned)
//
// Conclusion: no unauthenticated public job-list API is available. Visit
// https://hr.vivo.com/ for the official portal.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "hr.vivo.com";
const STUB_MESSAGE =
  "vivo: hr.vivo.com /wt/vivo/web/* endpoints reject anonymous requests with HTTP 405 (nginx). " +
  "API gateway requires browser-runtime tokens injected by vmonitor + vui-tracking bundles. " +
  "No unauthenticated public API available. Visit https://hr.vivo.com/ for the portal.";

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
