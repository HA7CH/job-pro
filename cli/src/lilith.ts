// 莉莉丝游戏 (Lilith Games) campus-recruiting adapter.
//
// ============================================================
// API DISCOVERY (probed 2026-05-14)
//
// The canonical career entry point is https://jobs.lilith.com/
// The page hosts navigation links (social/campus/intern) that all
// redirect to the Feishu Recruitment (飞书招聘) portal:
//
//   Social hire:  https://lilithgames.jobs.feishu.cn/career
//   Campus hire:  https://lilithgames.jobs.feishu.cn/campus
//   Intern hire:  https://lilithgames.jobs.feishu.cn/intern
//
// Reconnaissance also flagged a Moka org_id 7803 but
// app.mokahr.com/campus-recruitment/lilith/7803 returns
// "当前网页已关停" (page suspended).
//
// ============================================================
// Feishu Recruitment API (reverse-engineered from the saas-career JS bundle,
// chunk 4026.f23f1edc.js, fetched 2026-05-14)
//
//   POST https://lilithgames.jobs.feishu.cn/api/v1/search/job/posts
//   Headers: Content-Type: application/json
//            Referer: https://lilithgames.jobs.feishu.cn/career
//   Payload:
//     {
//       keyword:                  string,           // search term
//       limit:                    number,           // page size
//       offset:                   number,           // (current-1)*limit
//       job_hot_flag:             undefined,
//       portal_type:              6,                // SaasCareer portal type
//       job_category_id_list:     string[],         // category filter
//       tag_id_list:              string[],
//       location_code_list:       string[],         // CT_11=北京, CT_125=上海, etc.
//       subject_id_list:          string[],
//       recruitment_id_list:      string[],
//       job_function_id_list:     string[],
//       storefront_id_list:       string[],
//     }
//   Response: { code: 0, data: { job_post_list: RawJobPost[], count: number }, message: "ok" }
//
// Raw job post field mapping (from N() mapper in bundle):
//   id                            → post_id
//   title                         → title
//   job_category.name             → project
//   recruit_type.name             → recruit_label
//   department_info               → bgs (Lilith does not expose BG in the public payload)
//   city_info.name                → work_cities (or city_info_list_for_delivery for multi-city)
//
// ============================================================
// NETWORK ACCESSIBILITY (probed 2026-05-14)
//
// lilithgames.jobs.feishu.cn resolves to 198.18.1.152 (IANA RFC 2544
// benchmarking range). All feishu.cn/larksuite.com subdomains resolve
// into 198.18.0.0/15 from the current environment, indicating a
// DNS-level network block. TLS connects but every HTTP path (including
// /api/v1/search/job/posts) is answered by a ByteDance headhunter
// platform stub page rather than the Feishu Recruitment API.
// The Feishu API is structurally identical to ByteDance's campus API
// (same city-code format CT_XX, same payload shape, same response envelope)
// but is NOT callable without a network path that bypasses the block.
//
// VERDICT: API is fully discovered but unreachable from this environment.
// This adapter is an honest stub that returns ok:false with a clear
// message. The apply_url values point to the live portal.
//
// ============================================================
// PositionSummary field mapping (canonical keys, matches all other adapters)
//   post_id       — string job identifier
//   title         — position title
//   project       — job category (job_category.name)
//   recruit_label — recruit type label (recruit_type.name)
//   bgs           — business group (not exposed in public API payload, always "")
//   work_cities   — work location (city_info.name)
//   apply_url     — deep link to the Feishu Recruitment job detail
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "lilithgames.jobs.feishu.cn";
const CAREER_PAGE = "https://lilithgames.jobs.feishu.cn/career";
const CAMPUS_PAGE = "https://lilithgames.jobs.feishu.cn/campus";
const INTERN_PAGE = "https://lilithgames.jobs.feishu.cn/intern";

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
  "Lilith Games (莉莉丝游戏) recruiting is hosted on Feishu Recruitment (飞书招聘) at " +
  "lilithgames.jobs.feishu.cn. The API endpoint POST /api/v1/search/job/posts has been " +
  "reverse-engineered (portal_type:6, same payload shape as ByteDance campus API) but the " +
  "domain resolves to IANA-reserved 198.18.x.x from this environment — a DNS-level network " +
  "block prevents all API calls. The Moka org (org_id 7803) page is also suspended. " +
  `Apply directly at ${CAREER_PAGE} (社会招聘) or ${CAMPUS_PAGE} (校园招聘).`;

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
    apply_url: CAREER_PAGE,
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
    apply_url: CAREER_PAGE,
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
    apply_url: CAREER_PAGE,
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
    apply_url: CAREER_PAGE,
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
    message: "Lilith Games: no public notices endpoint",
  };
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "Lilith Games: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "Lilith Games: no public notices endpoint",
  };
}

// ---------- matchResume ----------
// Resume matching cannot fetch live position data.
// We surface signals extracted from the resume and direct the user to
// the Lilith Games career portal for manual search.

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
    apply_url: CAREER_PAGE,
    extracted_terms: terms,
    city_preferences: cities,
  };
}

// Export helpers so callers that import from this module can use them.
export { extractResumeSignals, scoreOverlap };

// Expose portal page URLs for external reference.
export const PORTAL_URLS = {
  social: CAREER_PAGE,
  campus: CAMPUS_PAGE,
  intern: INTERN_PAGE,
  homepage: "https://jobs.lilith.com/",
} as const;
