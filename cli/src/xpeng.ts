// Thin wrapper for 小鹏汽车 (XPeng Motors) careers, hosted on Greenhouse.
//
// ============================================================
// Discovery notes (probed 2026-05):
//
//   Attempted endpoints:
//     https://career.xiaopeng.com           — 000 (DNS / connection refused)
//     https://job.xiaopeng.com              — 000 (DNS / connection refused)
//     https://xpeng.jobs.feishu.cn          — HTTP 400 (no portal configured)
//     https://xpeng.app.mokahr.com          — no Moka tenant
//
//   Live endpoint: https://boards-api.greenhouse.io/v1/boards/xpengmotors/jobs
//     Greenhouse slug: xpengmotors
//     Tenant: XPENG (US AI / autonomous-driving R&D operation)
//     Total positions: ~29 (probed 2026-05) — mostly San Jose / Santa Clara
//                       interns and AI / data / autonomous-driving roles.
//
// ============================================================
// This adapter covers XPeng's US / international Greenhouse board only.
// The China-side campus / social board hosted on careers.xiaopeng.com is
// not publicly reachable from outside their network at the moment, but
// when it becomes accessible a sibling adapter can be added.

import { createAdapter } from "./greenhouse.js";

const adapter = createAdapter({ slug: "xpengmotors", label: "XPeng" });

export const searchPositions = adapter.searchPositions;
export const fetchAllPositions = adapter.fetchAllPositions;
export const fetchPositionDetail = adapter.fetchPositionDetail;
export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
