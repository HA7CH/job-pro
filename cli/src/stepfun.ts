// 阶跃星辰 / StepFun careers — Moka SSR + AES-128-CBC.
//
// Portal: https://app.mokahr.com/social-recruitment/step/94904
// Probed 2026-05; ~79 social-hire positions.
// See cli/src/moka.ts for the shared factory.

import { createAdapter } from "./moka.js";

const adapter = createAdapter({
  orgSlug: "step",
  label: "StepFun",
  channels: [
    { siteId: 94904, kind: "social-recruitment", recruitType: "social" },
  ],
  defaultRecruitType: "social",
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
