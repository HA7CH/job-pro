// Thin client stub for BYD (比亚迪) campus-recruiting portal at job.byd.com.
//
// ============================================================
// Endpoint discovery (probed 2026-05, JS bundle app.e46eb97b.js +
// chunk-e8fe.d262cda1.js, chunk-ac75.7dee0692.js, chunk-a7e5.62aed375.js,
// chunk-76ac.cedb4013.js, chunk-dbeb.0075e53e.js):
//
// Portal entry:
//   https://job.byd.com/            → redirects to https://job.byd.com/portal/pc/
//   https://careers.byd.com/        → Vite/Vue marketing page (static, no job listings)
//   https://job.byd.com/portal/pc/  → main Vue SPA (webpack, ElementUI)
//
// Axios instance (t3Un module in app.e46eb97b.js):
//   baseURL = "/portal/api"
//   Interceptor: adds header Authorization: "bearer <token>" from Vuex store.
//   Code 4001 → "Token无效或已过期: Not Authenticated" (auto-redirect to login).
//
// Campus-related API endpoints found in JS bundles:
//   POST /portal/api/school/queryJobList           → campus job list
//   POST /portal/api/position/queryList            → position list (also skiller/social)
//   POST /portal/api/position/queryDetail          → position detail
//   POST /portal/api/other-info/notice/query-list  → campus notices
//   POST /portal/api/position/schedule/query-list  → campus schedule / timeline
//   GET  /portal/api/siteInfo/faq                  → FAQ
//   POST /portal/api/common/queryCodeTree          → code dictionary
//
// All endpoints probed 2026-05: EVERY request returns:
//   HTTP 200, body: {"code":4001,"timestamp":...,"msg":"Token无效或已过期: Not Authenticated"}
//
// Auth model:
//   Requires a JWT bearer token obtained through BYD account login
//   (POST /portal/api/account/login, then GET /portal/api/account/user-info).
//   There is NO public/anonymous browsing API — even the FAQ and code-tree
//   endpoints are gated behind a valid token.
//
// careers.byd.com investigation:
//   careers.byd.com is an internationalised marketing SPA (Vite + Vue 3).
//   Its BydPage-6104aa3e.js uses baseURL "/global-portal/api" with two
//   known endpoints:
//     GET /global-portal-api/global-material/getGlobalMaterial → 404
//     GET /global-portal-api/global-country/getCountryNetwork  → 404
//   The site is a static landing page that links to job.byd.com; it does
//   not expose any independent job-search API.
//
// ============================================================
// Summary: BYD has no publicly accessible campus-job search API.
//   All API calls require a logged-in user JWT.
//   This adapter is an honest stub — every function returns ok:false with
//   an informative message. It will be upgraded once an authenticated
//   (scrape-friendly) path is identified.
//
// ============================================================
// PositionSummary field mapping (BYD → canonical, documented for future use):
//   post_id       ← item.positionId or item.id  (string)
//   title         ← item.positionName           (e.g. "校招-软件开发工程师")
//   project       ← item.positionTypeName       (职位类型, e.g. "研发")
//   recruit_label ← item.recruitTypeName        (e.g. "应届生" / "实习生")
//   bgs           ← ""                          (not exposed in API)
//   work_cities   ← item.workPlace or item.city (free-text Chinese city string)
//   apply_url     ← https://job.byd.com/portal/pc/school/schoolPositionApply
//                     ?positionId={id}
//
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "job.byd.com";
const CAMPUS_PAGE = "https://job.byd.com/portal/pc/school/home";

// ---- canonical type ----

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

// ---- SearchOptions (documented for when auth becomes available) ----

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** "campus" = 应届生 (new-grad), "intern" = 实习生.  Default: "campus". */
  recruitType?: "campus" | "intern";
  /** Work-city filter, e.g. "深圳", "上海", "北京". */
  city?: string;
}

// ---- stub reason ----

const STUB_REASON =
  "BYD job.byd.com: all API endpoints require a valid JWT bearer token " +
  "(code 4001 — Token无效或已过期). No public/anonymous job search API exists. " +
  "Visit https://job.byd.com/portal/pc/school/home to browse positions after login.";

// ---- searchPositions ----

export async function searchPositions(
  _opts: SearchOptions = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  campus_page: string;
  positions: PositionSummary[];
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_REASON,
    campus_page: CAMPUS_PAGE,
    positions: [],
  };
}

// ---- fetchAllPositions ----

export async function fetchAllPositions(
  _opts: SearchOptions & { maxPages?: number } = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  campus_page: string;
  fetched: number;
  positions: PositionSummary[];
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_REASON,
    campus_page: CAMPUS_PAGE,
    fetched: 0,
    positions: [],
  };
}

// ---- fetchPositionDetail ----

export async function fetchPositionDetail(
  _postId: string
): Promise<{ ok: false; source: string; message: string }> {
  return { ok: false, source: SOURCE, message: STUB_REASON };
}

// ---- fetchDictionaries ----

export async function fetchDictionaries(): Promise<{
  ok: false;
  source: string;
  message: string;
  note: string;
  known_endpoints: string[];
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_REASON,
    note:
      "BYD: no public filter-taxonomy endpoint. " +
      "POST /portal/api/common/queryCodeTree returns 4001 without a token.",
    known_endpoints: [
      "POST /portal/api/school/queryJobList          (campus job list — auth required)",
      "POST /portal/api/position/queryList           (position list — auth required)",
      "POST /portal/api/position/queryDetail         (position detail — auth required)",
      "POST /portal/api/other-info/notice/query-list (notices — auth required)",
      "POST /portal/api/position/schedule/query-list (campus schedule — auth required)",
      "GET  /portal/api/siteInfo/faq                 (FAQ — auth required)",
      "POST /portal/api/common/queryCodeTree         (code tree — auth required)",
    ],
  };
}

// ---- listNotices ----

export async function listNotices(): Promise<{
  ok: false;
  source: string;
  message: string;
}> {
  return {
    ok: false,
    source: SOURCE,
    message: "BYD: notices endpoint (POST /portal/api/other-info/notice/query-list) requires authentication.",
  };
}

// ---- getNotice ----

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "BYD: no public notices endpoint (auth required).",
  };
}

// ---- findNoticesByQuestion ----

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "BYD: no public notices endpoint (auth required).",
  };
}

// ---- matchResume ----
// Resume matching is best-effort using extractResumeSignals/scoreOverlap from
// tencent.ts, but since the position listing API is gated, we can only return
// a stub with the extracted signals and a pointer to the campus page.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  campus_page: string;
  extracted_terms: string[];
  city_preferences: string[];
}> {
  // Extract signals so the caller knows what was parsed from the resume
  const { terms, cities } = extractResumeSignals(text ?? "");
  void opts; // unused until API becomes accessible

  return {
    ok: false,
    source: SOURCE,
    message:
      "BYD: cannot search positions — API requires authentication. " +
      `Extracted resume signals: [${terms.slice(0, 10).join(", ")}]. ` +
      "Visit the campus page to search manually.",
    campus_page: CAMPUS_PAGE,
    extracted_terms: terms,
    city_preferences: cities,
  };
}

// ---- re-export helpers so the tencent resume signals are accessible ----
export { extractResumeSignals, scoreOverlap };
