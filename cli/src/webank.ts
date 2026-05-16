// 微众银行 (WeBank) careers adapter — Liepin aggregator fallback.
//
// WeBank's career page at www.webank.com/career/ is a 15KB static Vue
// brochure with no embedded job feed; recruitment runs through the
// 微众银行招聘 WeChat 公众号 → 微信小程序 chain. We surface real
// currently-open WeBank positions by querying Liepin
// (api-c.liepin.com) filtered by compName="微众银行". See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as WeBank's WeChat mini-program funnel.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "微众银行",
  label: "WeBank / 微众银行",
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
