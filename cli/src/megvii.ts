// Thin client for 旷视科技 / Megvii / Face++ campus-recruiting portal.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://www.megvii.com/careers
//     → 302 redirect to https://www.megvii.com/ (marketing homepage)
//
//   https://www.megvii.com/join_us
//     → Reachable: SSR marketing page (~118 KB), no public job API,
//       no embedded JSON job data, no fetch/axios calls in HTML.
//       Footer links point to /join_us/campus (校园招聘) and Moka.
//
//   https://hr.megvii.com/        → HTTP 404
//   https://careers.megvii.com/   → HTTP 404
//   https://campus.megvii.com/    → HTTP 404
//
//   http://joinus.megvii.com
//     → 302 → https://app.mokahr.com/campus_apply/megviihr/38642
//       (Moka campus portal, orgSlug="megviihr", orgId=38642)
//       The Moka SPA enters a redirect loop without a valid session cookie.
//       Every route under /campus_apply/megviihr/38642 returns:
//         init-data: {"message":"您访问的页面不存在",...}
//
//   http://zhaopin.megvii.com
//     → 302 → https://app.mokahr.com/social-recruitment/megviihr/38641
//       (Moka social portal, orgSlug="megviihr", orgId=38641)
//
// ============================================================
// MOKA API PROBE RESULTS:
//
//   All Moka REST API patterns tested (probed 2026-05):
//
//   GET  /api/campus/v1/organizations/megviihr/jobs?pageSize=N
//   GET  /api/campus/v1/organizations/megviihr/38642/jobs?pageSize=N
//   GET  /api/campus/v1/organizations/megviihr/38642/positions?pageSize=N
//   GET  /api/campus/v2/organizations/megviihr/positions?pageSize=N
//   POST /api/campus/v1/jobs/search  { orgId:"38642", ... }
//   POST /api/campus/v1/organizations/megviihr/jobs/search
//   GET  /api/social/v1/organizations/megviihr/jobs?pageSize=N
//
//   All return: HTTP 200, body { "message":"您访问的页面不存在","code":-1 }
//
//   Root cause: Moka ATS requires an active applicant session (cookie-based)
//   for ALL candidate-facing API calls. The session is obtained via:
//     - WeChat OAuth (most common)
//     - Phone OTP login
//   There is no anonymous/public API surface on Moka for job listings.
//   This is consistent with Moka's design as a closed ATS — unlike
//   ByteDance (jobs.bytedance.com) or Tencent (join.qq.com) which expose
//   purpose-built public portals with unauthenticated search APIs.
//
// ============================================================
// CONFIRMED MOKA ORG IDs:
//
//   Campus (校园招聘): orgSlug=megviihr, orgId=38642
//     Entry:   http://joinus.megvii.com
//              → https://app.mokahr.com/campus_apply/megviihr/38642
//
//   Social  (社会招聘): orgSlug=megviihr, orgId=38641
//     Entry:   http://zhaopin.megvii.com
//              → https://app.mokahr.com/social-recruitment/megviihr/38641
//
//   Note: The task brief flagged orgId 38641 as "social hires only" —
//   confirmed. Campus (38642) is a separate org on the same Moka tenant.
//
// ============================================================
// WHY THIS IS A STUB (unauthenticated access is impossible):
//
//   Megvii outsources all recruiting to Moka ATS, which requires
//   a valid applicant session for every API call. There is no
//   anonymous-accessible job search API at any Megvii domain.
//
//   Alternatives for job discovery:
//     (a) Apply directly via https://app.mokahr.com/campus_apply/megviihr/38642
//         (requires WeChat login)
//     (b) Monitor third-party boards: 牛客网, 实习僧, boss直聘 for Megvii listings
//     (c) Watch for a future public API migration (Feishu Recruiting / custom portal)
//
// ============================================================
// STUB CONTRACT: All functions return ok:false with STUB_MESSAGE.
// checkResume is re-exported from tencent.ts (works offline on resume text).
// When/if Megvii opens a public API, rewrite this file — the export shape
// is already locked by the PositionSummary interface below.
//
// ---- PositionSummary field mapping (Moka → canonical) ----
//   post_id      ← job.id (Moka internal job ID)
//   title        ← job.name (职位名称)
//   project      ← job.departmentName or job.categoryName (部门/职类)
//   recruit_label ← job.recruitTypeName (校园招聘 / 社会招聘 / 实习)
//   bgs          ← "" (Moka does not expose BG/事业群 in public search)
//   work_cities  ← job.cities joined with " / "
//   apply_url    ← https://app.mokahr.com/campus_apply/megviihr/38642#/jobs/{id}

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "app.mokahr.com/campus_apply/megviihr/38642";
const CAMPUS_URL = "https://app.mokahr.com/campus_apply/megviihr/38642";
const SOCIAL_URL = "https://app.mokahr.com/social-recruitment/megviihr/38641";

