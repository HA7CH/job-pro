// 寒武纪 (Cambricon) careers adapter — Moka SSR + AES-128-CBC pagination.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16 → 2026-05-20)
//
// www.cambricon.com embeds links to Moka tenant URLs in its 加入我们 section:
//
//   /campus-recruitment/cambricon/44201        ← campus + intern (main entry)
//   /social-recruitment/cambricon/1113         ← 社招 channel (probed
//                                                2026-05-20 directly against
//                                                /api/outer/ats-apply/website
//                                                /jobs/v2 with siteId:"1113"
//                                                — returns a populated AES
//                                                envelope, so the site exists
//                                                and has jobs; just wasn't
//                                                wired into the adapter)
//   /recommendation-recruitment/cambricon/42452  (referral channel, overlaps)
//   /recommendation-recruitment/cambricon/46261  (referral channel, overlaps)
//
// Same factory as `cli/src/moka.ts` (used by megvii / geely / etc.).
// Adding 1113 to `channels[]` lets the factory's social-channel routing
// pick it up automatically.

import { createAdapter } from "./moka.js";
import type { PositionScope } from "./adapter.js";

/**
 * Cambricon supports campus / social / intern / all (1.1.0+).
 *
 * Multi-channel Moka tenant: campus site (44201) + social site (1113).
 * The factory routes scope=social → 1113, scope=campus/intern → 44201,
 * scope=all → parallel fetch + merge. scope=undefined preserves 1.0.93
 * behaviour (campus site only, via `defaultRecruitType:"campus"`).
 */
export const supportedScopes = ["social", "campus", "intern", "all"] as const satisfies ReadonlyArray<PositionScope>;

const adapter = createAdapter({
  orgSlug: "cambricon",
  label: "Cambricon",
  channels: [
    { siteId: 44201, kind: "campus-recruitment", recruitType: "campus" },
    { siteId: 1113,  kind: "social-recruitment", recruitType: "social" },
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
