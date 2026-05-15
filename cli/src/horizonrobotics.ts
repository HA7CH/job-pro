// 地平线 (Horizon Robotics) — stub adapter for `job-pro`.
//
// STATUS: stub-only.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   The earlier note in this file (Moka careers portal slug=horizonrobotics)
//   is INCORRECT. The current public Horizon homepage is www.horizon.auto,
//   and its "加入我们" links point to a Beisen wecruit (北森) ATS, NOT Moka:
//
//     https://wecruit.hotjob.cn/SU6409ef49bef57c635fd390a6/pb/interns.html
//     https://wecruit.hotjob.cn/SU6409ef49bef57c635fd390a6/pb/school.html
//     https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/custom.html
//     https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/social.html
//
//   The Beisen wecruit positionInfo/listPosition endpoint is the same
//   stack as SenseTime (see cli/src/sensetime.ts header for full details):
//   every POST to /positionInfo/listPosition/{channelId} (with or without
//   /pb/ prefix, with or without /SU{id}/ prefix) returns HTTP 405 from
//   the Nginx WAF unless a valid session cookie / JWT is attached, which
//   only comes from enterprise SSO (phone OTP / WeChat OAuth / SAML).
//
//   Moka legacy probes (`horizonrobotics` slug at app.mokahr.com) now
//   return 404 — that portal has been retired.
//
// ============================================================
// WHY THIS IS A STUB (unauthenticated access is impossible):
//
//   Horizon Robotics outsources recruiting to Beisen wecruit, whose WAF
//   blocks all anonymous POST traffic to the public positionInfo paths.
//   There is no anonymous JSON job-listing endpoint at any Horizon-owned
//   domain (www.horizon.auto has no inline job data either — it links
//   straight out to the Beisen portal).
//
//   Alternatives for job discovery:
//     (a) Apply via https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/social.html
//         (requires WeChat OAuth / phone OTP)
//     (b) Monitor third-party boards: 牛客网, 实习僧, BOSS直聘 for Horizon listings

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "wecruit.hotjob.cn/horizon";
const SOCIAL_URL = "https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/social.html";
const CAMPUS_URL = "https://wecruit.hotjob.cn/SU6409ef49bef57c635fd390a6/pb/school.html";

const STUB_MESSAGE =
  "Horizon Robotics (地平线): no public job API — careers run through Beisen wecruit " +
  "(channel SU64819a4f2f9d2433ba8b043a for social, SU6409ef49bef57c635fd390a6 for campus). " +
  "The Beisen WAF blocks all anonymous POSTs to /positionInfo/listPosition with HTTP 405. " +
  "Session cookies are only minted by enterprise SSO (phone OTP / WeChat OAuth). " +
  "No unauthenticated public API available.";

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
    apply_url: SOCIAL_URL,
  };
}

export async function fetchAllPositions(_opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, total: 0, fetched: 0, positions: [] as PositionSummary[] };
}

export async function fetchPositionDetail(postId: string) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, post_id: postId };
}

export async function fetchDictionaries() {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    portals: { social: SOCIAL_URL, campus: CAMPUS_URL },
  };
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
