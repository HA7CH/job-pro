// Thin wrapper for 文远知行 (WeRide) careers, hosted on Lever.
//
// ============================================================
// Discovery notes (probed 2026-05):
//
//   Attempted endpoints:
//     https://career.weride.ai          — no public unauthenticated job API
//     https://weride.jobs.feishu.cn     — HTTP 400 (no Feishu portal)
//     https://weride.app.mokahr.com     — no Moka tenant
//
//   Live endpoint: https://api.lever.co/v0/postings/weride?mode=json
//     Lever slug: weride
//     Total positions: ~34 (probed 2026-05) — San Jose / Sunnyvale / Guangzhou
//                       autonomous-driving, perception, planning, robotics.
//
//   The Lever board includes both US and Guangzhou postings, scoped client-side
//   by the `cities` filter once the location field is populated upstream.

import { createAdapter } from "./lever.js";

const adapter = createAdapter({ slug: "weride", label: "WeRide" });

export const searchPositions = adapter.searchPositions;
export const fetchAllPositions = adapter.fetchAllPositions;
export const fetchPositionDetail = adapter.fetchPositionDetail;
export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
