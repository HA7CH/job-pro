// 科大讯飞 (iFlytek) — stub adapter for `job-pro`.
//
// STATUS: stub-only. The public careers portal exists but the underlying
// recruitment API is gated behind a 301 redirect chain into Beisen's iTalent
// ATS (italent.cn), which requires a logged-in candidate session before any
// position JSON is returned.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   www.iflytek.com/careers          — corporate page only, no listings JSON
//   campus.iflytek.com               — 301 redirect to Tengine origin which
//                                      issues a second 301 to the italent
//                                      candidate-portal sign-in form (the
//                                      favicon path is /italent.ico, which
//                                      confirms the Beisen / 北森 backend).
//   career.iflytek.com               — 301 chain into the same iTalent portal
//   hr.iflytek.com                   — 301 chain, gated
//
//   Feishu ATSX tenants probed:
//     iflytek.jobs.feishu.cn          — HTTP 400 empty body (no tenant)
//
//   Moka:
//     app.mokahr.com/social-recruitment/iflytek  — page shell renders but
//       the per-slug job feed returns the Moka SPA error page.
//
// Conclusion: iFlytek publishes positions through the Beisen iTalent portal,
// whose JSON endpoints require an authenticated candidate session. There is
// no unauthenticated public REST surface as of probe date. When upstream
// exposes one, this adapter can be upgraded to a thin client.
//
// ============================================================
// PositionSummary field mapping (canonical):
//   post_id, title, project, recruit_label, bgs, work_cities, apply_url

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "campus.iflytek.com";
const STUB_MESSAGE =
  "iFlytek (科大讯飞): careers portal is fronted by Beisen iTalent (italent.cn) " +
  "which gates all job-list JSON behind an authenticated candidate session. " +
  "No unauthenticated public API available. Visit https://campus.iflytek.com/ for the portal.";

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
