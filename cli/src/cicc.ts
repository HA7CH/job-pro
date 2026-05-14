// Thin client for CICC / 中金公司 (China International Capital Corporation) campus recruiting.
//
// ============================================================
// API DISCOVERY (probed 2026-05-14)
//
// Five potential portals were investigated:
//
//   1. careers.cicc.com  (CICC dedicated careers subdomain)
//      DNS resolves to 198.18.1.66 (IANA RFC 2544 benchmarking range — unreachable
//      from public internet; SSL handshake fails at TCP level).
//      This hostname is dead from outside the CICC intranet.
//
//   2. hr.cicc.com  (HR portal)
//      DNS resolves to 198.18.1.212 — same IANA-reserved range.
//      Unreachable: SSL handshake fails.
//
//   3. www.cicc.com/career  (main site career section)
//      Returns HTTP 521 (Cloudflare "Web server is down"). Cloudflare can reach
//      the origin but the origin is not responding. No API endpoints discoverable.
//
//   4. app.mokahr.com — Moka ATS, orgId 28961 (reconnaissance-flagged candidate)
//      The Moka platform (app.mokahr.com) is reachable (resolves to Aliyun WAF
//      47.93.92.61 via authoritative DNS). However:
//        - /campus-recruitment/cicc/28961        → HTTP 302 self-redirect (infinite loop)
//        - /campus-recruitment/cicc-career/28961 → HTTP 200 HTML, but init-data
//          contains {"message":"您访问的页面不存在"} — org page does not exist
//        - /social-recruitment/cicc-career/28961 → same "page not found" response
//        - All /api/campus/jobs?organizationId=28961 variants → {"code":-1,"message":"您访问的页面不存在"}
//      Conclusion: orgId 28961 is either wrong or the CICC Moka tenant is fully
//      auth-gated behind enterprise SSO. No public JSON feed is accessible.
//
//   5. Alternative slugs tried on Moka: "cicc", "cicc-career", "zhongjin", numeric
//      variants of orgId (28960–28965) — all return either the same "not found"
//      response or an infinite self-redirect.
//
// VERDICT: No public unauthenticated API exists for CICC campus recruiting as of
// 2026-05-14. All externally-facing hostnames resolve to IANA-reserved IPs (intranet)
// or return infrastructure errors (521). The Moka tenant, if it exists, is fully
// auth-gated with no discoverable public endpoints.
//
// The canonical path for candidates is the CICC official career portal:
//   https://www.cicc.com/career  (may load once the origin is healthy)
// Or the known Moka URL patterns (require an active employee/candidate session):
//   https://app.mokahr.com/campus-recruitment/cicc-career/28961
//
// ============================================================
// PositionSummary field mapping (canonical keys, matches all other adapters)
//   post_id       — string job identifier
//   title         — position title
//   project       — job category / department (e.g. "投行" / "研究" / "固收")
//   recruit_label — recruit type label (e.g. "校园招聘" / "实习")
//   bgs           — business group / division (not exposed without auth, always "")
//   work_cities   — work location string
//   apply_url     — deep link to the job posting
// ============================================================

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "www.cicc.com";
const CAMPUS_PAGE = "https://www.cicc.com/career";
// Moka tenant URL kept for reference — requires auth
const MOKA_PAGE = "https://app.mokahr.com/campus-recruitment/cicc-career/28961";

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
  "CICC (中金公司) campus recruiting has no publicly accessible API as of 2026-05-14. " +
  "careers.cicc.com and hr.cicc.com resolve to IANA-reserved IPs (198.18.x.x, " +
  "unreachable outside the CICC intranet; SSL handshake fails). " +
  "www.cicc.com returns HTTP 521 (Cloudflare origin-down). " +
  "The Moka ATS tenant (orgId 28961) is fully auth-gated: all public API paths " +
  'return {"code":-1,"message":"您访问的页面不存在"}. ' +
  `Apply directly at ${CAMPUS_PAGE} or via the Moka portal (login required): ${MOKA_PAGE}`;

// ---------- searchPositions ----------

export async function searchPositions(
  _opts: SearchOptions = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  apply_url: string;
  moka_url: string;
  positions: PositionSummary[];
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
    moka_url: MOKA_PAGE,
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
  moka_url: string;
  fetched: number;
  positions: PositionSummary[];
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
    moka_url: MOKA_PAGE,
    fetched: 0,
    positions: [],
  };
}

// ---------- fetchPositionDetail ----------

export async function fetchPositionDetail(
  _postId: string
): Promise<{ ok: false; source: string; message: string; apply_url: string; moka_url: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
    moka_url: MOKA_PAGE,
  };
}

// ---------- fetchDictionaries ----------

export async function fetchDictionaries(): Promise<{
  ok: false;
  source: string;
  message: string;
  apply_url: string;
  moka_url: string;
}> {
  return {
    ok: false,
    source: SOURCE,
    message: STUB_MSG,
    apply_url: CAMPUS_PAGE,
    moka_url: MOKA_PAGE,
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
    message: "CICC: no public notices endpoint",
  };
}

export async function getNotice(
  _id: string
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "CICC: no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
): Promise<{ ok: false; source: string; message: string }> {
  return {
    ok: false,
    source: SOURCE,
    message: "CICC: no public notices endpoint",
  };
}

// ---------- matchResume ----------
// Resume matching cannot fetch live position data without auth.
// We extract signals from the resume and direct the user to the CICC career portal.

export async function matchResume(
  text: string,
  opts: { topN?: number; candidates?: number } = {}
): Promise<{
  ok: false;
  source: string;
  message: string;
  apply_url: string;
  moka_url: string;
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
    moka_url: MOKA_PAGE,
    extracted_terms: terms,
    city_preferences: cities,
  };
}

// Export helpers so callers that import from this module can use them.
export { extractResumeSignals, scoreOverlap };
