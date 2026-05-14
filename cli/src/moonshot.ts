// Thin client for Moonshot AI (月之暗面 / Kimi) recruiting portal.
//
// Portal: https://moonshot.jobs.feishu.cn/
// Platform: Feishu Recruiting (ATSX) SaaS — same API surface as nio.ts / minimax.ts.
//
// ============================================================
// Endpoint inventory (probed 2026-05):
//
//   POST https://moonshot.jobs.feishu.cn/api/v1/search/job/posts
//   GET  https://moonshot.jobs.feishu.cn/api/v1/config/job/filters/social
//
//   Both return HTTP 200 + code:0 unauthenticated. The portal-channel
//   and website-path headers must be "social" (the only registered portal).
//
// ============================================================
// Portal discovery (2026-05):
//
//   moonshot.cn/careers        → bare nginx page (no portal)
//   kimi.moonshot.cn/careers   → 302 → kimi.com/careers → 302 → / (no portal)
//   moonshot.jobs.feishu.cn/   → Feishu ATSX, channel "social" ("Kimi社招官网")
//   moonshot.jobs.feishu.cn/campus/position → channel "campus" → code:0, count:0
//
//   The only active Feishu portal is the "social" channel.
//   Moka orgId 148507 (app.mokahr.com/campus-recruitment/moonshot/148507) exists
//   but is auth-gated — direct API calls return 404.
//
// ============================================================
// Current job count (probed 2026-05):
//
//   social channel:    count: 0  (API live, no published positions)
//   campus channel:    count: 0  (API live, no published positions)
//
//   The API is fully functional and returns the correct JSON envelope.
//   Moonshot appears to have temporarily unpublished all listings.
//   The adapter will return ok:true with an empty positions array until
//   they resume publishing; no code changes are needed when that happens.
//
// ============================================================
// PositionSummary field mapping (Feishu → canonical):
//   post_id       ← String(item.id)
//   title         ← item.title
//   project       ← item.job_category?.name ?? item.job_function?.name
//   recruit_label ← item.recruit_type?.name
//   bgs           ← ""  (not exposed in public search)
//   work_cities   ← city_list joined " / "  (city_info used as fallback)
//   apply_url     ← https://moonshot.jobs.feishu.cn/social/${id}/detail

import { createAdapter } from "./feishu.js";
import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";

export { extractResumeSignals, scoreOverlap, checkResume };

export type { PositionSummary, SearchOptions } from "./feishu.js";

const _adapter = createAdapter({
  host: "moonshot.jobs.feishu.cn",
  channel: "social",
  label: "Moonshot AI (Kimi)",
  applyUrlPrefix: "https://moonshot.jobs.feishu.cn/social/position",
});

export const searchPositions = _adapter.searchPositions;
export const fetchAllPositions = _adapter.fetchAllPositions;
export const fetchPositionDetail = _adapter.fetchPositionDetail;
export const fetchDictionaries = _adapter.fetchDictionaries;
export const listNotices = _adapter.listNotices;
export const getNotice = _adapter.getNotice;
export const findNoticesByQuestion = _adapter.findNoticesByQuestion;
export const matchResume = _adapter.matchResume;
