# Unblocking the remaining 4 stubs

Live count is **46 / 50**. This document is the feasibility log for the 4
adapters still in `KNOWN_LIMITED` (see `cli/test/smoke.ts`). The earlier
"10 stubs" / "7 stubs" matrix was successively cracked across iterations
2–4 via:

* iteration 2 (`6e22fba`) — Moka AES + Feishu tenant fixes + Beisen-iTalent
  → 13 unblocks
* iteration 3 (`d683a1f`) — Beisen Wecruit `/wecruit/...` form-urlencoded
  endpoint + Moka `geely` + bespoke `antgroup` → 3 unblocks
* iteration 4 (`aa2809d`) — `lilith` via runtime-driven Chrome
  (`puppeteer-core` + `cli/src/cdp.ts`) → 1 unblock

Reconnaissance dates: 2026-05-14 → 2026-05-16.

## Status matrix

| Adapter      | Block kind                                  | Tried                                                                             | Verdict       |
| ------------ | ------------------------------------------- | --------------------------------------------------------------------------------- | ------------- |
| `hikvision`  | CN-only geo-fence + Tencent EdgeOne 403     | hr.hikvision.com (.com.cn NXDOMAIN globally), Beisen / Moka / Feishu / Greenhouse / Lever / Workday — none provisioned. CDP via puppeteer reproduced the EdgeOne JS challenge but the upstream still returned 403 from a US egress. | needs CN proxy |
| `cicc`       | bank — no public job feed                   | careers.cicc.com / cicc.com.cn/cicc/zh/careers / cicc.com.cn/cicc/zh-cn/recruit → 521 Cloudflare blocks; Beisen / Moka / Greenhouse — no tenant; corporate landing page is a static brochure pointing to recruiter emails. | permanent     |
| `cainiao`    | Alibaba-Group-internal recruiting           | campus.cainiao.com / job.cainiao.com / recruit.cainiao.com → 198.18.x DNS sinkhole (private internal records). Public surface routes through Alibaba Group careers (`campus-talent.alibaba.com`) but `job-pro alibaba search "菜鸟"` returns total=0 — Cainiao roles aren't surfaced through the parent feed either. | permanent     |
| `webank`     | WeChat-only recruiting                      | career.webank.com / job.webank.com / hr.webank.com → ERR_TUNNEL_CONNECTION_FAILED (no public DNS records); no Beisen / Moka / Greenhouse tenant. Their `careers` SPA on www.webank.com is a 14KB static brochure with no embedded job feed; the recruitment funnel runs through the 微众银行招聘 WeChat 公众号 → 微信小程序 chain. | permanent     |

## Why iterations 2–4 worked and iteration 5 didn't

The breakthrough pattern was always the same:

1. **Find the third-party ATS the company uses** (Moka / Beisen Wecruit /
   Beisen iTalent / Feishu / Greenhouse / Lever).
2. **Mint the auth token the ATS expects**, either by replicating it
   server-side (most cases) or by driving a real Chrome session
   (`lilith`).

For the 4 remaining:

* `hikvision` IS on an ATS — but the JS challenge fronting it adds an
  IP-based check that no amount of puppeteer cleverness can bypass
  without a CN egress.
* `cicc` / `cainiao` / `webank` are not on any third-party ATS we can
  identify. They genuinely route applications through internal-DNS
  domains or WeChat mini-programs, where there's no read-only
  unauthenticated surface to scrape.

## Recommended next steps

1. **Hikvision: ship a CN-proxy recipe.** Add a `JOB_PRO_HTTPS_PROXY` env
   var that, when set, wires both `fetch()` and `puppeteer-core` through
   it. Document a known CN VPS-as-proxy setup in the README. The adapter
   logic itself is straightforward once the IP geo-fence is solved — the
   EdgeOne challenge resolves correctly in a real Chrome session.

2. **WeBank: build a WeChat mini-program scraper.** Out of scope for the
   CLI as currently shipped (we'd need a WeChat app harness). Useful as
   a separate `job-pro-wechat` extension package later.

3. **`cicc` / `cainiao`: mark as `permanently_no_public_api: true` in
   `KNOWN_LIMITED` and stop probing them.** Adding metadata that
   `pnpm test` can surface (e.g. "47 healthy / 1 needs-proxy /
   2 no-public-API / 0 broken") would more accurately describe the cap.

## CDP runtime — what it does and doesn't fix

`cli/src/cdp.ts` (added in iteration 4 for `lilith`) drives the user's
local Chrome via `puppeteer-core`. It solves:

* JS-computed anti-bot tokens (ByteDance Tengine `_signature`, Tencent
  EdgeOne cookie-set challenges).

It does NOT solve:

* IP geo-fences (the upstream gates on source IP regardless of cookies).
* Authentication walls (Alipay OAuth, WeChat mini-program login).
* Private DNS / network-internal hostnames.

For the 4 remaining, hikvision is the only one where CDP would help —
provided a CN-egress proxy were also supplied.
