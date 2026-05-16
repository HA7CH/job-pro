// 海康威视 / Hikvision careers adapter — Liepin aggregator fallback.
//
// hr.hikvision.com is gated by Tencent EdgeOne which 403s any non-CN IP
// regardless of cookies. www.hikvision.com.cn has no public DNS A record
// outside Mainland China. There is no third-party ATS tenant.
//
// Until a CN-egress proxy path lands (set `JOB_PRO_HTTPS_PROXY` and see
// the historical CDP-driven adapter at `git log cli/src/hikvision.ts`),
// we surface real currently-open Hikvision positions by querying Liepin
// (api-c.liepin.com) filtered by compName="海康威视". See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as Hikvision's own portal.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "海康威视",
  label: "Hikvision / 海康威视",
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


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_hikvision } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_hikvision } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_hikvision } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "hikvision.com (via api-c.liepin.com)", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://hikvision.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "hikvision.com (via api-c.liepin.com)", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_hikvision({
      source: "hikvision.com (via api-c.liepin.com)",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: undefined,
      submitKind: "external",
      submitNotes:
        "Hikvision (Liepin-backed) — submission is recruiter-IM-mediated through Liepin. Open the apply_url to start the chat.",
    }),
  };
}
