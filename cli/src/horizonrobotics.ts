// 地平线 (Horizon Robotics) careers adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16 via puppeteer-core network capture)
//
// Horizon's careers run on `wecruit.hotjob.cn`, the same Beisen Wecruit
// stack as SenseTime (see cli/src/sensetime.ts). The `/{SU…}/pb/<channel>.html`
// SPA path returns nginx 405 on any anonymous POST. The real XHR is fired
// at the sibling `/wecruit/positionInfo/listPosition/{SU…}` route.
//
// Channels (probed 2026-05-16):
//   * school  — `SU6409ef49bef57c635fd390a6` (校园招聘 / 实习生) ~84 positions
//   * social  — `SU64819a4f2f9d2433ba8b043a` (社会招聘)            ~216 positions
//
// Anonymous, no token, no cookie. See cli/src/wecruit.ts for the shared
// factory: POST to `/wecruit/positionInfo/listPosition/{channelId}` with
// `application/x-www-form-urlencoded` body containing
// `isFrompb=true&recruitType=<1|2>&pageSize=N&currentPage=N`. Response is
// `{ data:{ pageForm:{ totalPage, pageData[…] } }, state:"200" }`.

import { createAdapter } from "./wecruit.js";

const adapter = createAdapter({
  host: "wecruit.hotjob.cn",
  label: "Horizon Robotics",
  channels: [
    {
      channelId: "SU6409ef49bef57c635fd390a6",
      recruitType: "campus",
      pagePath: "school",
    },
    {
      channelId: "SU64819a4f2f9d2433ba8b043a",
      recruitType: "social",
      pagePath: "social",
    },
  ],
});

export const supportedScopes = ["campus", "social", "all"] as const;

export const searchPositions = adapter.searchPositions;
export const fetchAllPositions = adapter.fetchAllPositions;
export const fetchPositionDetail = adapter.fetchPositionDetail;
export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
export const fetchApplicationSchema = adapter.fetchApplicationSchema;
