// Thin client for 百川智能 (Baichuan AI) recruiting portal.
//
// Portal: https://cq6qe6bvfr6.jobs.feishu.cn/baichuanzhaopin/
// Platform: Feishu Recruiting (ATSX) SaaS — same API surface as nio.ts / minimax.ts.
//
// ============================================================
// Discovery (2026-05):
//
//   www.baichuan-ai.com/          → Next.js SPA with no /careers or /jobs route
//                                   (the corporate site doesn't link to the portal)
//   baichuan.jobs.feishu.cn/      → 400 (no portal configured on the obvious slug)
//   baichuan-ai.jobs.feishu.cn/   → 404
//
//   The real portal lives on a randomized Feishu tenant slug:
//     cq6qe6bvfr6.jobs.feishu.cn/baichuanzhaopin/
//
//   Tenant: 百川智能 / "【百川智能】社会招聘官方网站-欢迎你的加入！"
//   Channel slug: "baichuanzhaopin" (the company PATH on the tenant)
//
//   This is the same multi-tenant ATSX pattern that MiniMax (vrfi1sk8a0)
//   uses — the company path is the portal-channel header.
//
// ============================================================
// PositionSummary field mapping (Feishu → canonical):
//   post_id       ← String(item.id)
//   title         ← item.title
//   project       ← item.job_category?.name ?? item.job_function?.name
//   recruit_label ← item.recruit_type?.name
//   bgs           ← ""  (not exposed in public search)
//   work_cities   ← city_list joined " / "  (city_info used as fallback)
//   apply_url     ← https://cq6qe6bvfr6.jobs.feishu.cn/baichuanzhaopin/position/${id}/detail

import { createAdapter } from "./feishu.js";
import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";

export { extractResumeSignals, scoreOverlap, checkResume };

export type { PositionSummary, SearchOptions } from "./feishu.js";

const _adapter = createAdapter({
  host: "cq6qe6bvfr6.jobs.feishu.cn",
  channel: "baichuanzhaopin",
  label: "Baichuan (百川智能)",
  applyUrlPrefix: "https://cq6qe6bvfr6.jobs.feishu.cn/baichuanzhaopin/position",
});

export const searchPositions = _adapter.searchPositions;
export const fetchAllPositions = _adapter.fetchAllPositions;
export const fetchPositionDetail = _adapter.fetchPositionDetail;
export const fetchDictionaries = _adapter.fetchDictionaries;
export const listNotices = _adapter.listNotices;
export const getNotice = _adapter.getNotice;
export const findNoticesByQuestion = _adapter.findNoticesByQuestion;
export const matchResume = _adapter.matchResume;
