// 旷视科技 / Megvii / Face++ careers — Moka SSR + AES-128-CBC.
//
// Two portals on the same Moka tenant `megviihr`:
//   campus  → https://app.mokahr.com/campus_apply/megviihr/38642
//   social  → https://app.mokahr.com/social-recruitment/megviihr/38641
// Probed 2026-05; ~5 visible positions (Megvii hiring is currently low).
// See cli/src/moka.ts for the shared factory.

import { createAdapter } from "./moka.js";
import type { PositionScope } from "./adapter.js";

const adapter = createAdapter({
  orgSlug: "megviihr",
  label: "Megvii",
  channels: [
    { siteId: 38642, kind: "campus_apply", recruitType: "campus" },
    { siteId: 38641, kind: "social-recruitment", recruitType: "social" },
  ],
  defaultRecruitType: "social",
});

export const supportedScopes: ReadonlyArray<PositionScope> = ["campus", "social", "all"] as const;

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
