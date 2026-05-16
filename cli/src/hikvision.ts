// 海康威视 / Hikvision careers adapter — Liepin aggregator fallback.
//
// hr.hikvision.com is gated by Tencent EdgeOne which 403s any non-CN IP
// regardless of cookies. www.hikvision.com.cn has no public DNS A record
// outside Mainland China. There is no third-party ATS tenant.
//
// Until a CN-egress proxy path lands (set `JOB_PRO_HTTPS_PROXY` and see
// the historical CDP-driven adapter at `git log cli/src/hikvision.ts`),
// we surface real currently-open Hikvision positions by querying Liepin
// (api-c.liepin.com) filtered by compName="海康威视". See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as Hikvision's own portal.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "海康威视",
  label: "Hikvision / 海康威视",
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
