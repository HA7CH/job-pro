// 吉利汽车 (Geely Auto) — stub adapter for `job-pro`.
//
// STATUS: stub-only. The careers domains do not resolve over public DNS,
// and the third-party ATS slugs (Greenhouse, Lever, Feishu, Moka) all return
// 404 or are unprovisioned. Public-facing recruiting appears to run only
// through WeChat / official-account channels.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://career.geely.com             — 000 (no public DNS / unreachable)
//   https://join.geely.com               — 000 (no public DNS)
//   https://hr.geely.com                 — 000 (no public DNS)
//
//   Feishu ATSX:    geely.jobs.feishu.cn — HTTP 400 (no portal)
//                   zeekr.jobs.feishu.cn — HTTP 400 (no portal)
//   Greenhouse:     geely / zeekr        — HTTP 404 (no board)
//   Lever:          geely / zeekr        — HTTP 404 (no posting)
//   Moka:           app.mokahr.com/social-recruitment/geely → 302 (slug unprovisioned)
//
// Conclusion: Geely's recruiting flow is gated behind WeChat / official-account
// channels and a non-public corporate ATS. No public unauthenticated API
// available. Visit Geely's official WeChat 吉利汽车招聘 for postings.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "geely.com";
const STUB_MESSAGE =
  "Geely (吉利汽车): careers subdomains (career / join / hr.geely.com) fail to resolve over public DNS, " +
  "and no Greenhouse / Lever / Feishu / Moka tenant is provisioned. Recruiting runs through WeChat " +
  "official-account channels. No unauthenticated public API available.";

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
