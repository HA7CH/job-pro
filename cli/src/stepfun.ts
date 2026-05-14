// Thin client for 阶跃星辰 / StepFun campus-recruiting portal.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://stepfun.com/careers         → 404 (Next.js app, no career page)
//   https://www.stepfun.com/careers     → 404 (same Next.js shell)
//   https://stepfun.com/join-us         → 404
//   https://jobs.stepfun.com            → TLS/SSL error (domain not registered)
//
// Feishu ATSX tenants probed (all return HTTP 400 / empty body):
//   stepfun.jobs.feishu.cn
//   step.jobs.feishu.cn
//   jiebuxingchen.jobs.feishu.cn
//   stepai.jobs.feishu.cn
//   stepfunai.jobs.feishu.cn
//   step-fun.jobs.feishu.cn
//   jieyu.jobs.feishu.cn
//   steppfun.jobs.feishu.cn
//
//   HTTP 400 with an empty body is Feishu's "tenant subdomain not configured
//   on the ATSX backend" response (documented in feishu.ts discovery notes).
//   None of the above subdomains are live Feishu tenants.
//
// Moka ATS — app.mokahr.com/social-recruitment/step/94904:
//   The URL slug "step" / orgId 94904 exists (the bare path redirects to itself
//   rather than 404-ing), but the page requires a browser session.
//   All public API paths return {"message":"您访问的页面不存在","code":-1}:
//     /api/campus/v1/org/step/positions     → 404
//     /api/campus/v1/jobs?orgSlug=step       → 404
//     /api/v1/jobs?orgSlug=step              → 404
//     /api/v1/social/positions?orgSlug=step  → 404
//     /api/campus/v2/positions?orgSlug=step  → 404
//   This matches the Moka "social-only" posture described in the task brief
//   (auth-gated, no unauthenticated public position-list endpoint).
//
// ============================================================
// INFRASTRUCTURE NOTES:
//
//   StepFun (阶跃星辰) is a Beijing-based AI lab founded 2023.  Their public
//   website (stepfun.com) is a Next.js consumer-facing chat app.  They have
//   not published a public unauthenticated job-search API on any discovered
//   subdomain or ATS platform.
//
//   POSSIBLE FUTURE UNBLOCKING:
//     (a) StepFun activating a Feishu ATSX tenant (watch *.jobs.feishu.cn)
//     (b) StepFun activating the Moka public social-recruitment module
//     (c) StepFun building a custom career page with an open JSON API
//     (d) Third-party aggregators: Boss直聘, 拉勾, 实习僧 (separate adapters)
//
// ============================================================
// STUB CONTRACT:
//   All functions return ok:false with STUB_MESSAGE.
//   checkResume is re-exported from tencent.ts (works offline on resume text).
//   PositionSummary matches the canonical shape used by every other adapter.
//
// ============================================================
// ---- PositionSummary field mapping (StepFun → canonical, for when API becomes accessible) ----
//   post_id       ← position ID from Feishu ATSX or Moka publishId
//   title         ← position name / 职位名称
//   project       ← job category / 职位类别 (e.g. "算法研究", "后端开发", "大模型")
//   recruit_label ← recruit type / 招聘类型 (e.g. "社招", "校招", "实习")
//   bgs           ← business line — not exposed in known public payloads → ""
//   work_cities   ← work location / 工作地点 (e.g. "北京" / "上海")
//   apply_url     ← https://app.mokahr.com/social-recruitment/step/94904  (portal URL)

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "stepfun.com";
const PORTAL_URL = "https://app.mokahr.com/social-recruitment/step/94904";

const STUB_MESSAGE =
  "StepFun (阶跃星辰): no public job API accessible without authentication. " +
  "stepfun.com has no career page; all *.jobs.feishu.cn subdomains return HTTP 400 " +
  "(tenant not configured in Feishu ATSX backend). Moka orgSlug 'step' / orgId 94904 " +
  "exists but all /api/* endpoints are auth-gated (return 404). " +
  "To browse StepFun jobs, visit the Moka portal directly: " +
  PORTAL_URL + ". Documented in cli/src/stepfun.ts header.";

// ---- PositionSummary (canonical shape — matches every other adapter) ----

export interface PositionSummary {
  post_id: string;
  title: string;
  /** Job category / 职位类别 (e.g. "算法研究", "后端开发", "大模型") */
  project: string;
  /** Recruit type / 招聘类型 (e.g. "社招", "校招", "实习") */
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
   *   "social"      = 社招 (full-time, Moka portal active)
   *   "campus"      = 校园招聘 (new-grad, Feishu ATSX if activated)
   *   "internship"  = 实习
   */
  recruitType?: "social" | "campus" | "internship";
  /** Filter by job category / 职位类别 (for when API becomes accessible) */
  jobCategoryIdList?: string[];
  /** Filter by city codes (for when API becomes accessible) */
  cityIdList?: string[];
}

// ---- searchPositions ----

export async function searchPositions(_opts: SearchOptions = {}) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    endpoint_candidates: [
      `GET  ${PORTAL_URL}   (Moka social portal — browser auth required)`,
      "GET  stepfun.jobs.feishu.cn   (HTTP 400 — Feishu tenant not configured)",
    ],
    query: {
      keyword: _opts.keyword ?? "",
      page: _opts.page ?? 1,
      pageSize: _opts.pageSize ?? 20,
      recruitType: _opts.recruitType ?? "social",
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
    fetched: 0,
    positions: [] as PositionSummary[],
    total: 0,
  };
}

// ---- fetchPositionDetail ----

export async function fetchPositionDetail(_postId: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
  };
}

// ---- fetchDictionaries ----

export async function fetchDictionaries() {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
  };
}

// ---- notices ----

export async function listNotices() {
  return {
    ok: false as const,
    source: SOURCE,
    message: "StepFun (阶跃星辰): no public notices endpoint",
  };
}

export async function getNotice(_id: string) {
  return {
    ok: false as const,
    source: SOURCE,
    message: "StepFun (阶跃星辰): no public notices endpoint",
  };
}

export async function findNoticesByQuestion(
  _question: string,
  _opts: { questionTime?: string; topK?: number } = {}
) {
  return {
    ok: false as const,
    source: SOURCE,
    message: "StepFun (阶跃星辰): no public notices endpoint",
  };
}

// ---- matchResume ----

export async function matchResume(
  _text: string,
  _opts: { topN?: number; candidates?: number } = {}
) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    matches: [] as PositionSummary[],
  };
}

export { extractResumeSignals, scoreOverlap };
