// Thin client for 米哈游 / miHoYo's campus careers.
//
// STATUS: stub-only (2026-05-14). miHoYo's public careers portal
// (campus.mihoyo.com) is a 2KB SPA shell with no embedded job data and
// no fetch paths visible in the HTML — every dimension loads at runtime
// from JS bundles we can't traverse without a headless browser.
//
// Probe results:
//   campus.mihoyo.com               → 200, 2KB SPA shell (no useful data inline)
//   careers.mihoyo.com              → SSL handshake timed out (geo-blocked / VPN-only?)
//   hr.mihoyo.com                   → 404
//   mihoyo.jobs.feishu.cn           → POST 400 on every channel string tried
//                                     ("campus" / "mihoyo" / "social" / "1" / "school_recruit").
//                                     GET returns a generic Feishu shell — meaning
//                                     miHoYo is NOT a real Feishu Recruiting tenant.
//   careers.mihoyo.com via Workday  → not configured
//   mihoyo.mokahr.com               → Moka requires session auth (verified for the
//                                     class of orgs — Moka public anon API is gated)
//
// So this adapter ships as an honest stub. listNotices / getNotice /
// findNoticesByQuestion / fetchDictionaries all return { ok: false }
// with the documented reason; matchResume returns 0 matches. Smoke test
// will tag it WARN (limited). When/if miHoYo opens a public job API we
// rewrite this file in one pass; the dispatcher contract is preserved.

import { extractResumeSignals, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "campus.mihoyo.com";
const STUB_MESSAGE =
  "miHoYo: no public job API — campus.mihoyo.com is a SPA loading data at runtime; " +
  "Feishu tenant returns 400 on all channels; Moka org requires session auth. " +
  "Documented in cli/src/mihoyo.ts header.";

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

export async function fetchAllPositions(_opts: {
  keyword?: string;
  maxPages?: number;
  pageSize?: number;
} = {}) {
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
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
  };
}

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    notices: [] as Array<{ id: number; title: string; publish_time: string; tag: string }>,
  };
}

export async function getNotice(noticeId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    notice_id: noticeId,
  };
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
    matches: [] as unknown[],
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
