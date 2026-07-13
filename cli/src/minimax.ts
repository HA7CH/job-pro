// Thin adapter for MiniMax / MiniMax智能 recruiting via Feishu Recruiting (ATSX).
//
// MiniMax uses the Feishu multi-tenant portal with TWO portal channels
// (both linked from https://www.minimax.io/careers):
//   https://vrfi1sk8a0.jobs.feishu.cn/379481/  → 校招/实习 portal
//   https://vrfi1sk8a0.jobs.feishu.cn/index/   → 社招 portal ("Social Recruitment")
//
// API (probed 2026-05, re-probed 2026-07-11):
//   POST https://vrfi1sk8a0.jobs.feishu.cn/api/v1/search/job/posts
//        portal-channel "379481" → 77 posts (校招 正式 + 实习 mixed feed)
//        portal-channel "index"  → 190 posts (社招, all recruit_type 全职)
//   GET  https://vrfi1sk8a0.jobs.feishu.cn/api/v1/config/job/filters/<channel>
//        filters/379481 declares recruitment_type {id:"2", 校招} only;
//        filters/index  declares recruitment_type {id:"1", 社招/Experienced} only.
//
// ---- Critical discovery: multi-tenant portal-channel ----
// Unlike company-dedicated subdomains (e.g. nio.jobs.feishu.cn uses "campus"),
// multi-tenant portals use the SITE PATH as the portal-channel value.
// For MiniMax:
//   campus portal: portal-channel/website-path = "379481" (the company path)
//   social portal: portal-channel/website-path = "index"  (root site; the
//                  empty-string channel "" resolves to the same social pool)
// Using "campus" returns {"code":-9000003,"message":"site not exist"}.
//
// Field notes:
//   - job_function is null; project ← job_category.name
//   - city_info is null; work_cities ← city_list (may have multiple cities)
//   - Campus channel mixes 实习 and 正式 in one pool (recruitment_id_list
//     "201"/"202" splits them); social lives on its own channel entirely.
//
// apply_url patterns (re-probed 2026-07-14):
//   campus/intern → https://vrfi1sk8a0.jobs.feishu.cn/379481/position/<id>/detail
//   social        → https://vrfi1sk8a0.jobs.feishu.cn/index/position/<id>/detail
// Feishu returns HTTP 200 for the wrong portal too, but the rendered page says
// “该职位已下线”. The URL must therefore follow the channel that produced the
// job rather than relying on a single tenant-wide prefix.

import { createAdapter } from "./feishu.js";

/** Recruit scopes MiniMax can serve — all four.
 *  A 2026-05-21 probe of filters/379481 (校招 portal only) wrongly concluded
 *  the tenant had no 社招; the social pool actually lives on the sibling
 *  "index" portal-channel. Re-probed 2026-07-11: POST /api/v1/search/job/posts
 *  with portal-channel:index → code:0, count:190 (e.g. "Forward Deployed
 *  Engineer（前沿部署工程师）"); keyword=工程师 → count:68. Wired below as
 *  socialChannel so the factory swaps channels for --scope social instead of
 *  the recruitment_id_list=["101"] fallback (which returns 0 on 379481). */
export const supportedScopes = ["social", "campus", "intern", "all"] as const;

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
} = createAdapter({
  host: "vrfi1sk8a0.jobs.feishu.cn",
  channel: "379481",
  socialChannel: "index",
  label: "MiniMax / MiniMax智能",
  applyUrlPrefix: "https://vrfi1sk8a0.jobs.feishu.cn/379481/position",
  applyUrlPrefixByChannel: {
    index: "https://vrfi1sk8a0.jobs.feishu.cn/index/position",
  },
  supportedScopes,
});
