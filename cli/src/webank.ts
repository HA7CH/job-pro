// 微众银行 (WeBank) careers adapter — Liepin aggregator fallback.
//
// WeBank's career page at www.webank.com/career/ is a 15KB static Vue
// brochure with no embedded job feed; recruitment runs through the
// 微众银行招聘 WeChat 公众号 → 微信小程序 chain. We surface real
// currently-open WeBank positions by querying Liepin
// (api-c.liepin.com) filtered by compName="微众银行". See
// `cli/src/liepin.ts` for the shared factory.
//
// Source: api-c.liepin.com (`source` field on responses) — clearly NOT
// the same as WeBank's WeChat mini-program funnel.

import { createAdapter } from "./liepin.js";

const adapter = createAdapter({
  companyName: "微众银行",
  label: "WeBank / 微众银行",
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

import type { ApplyFormSchema as _ApplyFormSchema_webank } from "./apply.js";
import { buildBespokeApplySchema as _buildBespokeApplySchema_webank } from "./apply.js";

export async function fetchApplicationSchema(postId: string): Promise<
  { ok: true; schema: _ApplyFormSchema_webank } | { ok: false; source: string; message: string }
> {
  const id = (postId ?? "").trim();
  if (!id) return { ok: false, source: "webank.com (via api-c.liepin.com)", message: "post_id is required" };
  let title = "";
  let applyUrl = "https://webank.com";
  try {
    const detail = (await fetchPositionDetail(id)) as { ok?: boolean; title?: string; apply_url?: string; message?: string };
    if (detail?.ok === false) {
      return { ok: false, source: "webank.com (via api-c.liepin.com)", message: detail.message ?? "post not found" };
    }
    title = detail?.title ?? "";
    if (detail?.apply_url) applyUrl = detail.apply_url;
  } catch {}
  return {
    ok: true,
    schema: _buildBespokeApplySchema_webank({
      source: "webank.com (via api-c.liepin.com)",
      postId: id,
      jobTitle: title,
      applyUrl,
      submitEndpoint: undefined,
      submitKind: "external",
      submitNotes:
        "WeBank (Liepin-backed) — submission is recruiter-IM-mediated through Liepin. Open the apply_url to start the chat.",
    }),
  };
}
