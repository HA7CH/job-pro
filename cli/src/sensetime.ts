// Thin client for 商汤科技 / SenseTime campus-recruiting portal at hr.sensetime.com.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://hr.sensetime.com/
//     → 302 redirect to /SU60fa3bdabef57c1023fc1cbc/pb/social.html
//     Platform: "PB" / self-hosted Chinese HRIS (not Feishu, not Workday)
//     Vendor fingerprint: /pb/js/vendor.js + /pb/js/{page}.js webpack bundles
//
//   https://careers.sensetime.com/
//   https://campus.sensetime.com/
//     → SSL handshake failure (geo-blocked / Apple Private Relay conflict)
//
// ============================================================
// PORTAL STRUCTURE (from JS bundle analysis):
//
//   The SPA serves these page bundles:
//     /pb/js/social.js   → 社招 (social/full-time hire) page
//     /pb/js/school.js   → 校园 (campus / new-grad + intern) page
//     /pb/js/home.js     → 首页 (home hub) page
//
//   Channel IDs embedded in JS bundles:
//     SU60fa3bdabef57c1023fc1cbc  — social (社招) channel (main redirect target)
//     SU6710d7c21c240e54e1f82a1b  — campus (校园) channel (school.html)
//
//   recruitType values (from bundle analysis):
//     1 = 校园/campus (new-grad), used by school.js
//     2 = 社招/social (full-time hire), used by social.js
//
// ============================================================
// API DISCOVERY (probed 2026-05, paths extracted from social.js + school.js bundles):
//
//   Discovered paths (relative to origin+channelBase):
//     POST /positionInfo/listPosition/{channelId}
//          Payload: { isFrompb: true, recruitType: 1|2, pageSize: N, currentPage: N,
//                     postName?: str, postKey?: str, workPlace?: {...}, category?: {...} }
//          Response: { state: "200", data: { pageForm: { pageData: [...], currentPage: N },
//                       positonNum: N } }
//
//     POST /positionInfo/listSearchTerm/{channelId}
//          Returns filter taxonomies (work cities, departments, job types)
//
//     POST /positionInfo/listPositionDetail/{channelId}
//          Payload: { postId: str, recruitType: N }
//          Returns full JD for a single posting
//
//     POST /positionInfo/UnassignedPostDetail/{channelId}
//          Returns detail for positions with unassigned departments
//
//     GET  /suite/post/search/condition/{channelId}
//          Returns search filter configuration
//
//   Constructed API base:
//     https://hr.sensetime.com/{channelId}/pb/{apiPath}/{channelId}
//     (the Nginx proxy at /SU.../pb/ maps sub-paths to the backend)
//
// ============================================================
// WHY THIS IS A STUB (unauthenticated access is impossible):
//
//   Every POST request to the above paths returns HTTP 405 Method Not Allowed,
//   regardless of Origin, Referer, Content-Type, or User-Agent headers.
//   GET requests return the SPA HTML shell (client-side routing catch-all).
//
//   The Nginx WAF at hr.sensetime.com blocks all unauthenticated POST requests.
//   The API requires a valid session cookie / JWT obtained via:
//     POST /login/  or  POST /ssoLogin
//   These are enterprise SSO flows (phone OTP, WeChat OAuth, or SAML enterprise SSO)
//   that cannot be automated without a real account.
//
//   This is fundamentally different from ByteDance/Tencent/Feishu portals, which
//   allow anonymous POST to their search endpoints without any session cookie.
//
//   Recommendation: Monitor for:
//     (a) A future public campus API at campus.sensetime.com
//     (b) A Feishu Recruiting migration (SenseTime does use Feishu internally)
//     (c) Third-party job boards (牛客, 实习僧) that scrape SenseTime listings
//
// ============================================================
// STUB CONTRACT: All functions return ok:false with STUB_MESSAGE.
// checkResume is re-exported from tencent.ts (works offline on resume text).
// When/if SenseTime opens a public API, rewrite this file — the export shape
// is already locked in by the PositionSummary interface below.

import { extractResumeSignals, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "hr.sensetime.com";
const CAMPUS_URL = "https://hr.sensetime.com/SU6710d7c21c240e54e1f82a1b/pb/school.html";

const STUB_MESSAGE =
  "SenseTime (商汤): no public job API — hr.sensetime.com POSTs are blocked by WAF (HTTP 405) " +
  "without a valid session cookie; campus.sensetime.com and careers.sensetime.com are " +
  "geo-blocked (SSL failure). The HRIS platform (PB/PushB, channel SU6710d7c21c240e54e1f82a1b) " +
  "requires enterprise SSO (phone OTP / WeChat OAuth). " +
  "Documented in cli/src/sensetime.ts header.";

// ---- PositionSummary (canonical shape — matches every other adapter) ----

export interface PositionSummary {
  post_id: string;
  title: string;
  /** Job category / department (e.g. 算法研究, 软件研发) */
  project: string;
  /** Recruit type label (e.g. 校园招聘, 实习) */
  recruit_label: string;
  /** Business group — not exposed in public search results (always "") */
  bgs: string;
  work_cities: string;
  apply_url: string;
}

// ---- SearchOptions (canonical shape) ----

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /**
   * Filter by recruit type. Discovered values:
   *   1 = 校园/campus new-grad (used by school.js default)
   *   2 = 社招/social full-time hire (used by social.js default)
   * When SenseTime's API becomes accessible, pass as `recruitType` in POST body.
   */
  recruitType?: 1 | 2;
}

// ---- searchPositions ----

export async function searchPositions(_opts: SearchOptions = {}) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    // Expose the discovered endpoint so callers can see what we would have hit
    endpoint: `POST https://hr.sensetime.com/SU6710d7c21c240e54e1f82a1b/pb/positionInfo/listPosition/SU6710d7c21c240e54e1f82a1b`,
    query: {
      isFrompb: true,
      recruitType: _opts.recruitType ?? 1,
      pageSize: _opts.pageSize ?? 20,
      currentPage: _opts.page ?? 1,
      ...(_opts.keyword ? { postKey: _opts.keyword } : {}),
    },
    positions: [] as PositionSummary[],
    total: 0,
  };
}

// ---- fetchAllPositions ----

export async function fetchAllPositions(
  _opts: SearchOptions & { maxPages?: number } = {}
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

// ---- fetchPositionDetail ----

export async function fetchPositionDetail(postId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    post_id: postId,
  };
}

// ---- fetchDictionaries ----
//
// When accessible, POST /positionInfo/listSearchTerm/{channelId} returns:
//   { state: "200", data: { projectList, provinceList, orgList, postTypeList, salaryList } }

export async function fetchDictionaries() {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    note: "When API becomes accessible: POST /positionInfo/listSearchTerm/{channelId}",
  };
}

// ---- notices (no public endpoint) ----

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: "SenseTime: no public notices endpoint",
    notices: [] as Array<{ id: number; title: string; publish_time: string; tag: string; detail_url: string }>,
  };
}

export async function getNotice(noticeId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: "SenseTime: no public notices endpoint",
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
    message: "SenseTime: no public notices endpoint",
    matches: [] as unknown[],
  };
}

// ---- matchResume ----
//
// Because the position search API is inaccessible, we cannot retrieve live listings
// to score against the resume. Return ok:false with the extracted signals so the
// caller can display what terms were parsed (useful for debugging the resume text).

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
    apply_url: CAMPUS_URL,
  };
}
