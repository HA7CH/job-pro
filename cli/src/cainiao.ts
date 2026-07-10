// 菜鸟 (Cainiao Network) careers adapter — Liepin aggregator fallback.
//
// Cainiao HAS public official career portals (jobs.cainiao.com /
// talent.cainiao.com, verified HTTP 200 in 2026-06), but they are
// JS-only React shells with no public JSON job feed we can enumerate.
// Public-facing positions don't surface through the parent Alibaba feed
// either (`job-pro alibaba search 菜鸟` → total=0). We surface real
// currently-open Cainiao positions by querying Liepin (api-c.liepin.com)
// filtered by compId=8488703 (浙江菜鸟供应链管理有限公司). See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as Cainiao's own portal.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "菜鸟网络",
  // Liepin company id + exact card compName (probed 2026-07-11:
  // https://www.liepin.com/company/8488703/). NB: cards carry the legal
  // name 浙江菜鸟供应链管理有限公司, NOT "菜鸟网络" — a compName string match
  // never hits, hence strict compId filtering in the factory.
  compId: 8488703,
  liepinCompName: "浙江菜鸟供应链管理有限公司",
  label: "Cainiao / 菜鸟",
  attribution:
    "via Liepin (api-c.liepin.com) — official portal (jobs.cainiao.com) is a JS-only SPA with no public JSON feed",
});

export const supportedScopes = adapter.supportedScopes;
export const searchPositions = adapter.searchPositions;
export const fetchAllPositions = adapter.fetchAllPositions;
export const fetchPositionDetail = adapter.fetchPositionDetail;
export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
