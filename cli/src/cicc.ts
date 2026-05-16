// 中金 / CICC careers adapter — Liepin aggregator fallback.
//
// CICC's official careers portal (careers.cicc.com / cicc.com.cn) is
// Cloudflare-gated with HTTP 521 for non-CN IPs, returns 404 for crawlers,
// and has no third-party ATS (Moka / Beisen / Greenhouse) tenant. We
// surface real currently-open CICC positions by querying Liepin
// (api-c.liepin.com) filtered by compName="中金公司". See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as CICC's own portal. Callers can filter on this attribution
// if they only want first-party feeds.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "中金公司",
  label: "CICC / 中金",
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
