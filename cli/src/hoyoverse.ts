// Thin wrapper for HoYoverse careers (miHoYo's international brand), hosted on Greenhouse.
//
// ============================================================
// Discovery notes (probed 2026-05):
//
//   Live endpoint: https://boards-api.greenhouse.io/v1/boards/hoyoverse/jobs
//     Greenhouse slug: hoyoverse
//     Tenant: HoYoverse (international operations of 米哈游 / miHoYo)
//     Total positions: ~28 (probed 2026-05) — Singapore / Montreal /
//                       Santa Monica game-dev, art, engineering, and ops.
//
//   Note: this is the international Greenhouse board. The China-side campus
//   board lives at https://campus.mihoyo.com (covered by the `mihoyo` adapter
//   as a stub since that SPA has no public unauthenticated JSON endpoint).

import { createAdapter } from "./greenhouse.js";

const adapter = createAdapter({ slug: "hoyoverse", label: "HoYoverse" });

export const searchPositions = adapter.searchPositions;
export const fetchAllPositions = adapter.fetchAllPositions;
export const fetchPositionDetail = adapter.fetchPositionDetail;
export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
