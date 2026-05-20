// 吉利汽车 (Geely Auto) careers adapter — Moka SSR + AES-128-CBC pagination.
//
// ============================================================
// API DISCOVERY (probed 2026-05-16)
//
// `job.geely.com` is a CNAME that 302-redirects to a Moka tenant:
//   https://app.mokahr.com/social-recruitment/geely/96123/
//
// (The `198.18.x` IP that `job.geely.com` resolves to is an Alibaba-Cloud
// front; the actual upstream is `app.mokahr.com`.) The SSR HTML at that
// URL embeds the standard Moka `<input id="init-data" value="…">` blob
// containing the first page of jobs + aesIv for AES-128-CBC pagination.
//
// Same factory as `cli/src/moka.ts` (used by megvii / cambricon / etc.).
// Only the social-recruitment channel is published publicly — no
// campus-recruitment URL is linked from the Geely corporate site.

import { createAdapter } from "./moka.js";
import type { PositionScope } from "./adapter.js";

const adapter = createAdapter({
  orgSlug: "geely",
  label: "Geely",
  channels: [
    { siteId: 96123, kind: "social-recruitment", recruitType: "social" },
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
