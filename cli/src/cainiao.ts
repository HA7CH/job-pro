// 菜鸟 (Cainiao Network) careers adapter — Liepin aggregator fallback.
//
// Cainiao's own careers subdomains (campus / recruit / job.cainiao.com)
// resolve only on Alibaba-Group-internal DNS. Public-facing positions
// don't surface through the parent Alibaba feed either
// (`job-pro alibaba search 菜鸟` → total=0). We surface real
// currently-open Cainiao positions by querying Liepin
// (api-c.liepin.com) filtered by compName="菜鸟网络". See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as Cainiao's own portal.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "菜鸟网络",
  label: "Cainiao / 菜鸟",
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

import type { ApplyFormSchema as _ApplyFormSchema_cainiao } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_cainiao } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_cainiao } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "cainiao.com (via api-c.liepin.com)", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://cainiao.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "cainiao.com (via api-c.liepin.com)", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_cainiao({
      source: "cainiao.com (via api-c.liepin.com)",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: undefined,
      submitKind: "external",
      submitNotes:
        "Cainiao (Liepin-backed) — submission is recruiter-IM-mediated through Liepin. Open the apply_url to start the chat.",
    }),
  };
}
