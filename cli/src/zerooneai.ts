// Thin client for 01.AI / 零一万物 recruiting portal.
//
// Portal: https://01ai.jobs.feishu.cn/
// Platform: Feishu Recruiting (ATSX) SaaS — same API surface as nio.ts / moonshot.ts.
//
// ============================================================
// Discovery (2026-05):
//
//   www.01.ai/                    → Strikingly site, links to portal
//   01ai.jobs.feishu.cn/index/    → Feishu ATSX, channel "index"
//                                    tenant "零一万物" / "社招官网"
//
//   The portal channel slug is "index" (not "social" / "campus") — the
//   tenant only configured one channel and it's named "index".
//
// ============================================================
// PositionSummary field mapping (Feishu → canonical):
//   post_id       ← String(item.id)
//   title         ← item.title
//   project       ← item.job_category?.name ?? item.job_function?.name
//   recruit_label ← item.recruit_type?.name
//   bgs           ← ""  (not exposed in public search)
//   work_cities   ← city_list joined " / "  (city_info used as fallback)
//   apply_url     ← https://01ai.jobs.feishu.cn/index/position/${id}/detail

import { createAdapter } from "./feishu.js";
import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";

export { extractResumeSignals, scoreOverlap, checkResume };

export type { PositionSummary, SearchOptions } from "./feishu.js";

/** Recruit scopes 01.AI can serve.
 *  The "index" channel is a single mixed pool that returns experienced and
 *  campus positions side-by-side (the tenant only configured one channel).
 *  All scopes go through the same query; the dispatcher accepts
 *  social/campus/all. */
export const supportedScopes = ["social", "campus", "all"] as const;

const _adapter = createAdapter({
  host: "01ai.jobs.feishu.cn",
  channel: "index",
  label: "01.AI (零一万物)",
  applyUrlPrefix: "https://01ai.jobs.feishu.cn/index/position",
  supportedScopes,
});

export const searchPositions = _adapter.searchPositions;
export const fetchAllPositions = _adapter.fetchAllPositions;
export const fetchPositionDetail = _adapter.fetchPositionDetail;
export const fetchDictionaries = _adapter.fetchDictionaries;
export const listNotices = _adapter.listNotices;
export const getNotice = _adapter.getNotice;
export const findNoticesByQuestion = _adapter.findNoticesByQuestion;
export const matchResume = _adapter.matchResume;
export const fetchApplicationSchema = _adapter.fetchApplicationSchema;
