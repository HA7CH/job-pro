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


// ---------- Phase 2: fetchApplicationSchema ----------

import type { ApplyFormSchema as _ApplyFormSchema_cicc } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_cicc } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_cicc } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "cicc.com (via api-c.liepin.com)", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://cicc.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "cicc.com (via api-c.liepin.com)", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_cicc({
      source: "cicc.com (via api-c.liepin.com)",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: undefined,
      submitKind: "external",
      submitNotes:
        "CICC (Liepin-backed) — submission is recruiter-IM-mediated through Liepin. Open the apply_url to start the chat.",
    }),
  };
}
