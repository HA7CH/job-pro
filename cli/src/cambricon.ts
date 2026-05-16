// 寒武纪 (Cambricon) careers adapter — Moka SSR + AES-128-CBC pagination.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16)
//
// www.cambricon.com embeds links to Moka tenant URLs in its 加入我们 section:
//
//   /campus-recruitment/cambricon/44201        ← campus + intern (main entry)
//   /recommendation-recruitment/cambricon/42452  (referral channel, overlaps)
//   /recommendation-recruitment/cambricon/46261  (referral channel, overlaps)
//
// No /social-recruitment/cambricon/<siteId> URL is published — Cambricon
// only opens 校招 / 实习 publicly through Moka. Same factory as
// `cli/src/moka.ts` (used by megvii / geely / etc.).

import { createAdapter } from "./moka.js";

const adapter = createAdapter({
  orgSlug: "cambricon",
  label: "Cambricon",
  channels: [
    { siteId: 44201, kind: "campus-recruitment", recruitType: "campus" },
  ],
  defaultRecruitType: "campus",
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
export const fetchApplicationSchema = adapter.fetchApplicationSchema;
