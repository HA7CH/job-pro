// Thin adapter for MiniMax / MiniMax智能 campus recruiting via Feishu Recruiting (ATSX).
//
// MiniMax uses the Feishu multi-tenant portal. Their career page is:
//   https://vrfi1sk8a0.jobs.feishu.cn/379481/
//   (linked from https://www.minimax.io/careers)
//
// API (probed 2026-05):
//   POST https://vrfi1sk8a0.jobs.feishu.cn/api/v1/search/job/posts
//        Total: ~83 posts (intern + full-time combined; no separate channel scoping)
//   GET  https://vrfi1sk8a0.jobs.feishu.cn/api/v1/config/job/filters/379481
//
// ---- Critical discovery: multi-tenant portal-channel ----
// Unlike company-dedicated subdomains (e.g. nio.jobs.feishu.cn uses "campus"),
// multi-tenant portals use the COMPANY PATH as the portal-channel value.
// For MiniMax (path "379481"):
//   portal-channel: "379481"   ← NOT "campus"
//   website-path:   "379481"   ← NOT "campus"
// Using "campus" returns {"code":-9000003,"message":"site not exist"}.
//
// Field notes:
//   - job_function is null; project ← job_category.name
//   - city_info is null; work_cities ← city_list (may have multiple cities)
//   - Recruit types include both 实习 and 正式 in the same pool (no channel split)
//
// apply_url pattern: https://vrfi1sk8a0.jobs.feishu.cn/379481/position/<id>/detail

import { createAdapter } from "./feishu.js";

/** Recruit scopes MiniMax can serve.
 *  Probed 2026-05-21: /api/v1/config/job/filters/379481 declares exactly one
 *  recruitment_type — {id:"2", name:"校招"}. Posts label themselves 正式 or
 *  实习 in the mixed feed, but there is no 社招/Experienced top-level type on
 *  this tenant; the factory's social fallback (recruitment_id_list=["101"])
 *  returns 0 unconditionally. Drop social so dispatcher fail-fasts. */
export const supportedScopes = ["campus", "intern", "all"] as const;

export const {
  searchPositions,
  fetchAllPositions,
  fetchPositionDetail,
  fetchDictionaries,
  listNotices,
  getNotice,
  findNoticesByQuestion,
  matchResume,
  checkResume,
  fetchApplicationSchema,
} = createAdapter({
  host: "vrfi1sk8a0.jobs.feishu.cn",
  channel: "379481",
  label: "MiniMax / MiniMax智能",
  applyUrlPrefix: "https://vrfi1sk8a0.jobs.feishu.cn/379481/position",
  supportedScopes,
});
