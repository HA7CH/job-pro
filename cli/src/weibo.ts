// Weibo / Sina campus-recruiting adapter.
//
// ============================================================
// API DISCOVERY (probed 2026-05-14)
//
// Three potential portals were investigated:
//
//   1. job.weibo.com / hr.weibo.com / campus.weibo.com
//      DNS resolves to 198.18.x.x (IANA RFC 2544 benchmarking range — unreachable
//      from public internet; SSL handshake fails / empty reply at TCP level).
//      These hostnames are dead ends from outside the Sina intranet.
//
//   2. career.sina.com.cn  (Sina's self-hosted Node/Express ATS)
//      The portal serves Weibo campus jobs at company ID 43536
//      (/campus-recruitment/sina/43536). Every unauthenticated HTTP request
//      receives an infinite 302 redirect loop back to itself.
//      The only JSON endpoint that responds without auth is:
//        GET /api/jobs → HTTP 401 {"message":"Need Login","code":1}
//      All other /api/* paths return HTTP 404.
//      Conclusion: fully auth-gated, no public JSON feed.
//
//   3. weibo.wd1.myworkdayjobs.com  (Workday tenant — also exists for sinagroup)
//      The tenant resolves and is behind Cloudflare, but the UI shell returns
//      HTTP 500 and redirects to community.workday.com/maintenance-page.
//      All POST attempts to /wday/cxs/weibo/<slug>/jobs return HTTP 422
//      regardless of slug or payload shape — the correct site slug cannot be
//      determined without a working UI page to scrape.
//
//   4. weibo.mokahr.com  — Moka slug: SSL handshake failure (no valid portal).
//
//   5. Greenhouse boards.greenhouse.io/weibo — HTTP 301, not a Weibo org.
//
// VERDICT: No public unauthenticated API exists for Weibo/Sina campus recruiting.
// The canonical path is career.sina.com.cn which requires an active login session.
// This adapter is an honest stub that returns ok:false with a clear message.
//
// ============================================================
// PositionSummary field mapping (canonical keys, matches all other adapters)
//   post_id       — string job identifier
//   title         — position title
//   project       — job category / department
//   recruit_label — recruit type label (e.g. "校招" / "实习")
//   bgs           — business group (not exposed by Sina ATS, always "")
//   work_cities   — work location string
//   apply_url     — deep link to the job posting
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "career.sina.com.cn";
const CAMPUS_PAGE = "https://career.sina.com.cn/campus-recruitment/sina/43536";

// ---------- PositionSummary ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

// ---------- stub message ----------

const STUB_MSG =
  "Weibo campus recruiting (career.sina.com.cn) is fully auth-gated: " +
  "every endpoint requires a valid login session. " +
  "job.weibo.com / hr.weibo.com resolve to IANA-reserved IPs (unreachable outside Sina intranet). " +
  "No public unauthenticated JSON API was found. " +
  `Apply directly at ${CAMPUS_PAGE}`;

// ---------- searchPositions ----------

export async function searchPositions(
  _opts: SearchOptions = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  apply_url: string;
  positions: PositionSummary[];
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
    positions: [],
  };
}

// ---------- fetchAllPositions ----------

export async function fetchAllPositions(
  _opts: SearchOptions & { maxPages?: number } = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  apply_url: string;
  fetched: number;
  positions: PositionSummary[];
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
    fetched: 0,
    positions: [],
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(
  _postId: string
): Promise<{ ok: false; source: string; message: string; apply_url: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries(): Promise<{
  ok: false;
  source: string;
  message: string;
  apply_url: string;
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
  };
}

// ---------- notices (no public endpoint) ----------

export async function listNotices(): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return {
    ok: false,
    source: SOURCE,
    message: "Weibo: no public notices endpoint",
  };
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "Weibo: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "Weibo: no public notices endpoint",
  };
}

// ---------- matchResume ----------
// Resume matching cannot fetch live position data without auth.
// We surface the signals extracted from the resume and direct the user to
// the Weibo campus page to search manually.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  apply_url: string;
  extracted_terms?: string[];
  city_preferences?: string[];
}> {
  void opts;
  const { terms, cities } = extractResumeSignals(text ?? "");
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
    extracted_terms: terms,
    city_preferences: cities,
  };
}

// Export scoreOverlap so callers that import helpers from this module can use them.
export { extractResumeSignals, scoreOverlap };
