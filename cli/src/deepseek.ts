// DeepSeek (深度求索) — stub adapter for `job-pro`.
//
// STATUS: stub-only. DeepSeek is part of High-Flyer (幻方量化) and lists
// careers via the parent company on Moka social-recruitment. Probe results:
//   www.deepseek.com/careers       → 200 HTML, no inline job data / API path
//   careers.deepseek.com           → DNS resolves but TLS rejects from non-CN IPs
//   app.mokahr.com/social-recruitment/high-flyer/140576/  → Moka SPA, auth-gated
// Moka public anonymous API is gated (confirmed; see Moka probe in repo
// history). When DeepSeek opens a public JSON endpoint we rewrite in one pass.

import { extractResumeSignals, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "www.deepseek.com";
const STUB_MESSAGE =
  "DeepSeek: no public job API — careers route through Moka social-recruitment " +
  "(high-flyer/140576), which requires session auth. corporate careers page is HTML only.";

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
