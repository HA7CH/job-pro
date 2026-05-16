// 菜鸟 (Cainiao Network) careers adapter — Liepin aggregator fallback.
//
// Cainiao's own careers subdomains (campus / recruit / job.cainiao.com)
// resolve only on Alibaba-Group-internal DNS. Public-facing positions
// don't surface through the parent Alibaba feed either
// (`job-pro alibaba search 菜鸟` → total=0). We surface real
// currently-open Cainiao positions by querying Liepin
// (api-c.liepin.com) filtered by compName="菜鸟网络". See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as Cainiao's own portal.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "菜鸟网络",
  label: "Cainiao / 菜鸟",
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
