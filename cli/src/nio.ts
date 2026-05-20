// Thin adapter for NIO / 蔚来 campus recruiting via Feishu Recruiting (ATSX).
//
// NIO self-hosts the Feishu Recruiting platform at:
//   https://nio.jobs.feishu.cn/
//
// API (probed 2026-05):
//   POST https://nio.jobs.feishu.cn/api/v1/search/job/posts
//        Headers: portal-channel: campus, portal-platform: pc, website-path: campus
//        Total: ~771 posts (正式/new-grad only; internship channel returns "site not exist")
//   GET  https://nio.jobs.feishu.cn/api/v1/config/job/filters/campus
//
// Field notes:
//   - job_category is null; project ← job_function.name
//   - city_info is null; work_cities ← city_list
//   - No internship channel (returns code -9000003 "site not exist")
//
// apply_url pattern: https://nio.jobs.feishu.cn/campus/position/<id>/detail
//
// ============================================================
// Social-hire probe (2026-05-20):
//   - `portal-channel: society` on /api/v1/search/job/posts → HTTP 405.
//   - `portal-channel: social` → HTTP 405.
//   - `portal-channel: experienced` → HTTP 405.
//   - `portal-channel: campus` + `recruitment_id_list:["101"]` → HTTP 405
//     (recruitment_id 101 for social is not provisioned on this tenant;
//     the campus channel itself works fine from a real browser).
// NIO publishes social hires through a separate stack
// (apps.nio.com/recruit/, login-gated). Mark social as unsupported.

import { createAdapter } from "./feishu.js";
import type { PositionScope } from "./adapter.js";

/**
 * NIO supports campus / intern / all only (1.1.0+).
 *
 * Tested 2026-05-20: every social-channel probe (`portal-channel: society
 * | social | experienced`, plus `recruitment_id_list:["101"]` on the
 * campus channel) returned HTTP 405. NIO's social-hire feed lives on a
 * different stack (apps.nio.com/recruit/, login-gated). The factory still
 * routes campus/intern via `recruitment_id_list` on the same channel.
 */
export const supportedScopes = ["campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

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
  host: "nio.jobs.feishu.cn",
  channel: "campus",
  label: "NIO / 蔚来",
  applyUrlPrefix: "https://nio.jobs.feishu.cn/campus/position",
  // supportedScopes is exported standalone (above) so the dispatcher sees it.
  // We do not pass it to the factory here because worktree B (Feishu factory
  // --scope plumbing) may not have merged yet; the standalone export is the
  // authoritative declaration per design doc §2.2.
});