const STUB_MESSAGE =
  "Megvii (旷视科技): no public job API — all recruiting runs through Moka ATS " +
  "(campus orgId=38642 at app.mokahr.com/campus_apply/megviihr/38642, " +
  "social orgId=38641 at app.mokahr.com/social-recruitment/megviihr/38641). " +
  "Moka requires an active applicant session (WeChat OAuth / phone OTP) for every API call; " +
  "all unauthenticated API probes return {code:-1, message:'您访问的页面不存在'}. " +
  "hr.megvii.com / careers.megvii.com / campus.megvii.com are all HTTP 404. " +
  "Documented in cli/src/megvii.ts header.";

// ---- PositionSummary (canonical shape — matches every other adapter) ----

export interface PositionSummary {
  post_id: string;
  title: string;
  /** Job department / category (e.g. 算法研究, 软件研发, 视觉感知) */
  project: string;
  /** Recruit type label (e.g. 校园招聘, 实习, 社会招聘) */
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
   * Filter by recruit type. Moka values (when API becomes accessible):
   *   "campus"  = 校园招聘 (orgId 38642, campus new-grad + intern)
   *   "social"  = 社会招聘 (orgId 38641, experienced hire)
   * Default: "campus" (matches the joinus.megvii.com entry point).
   */
  recruitType?: "campus" | "social";
}

// ---- searchPositions ----

export async function searchPositions(_opts: SearchOptions = {}) {
  const recruitType = _opts.recruitType ?? "campus";
  const applyUrl = recruitType === "social" ? SOCIAL_URL : CAMPUS_URL;
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    // Expose the would-be Moka endpoint so callers can see what we'd target
    endpoint:
      recruitType === "social"
        ? `GET https://app.mokahr.com/api/social/v1/organizations/megviihr/jobs?pageSize=${_opts.pageSize ?? 20}&pageIndex=${_opts.page ?? 1}`
        : `GET https://app.mokahr.com/api/campus/v1/organizations/megviihr/jobs?pageSize=${_opts.pageSize ?? 20}&pageIndex=${_opts.page ?? 1}`,
    query: {
      orgSlug: "megviihr",
      orgId: recruitType === "social" ? 38641 : 38642,
      recruitType,
      pageSize: _opts.pageSize ?? 20,
      pageIndex: _opts.page ?? 1,
      ...(_opts.keyword ? { keyword: _opts.keyword } : {}),
    },
    apply_url: applyUrl,
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
// When Moka session is available, the campus org filter taxonomy would come from:
//   GET https://app.mokahr.com/api/campus/v1/organizations/megviihr/38642/searchConfig
//   (returns: departments, job types, cities, recruit types)

export async function fetchDictionaries() {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    note:
      "When Moka session is available: " +
      "GET /api/campus/v1/organizations/megviihr/38642/searchConfig " +
      "returns departments, job types, cities, recruit types.",
    moka_orgs: {
      campus: { slug: "megviihr", id: 38642, url: CAMPUS_URL },
      social: { slug: "megviihr", id: 38641, url: SOCIAL_URL },
    },
  };
}

// ---- notices (no public endpoint) ----

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: "Megvii (旷视): no public notices endpoint",
    notices: [] as Array<{
      id: number;
      title: string;
      publish_time: string;
      tag: string;
      detail_url: string;
    }>,
  };
}

export async function getNotice(noticeId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: "Megvii (旷视): no public notices endpoint",
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
    message: "Megvii (旷视): no public notices endpoint",
    matches: [] as unknown[],
  };
}

// ---- matchResume ----
//
// Because the position search API is inauthenticated-inaccessible via Moka,
// we cannot retrieve live listings to score against the resume.
// Return ok:false with the extracted signals so the caller can display
// what terms were parsed — useful for cross-referencing with other adapters.

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
    note:
      "Resume signals extracted successfully. " +
      "To find matching Megvii roles, visit the campus portal directly (requires WeChat login).",
  };
}

// Explicitly re-export scoreOverlap so callers that import * from megvii get the full toolkit,
// consistent with bytedance.ts. The function is unused internally (no live search to score
// against), but keeping the export shape uniform avoids surprises when the adapter is upgraded.
export { scoreOverlap };
