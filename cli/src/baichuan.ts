// 百川智能 (Baichuan AI) — stub adapter for `job-pro`.
//
// STATUS: stub-only. No public unauthenticated job API was found.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   www.baichuan-ai.com/careers      → 404 (Next.js SPA, page removed)
//   www.baichuan-ai.com/join         → 404
//   www.baichuan-ai.com/             → React SPA; no inline job data;
//                                      JS bundles contain no ATS references
//
// Feishu ATSX tenants probed:
//   baichuan.jobs.feishu.cn          → HTTP 400 empty body for all channels
//                                      (TLS cert resolves — wildcard *.jobs.feishu.cn —
//                                       but no portal is configured on the ATSX backend)
//   baichuan-ai.jobs.feishu.cn       → HTTP 404 (DNS only, no TLS/host)
//   baichuan-inc.jobs.feishu.cn      → HTTP 404
//   baichuanai.jobs.feishu.cn        → HTTP 404
//
//   HTTP 400 + empty body is Feishu's "site not exist / tenant has no portal"
//   response (documented in feishu.ts discovery notes). The subdomain is
//   registered at the CDN level but has no active recruiting portal behind it.
//
// Moka ATS:
//   app.mokahr.com/campus-recruitment/baichuan  → "您访问的页面不存在" (error page)
//   app.mokahr.com/social-recruitment/baichuan  → same error
//   Moka orgId probes (numeric range) — all return the Moka SPA error shell;
//   no slug "baichuan" maps to a live Moka org.
//
// Greenhouse:
//   boards.greenhouse.io/baichuan    → 404 "job board no longer active"
//   (Greenhouse board existed historically but has been deactivated.)
//
// Lever, BOSS Zhipin, Lagou, Liepin — no unauthenticated public API found.
//
// Conclusion: Baichuan currently posts positions through internal/gated channels
// only. When a public JSON endpoint becomes available this adapter can be
// upgraded to a thin wrapper around feishu.ts (createAdapter) or a bespoke
// client in a single pass.
//
// ============================================================
// PositionSummary field mapping (canonical — matches all other adapters):
//   post_id       — position identifier
//   title         — position title
//   project       — job category / department
//   recruit_label — recruit type (e.g. "实习" / "社招")
//   bgs           — business group (Baichuan has no public BG dimension)
//   work_cities   — work location(s)
//   apply_url     — deep-link to the position detail page

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "www.baichuan-ai.com";
const STUB_MESSAGE =
  "Baichuan (百川智能): no public job API — Feishu ATSX subdomain " +
  "baichuan.jobs.feishu.cn is registered but has no portal configured " +
  "(HTTP 400 empty body); Moka slug 'baichuan' returns a page-not-found " +
  "error; Greenhouse board has been deactivated. " +
  "Visit https://www.baichuan-ai.com/ for any current career links.";

// ---------- canonical types ----------

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

// ---------- stub functions ----------

export async function searchPositions(_opts: SearchOptions = {}) {
  return {
    ok: false as const,
    source: SOURCE,
    message: STUB_MESSAGE,
    query: {},
    positions: [] as PositionSummary[],
  };
}

export async function fetchAllPositions(
  _opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}
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
    notices: [] as never[],
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
    matches: [] as never[],
  };
}

// ---------- matchResume ----------
// Extracts signals so callers can see what terms were parsed, even though
// no live positions are available to score against.

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

export { extractResumeSignals, scoreOverlap };
