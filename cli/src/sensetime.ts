// 商汤 (SenseTime) careers adapter for `job-pro`.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16 via puppeteer-core network capture)
//
// hr.sensetime.com hosts a Beisen Wecruit (北森招聘云) tenant. The published
// SPA bundles at `/SU…/pb/<channel>.html` ALWAYS return nginx 405 on
// anonymous POST, regardless of headers; that path is GET-only at the LB.
//
// The SPA's real XHR target (uncovered by intercepting page traffic in a
// headless Chrome instance) is on a sibling `/wecruit/...` prefix:
//
//   POST https://hr.sensetime.com/wecruit/positionInfo/listPosition/<SU…>
//        ?iSaJAx=isAjax&request_locale=zh_CN&t=<unix-ms>
//
// Content-Type: application/x-www-form-urlencoded (NOT JSON)
// Body:         isFrompb=true&recruitType=2&pageSize=15&currentPage=1
//
// Anonymous, no token, no cookie, no captcha. Probed 2026-05-16: the
// social channel `SU60fa3bdabef57c1023fc1cbc` returns ~89 pages × 12 ≈
// 1068 active social-hire positions across SenseTime and its subsidiaries.
//
// hr.sensetime.com root redirects to the social channel (302); the campus
// SU referenced in earlier reconnaissance notes (`SU6710d7c21c240e54e1f82a1b`)
// has been reassigned to a different tenant ("安徽新华发行集团" appears in
// its responses), so we only wire the social channel. If SenseTime
// rebroadcasts a campus channel later, add it to the `channels` array.
//
// See cli/src/wecruit.ts for the shared factory.

import { createAdapter } from "./wecruit.js";

const adapter = createAdapter({
  host: "hr.sensetime.com",
  label: "SenseTime",
  channels: [
    {
      channelId: "SU60fa3bdabef57c1023fc1cbc",
      recruitType: "social",
      pagePath: "social",
    },
  ],
});

export const searchPositions = adapter.searchPositions;
export const fetchAllPositions = adapter.fetchAllPositions;
export const fetchPositionDetail = adapter.fetchPositionDetail;
export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
