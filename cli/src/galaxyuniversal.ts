// 银河通用 / Galaxy Universal (Galbot) careers — Moka SSR + AES-128-CBC.
//
// Portal: https://app.mokahr.com/social-recruitment/yinhetongyong/165929
// Probed 2026-05; ~121 social-hire positions.
// See cli/src/moka.ts for the shared factory.

import { createAdapter } from "./moka.js";
import type { PositionScope } from "./adapter.js";

const adapter = createAdapter({
  orgSlug: "yinhetongyong",
  label: "Galaxy Universal",
  channels: [
    { siteId: 165929, kind: "social-recruitment", recruitType: "social" },
  ],
  defaultRecruitType: "social",
});

export const supportedScopes: ReadonlyArray<PositionScope> = ["social", "all"] as const;

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
