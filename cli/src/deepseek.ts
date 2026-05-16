// DeepSeek (深度求索) / High-Flyer (幻方量化) careers — Moka SSR + AES-128-CBC.
//
// Portal: https://app.mokahr.com/social-recruitment/high-flyer/140576
// (High-Flyer is the parent quant fund; DeepSeek's careers share the
// same Moka tenant.) Probed 2026-05; ~37 social-hire positions.
// See cli/src/moka.ts for the shared factory.

import { createAdapter } from "./moka.js";

const adapter = createAdapter({
  orgSlug: "high-flyer",
  label: "DeepSeek / High-Flyer",
  channels: [
    { siteId: 140576, kind: "social-recruitment", recruitType: "social" },
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
export const fetchApplicationSchema = adapter.fetchApplicationSchema;
