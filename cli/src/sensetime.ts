// 商汤 (SenseTime) careers adapter for `job-pro`.
//
// ============================================================
// MIGRATION (re-probed 2026-07-11)
//
// hr.sensetime.com was a Beisen Wecruit (北森招聘云) tenant until mid-2026;
// the old `/wecruit/positionInfo/listPosition/<SU…>` endpoints now 404 and
// the SU channel pages are gone. The domain now serves a Feishu Hire
// (飞书招聘, atsx "saas-career") portal on a custom domain — same
// `POST /api/v1/search/job/posts` surface as *.jobs.feishu.cn, with two
// portal channels (`portal-channel` / `website-path` headers):
//
//   ""     → main site   = 社招 (72 positions at probe time)
//   "edu"  → campus site = 校招/实习 (128 positions at probe time)
//
// The empty-string channel is real: the main portal sends empty
// portal-channel headers. Campus jobs are NOT reachable from the main
// channel (recruitment_id_list ["201"] there returns 0), hence the
// dedicated campusChannel/internChannel below. Anonymous, no token.
// Note: the host sits behind an Aliyun WAF that briefly 405s bursts of
// rapid anonymous requests — back off and retry if that happens.
//
// See cli/src/feishu.ts for the shared factory.

import { createAdapter } from "./feishu.js";
import type { PositionScope } from "./adapter.js";

const adapter = createAdapter({
  host: "hr.sensetime.com",
  label: "SenseTime",
  channel: "",
  socialChannel: "",
  campusChannel: "edu",
  internChannel: "edu",
  applyUrlPrefix: "https://hr.sensetime.com/position",
  supportedScopes: ["social", "campus", "intern", "all"] as const,
});

export const supportedScopes: ReadonlyArray<PositionScope> = [
  "social",
  "campus",
  "intern",
  "all",
] as const;

export const searchPositions = adapter.searchPositions;
export const fetchAllPositions = adapter.fetchAllPositions;
export const fetchPositionDetail = adapter.fetchPositionDetail;
export const fetchDictionaries = adapter.fetchDictionaries;
export const listNotices = adapter.listNotices;
export const getNotice = adapter.getNotice;
export const findNoticesByQuestion = adapter.findNoticesByQuestion;
export const matchResume = adapter.matchResume;
export const checkResume = adapter.checkResume;
