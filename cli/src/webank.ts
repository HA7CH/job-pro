// 微众银行 (WeBank) — stub adapter for `job-pro`.
//
// STATUS: stub-only. WeBank operates a campus-recruiting portal at
// career.webank.com but the domain is not resolvable from public DNS, and
// every public ATS slug we probed (Feishu, Moka, Greenhouse, Lever) returns
// 404. WeBank's hiring funnel runs entirely through WeChat mini-programs.
//
// ============================================================
// RECONNAISSANCE RESULTS (probed 2026-05):
//
//   https://career.webank.com   — 000 (no public DNS / unreachable)
//   https://job.webank.com      — 000 (no public DNS / unreachable)
//   https://hr.webank.com       — 000 (no public DNS / unreachable)
//
//   Feishu ATSX:    webank.jobs.feishu.cn — HTTP 400 (no portal)
//   Greenhouse:     webank                — HTTP 404 (no board)
//   Lever:          webank                — HTTP 404 (no posting)
//
//   The official 微众银行招聘 WeChat 公众号 publishes openings as articles
//   and routes applications into a mini-program; no JSON surface is exposed.
//
// Conclusion: no unauthenticated public API. Apply via the WeChat 微众银行招聘
// account or visit https://www.webank.com/ for company contact info.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
export { checkResume };

const SOURCE = "webank.com";
const STUB_MESSAGE =
  "WeBank (微众银行): career.webank.com and sibling subdomains fail to resolve over public DNS. " +
  "Recruiting runs through the WeChat 微众银行招聘 mini-program; no Greenhouse / Lever / Feishu " +
  "tenant provisioned. No unauthenticated public API available.";

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
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, query: {}, positions: [] as PositionSummary[] };
}

export async function fetchAllPositions(_opts: { keyword?: string; maxPages?: number; pageSize?: number } = {}) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, total: 0, fetched: 0, positions: [] as PositionSummary[] };
}

export async function fetchPositionDetail(postId: string) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, post_id: postId };
}

export async function fetchDictionaries() {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE };
}

export async function listNotices() {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, notices: [] as never[] };
}

export async function getNotice(noticeId: string) {
  return { ok: false as const, source: SOURCE, message: STUB_MESSAGE, notice_id: noticeId };
}

export async function findNoticesByQuestion(question: string, _opts: { questionTime?: string; topK?: number } = {}) {
  return { ok: false as const, source: SOURCE, question, message: STUB_MESSAGE, matches: [] as never[] };
}

export async function matchResume(text: string, _opts: { topN?: number; candidates?: number } = {}) {
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
