// Thin client for 海康威视 / Hikvision campus-recruiting portals.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://hr.hikvision.com/
//   https://hr.hikvision.com/zwzx          (老职位中心 / legacy position center)
//   https://campus.hikvision.com/
//     → TLS ECONNRESET from non-CN IP (geo-blocked by WAF/CDN)
//       DNS resolves to CGNAT 198.18.1.57/58 via local proxy, never reaches origin.
//       HTTP port 80 also hangs (socket hang-up). Both domains are inaccessible
//       from outside Mainland China. Confirmed with both curl (SSL_ERROR_SYSCALL)
//       and Node.js https / undici (ECONNRESET).
//
//   https://app.mokahr.com/campus-recruitment/hikvision/58022
//     → app.mokahr.com serves a 302 redirect loop until a session cookie is set,
//       then loads the SPA shell with init-data: {"message":-1}.
//       message:-1 is Moka's "org not found / org not active on public campus portal"
//       status. The org slug "hikvision" resolves to orgId 58022 but the public
//       campus module is inactive for this tenant.
//       All /api/campus/v*/jobs?orgId=58022 and /api/campus/v*/... paths → 404.
//
//   https://www.hikvision.com/en/about-us/careers/
//     → Reachable (AEM/Adobe Experience Manager marketing page). Links only to
//       regional career pages on the global site — no job search API.
//
// ============================================================
// INFRASTRUCTURE NOTES:
//
//   Hikvision is a 50,000+ employee Chinese enterprise headquartered in Hangzhou.
//   Their recruiting stack is entirely self-hosted behind the corporate CDN/WAF.
//   Unlike ByteDance/Tencent/JD (which expose public unauthenticated search APIs),
//   Hikvision's hr.hikvision.com portal appears to be:
//     • HTTPS only on port 443, WAF blocks TLS handshakes from non-CN egress IPs
//     • No HTTP (port 80) fallback — socket hangs immediately
//     • Likely Alibaba Cloud WAF or Hikvision's own security gateway
//
//   The legacy position center at /zwzx is on the same domain and equally blocked.
//
//   Moka ATS (Moka HR, app.mokahr.com) orgId 58022:
//     • The campus-recruitment portal returns message:-1 (tenant inactive / not found)
//     • Hikvision may have migrated away from Moka or never activated the public campus module
//     • No public /api/campus/* endpoint returns job data for this org
//
// ============================================================
// WHY THIS IS A STUB (unauthenticated API access is impossible from non-CN):
//
//   Both career portals (hr.hikvision.com and campus.hikvision.com) are behind a
//   geo-blocking WAF that resets TLS connections from non-Mainland-China IP ranges.
//   Even if a valid API path were known (e.g. from JS bundle analysis), the TLS
//   handshake never completes — no HTTP request can be made.
//
//   The Moka ATS fallback (orgId 58022) returns org-not-found, providing no data.
//
//   POSSIBLE FUTURE UNBLOCKING:
//     (a) Access from a Mainland China exit node (VPS/proxy)
//     (b) Hikvision activating their Moka public campus module
//     (c) Hikvision publishing a CDN-fronted public job API (unlikely given security posture)
//     (d) Third-party aggregators: 牛客网, 实习僧, Boss直聘 (separate adapters)
//
// ============================================================
// STUB CONTRACT:
//   All functions return ok:false with STUB_MESSAGE.
//   checkResume is re-exported from tencent.ts (works offline on resume text).
//   PositionSummary matches the canonical shape used by every other adapter.
//
// ============================================================
// ---- PositionSummary field mapping (Hikvision → canonical, for when API becomes accessible) ----
//   post_id       ← position ID from hr.hikvision.com or Moka publishId
//   title         ← position name / 职位名称
//   project       ← job category / 职位类别 (e.g. "软件开发", "算法研究", "嵌入式开发")
//   recruit_label ← recruit type / 招聘类型 (e.g. "校招", "实习", "社招")
//   bgs           ← business line / 事业部 (not exposed in known public payloads → "")
//   work_cities   ← work location / 工作地点 (e.g. "杭州" / "北京 / 上海")
//   apply_url     ← https://hr.hikvision.com/zwzx#/job/<id>  (inferred from URL pattern)

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "hr.hikvision.com";
const CAMPUS_URL = "https://hr.hikvision.com/zwzx";
const MOKA_URL = "https://app.mokahr.com/campus-recruitment/hikvision/58022";

const STUB_MESSAGE =
  "Hikvision (海康威视): no public job API accessible from outside Mainland China. " +
  "hr.hikvision.com and campus.hikvision.com are geo-blocked (TLS ECONNRESET, WAF resets " +
  "all non-CN connections). Moka ATS orgId 58022 returns message:-1 (org not active on " +
  "public campus portal). To access Hikvision jobs, visit hr.hikvision.com directly from " +
  "a Mainland China network, or check 牛客网/Boss直聘/实习僧 for aggregated listings. " +
  "Documented in cli/src/hikvision.ts header.";

// ---- PositionSummary (canonical shape — matches every other adapter) ----

export interface PositionSummary {
  post_id: string;
  title: string;
  /** Job category / 职位类别 (e.g. "软件开发", "算法研究", "嵌入式开发") */
  project: string;
  /** Recruit type / 招聘类型 (e.g. "校招", "实习", "社招") */
  recruit_label: string;
  /** Business line — not exposed in known public payloads */
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
   * Recruit type filter (for when API becomes accessible):
   *   "campus"      = 校园招聘 (new-grad)
   *   "internship"  = 实习
   *   "social"      = 社招 (full-time)
   */
  recruitType?: "campus" | "internship" | "social";
}

// ---- searchPositions ----

export async function searchPositions(_opts: SearchOptions = {}) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    // Expose the discovered endpoint candidate so callers can see what we would have hit
    endpoint_candidates: [
      `GET  ${CAMPUS_URL}   (geo-blocked from non-CN)`,
      `GET  https://campus.hikvision.com/   (geo-blocked from non-CN)`,
      `GET  ${MOKA_URL}     (Moka orgId 58022, message:-1 — org inactive)`,
    ],
    query: {
      keyword: _opts.keyword ?? "",
      page: _opts.page ?? 1,
      pageSize: _opts.pageSize ?? 20,
      recruitType: _opts.recruitType ?? "campus",
    },
    page: _opts.page ?? 1,
    page_size: _opts.pageSize ?? 20,
    total: 0,
    positions: [] as PositionSummary[],
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

export async function fetchDictionaries() {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    note:
      "When hr.hikvision.com becomes accessible from non-CN: " +
      "inspect JS bundles at /zwzx for /api/* filter taxonomy endpoints " +
      "(job categories, work cities, recruit types).",
  };
}

// ---- notices (no public endpoint) ----

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: "Hikvision: no public notices endpoint",
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
    message: "Hikvision: no public notices endpoint",
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
    message: "Hikvision: no public notices endpoint",
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
    moka_url: MOKA_URL,
  };
}
