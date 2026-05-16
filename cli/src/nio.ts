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

import { createAdapter } from "./feishu.js";

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
});
