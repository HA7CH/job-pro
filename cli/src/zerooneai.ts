// 01.AI / 零一万物 — stub adapter for `job-pro`.
//
// STATUS: stub-only. 01.AI (Kai-Fu Lee's AI lab) lists careers via a SPA
// without a public anonymous JSON endpoint discoverable from outside CN.
// Probe results:
//   www.01.ai/careers / 01.ai/careers → 200 HTML SPA, no inline data
//   01ai.jobs.feishu.cn, lingyiwanwu.jobs.feishu.cn → no real Feishu tenant
// When 01.AI opens a public API we rewrite this in one pass.

import { extractResumeSignals, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "www.01.ai";
const STUB_MESSAGE =
  "01.AI / 零一万物: no public job API discovered. Corporate careers page is SPA " +
  "with no embedded job data; no Feishu/Moka tenant resolves anonymously.";

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
