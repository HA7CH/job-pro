// 银河通用 / Galaxy Universal (Galbot — embodied AI robotics) — stub for `job-pro`.
//
// STATUS: stub-only. Galaxy Universal lists careers via Moka social-recruitment
// (orgId 165930, slug yinhetongyong), which is auth-gated for anonymous access.
// Probe results:
//   www.galbot.com/careers, galaxyuniversal.com/careers → no public API discoverable
//   app.mokahr.com/social-recruitment/yinhetongyong/165930  → Moka SPA, session auth required

import { extractResumeSignals, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "galbot.com";
const STUB_MESSAGE =
  "Galaxy Universal / 银河通用: no public job API — Moka social-recruitment portal " +
  "(yinhetongyong/165930) requires session auth (verified Moka anon path is gated).";

export interface PositionSummary {
  post_id: string; title: string; project: string; recruit_label: string;
  bgs: string; work_cities: string; apply_url: string;
}
export interface SearchOptions { keyword?: string; page?: number; pageSize?: number; }

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
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, notices: [] };
}
export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, notice_id: noticeId };
}
export async function findNoticesByQuestion(question: string, _opts: { questionTime?: string; topK?: number } = {}) {
  return { ok: false as const, source: SOURCE, question, message: STUB_MESSAGE, matches: [] };
}
export async function matchResume(text: string, _opts: { topN?: number; candidates?: number } = {}) {
  const { terms, cities } = extractResumeSignals(text ?? "");
  return { ok: false as const, source: SOURCE, extracted_terms: terms, city_preferences: cities, matches: [] as PositionSummary[], message: STUB_MESSAGE };
}
