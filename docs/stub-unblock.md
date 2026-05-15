# Unblocking the remaining 10 stubs

Live count is **40 / 50** after the `iflytek` upgrade in `7cad44d`. This
document is the feasibility log for the 10 adapters still in `KNOWN_LIMITED`
(see `cli/test/smoke.ts`). Reconnaissance dates: 2026-05-14 → 2026-05-16.

## Status matrix

| Adapter           | Block kind                            | Lowest-cost path           | Cost / risk |
| ----------------- | ------------------------------------- | -------------------------- | ----------- |
| `sensetime`       | nginx 405 on Beisen PushB anon POST   | CDP (puppeteer-core)       | medium      |
| `horizonrobotics` | nginx 405 on Beisen PushB anon POST   | CDP (puppeteer-core)       | medium      |
| `hikvision`       | geo-block (CN-only) on `hr.hikvision` | CN proxy + CDP             | high        |
| `antgroup`        | Alipay OAuth on every endpoint        | Browser extension (cookie) | high        |
| `webank`          | recruits via WeChat mini-program only | Browser extension (cookie) | high        |
| `geely`           | careers subdomains DNS-only-internal  | Browser extension (cookie) | high        |
| `cambricon`       | careers subdomains DNS-only-internal  | Browser extension (cookie) | high        |
| `lilith`          | Feishu Tengine WAF 405 on anon POST   | CDP (puppeteer-core)       | medium      |
| `cainiao`         | careers subdomains DNS-only-internal  | Redundant — use `alibaba`  | impossible  |
| `cicc`            | bank — no public unauthenticated API  | None                       | impossible  |

## Why anonymous HTTP doesn't crack the 10

* **Beisen PushB (`/{SU…}/pb/positionInfo/listPosition/{SU…}`)** — the API path
  is rejected by nginx with `405 Not Allowed` for every POST regardless of
  headers (UA, Origin, Referer, SERVERID cookie, Sec-Fetch-* all tried).
  This is upstream-blocked at the LB edge; no backend ever sees the request.
  Used by `sensetime` and `horizonrobotics`. The SPA's own POST evidently
  routes through some non-public path (suspected: a separate API host
  prefixed in axios baseURL at runtime). Repro: see header probes in
  `cli/src/sensetime.ts` and `cli/src/horizonrobotics.ts`.

* **Feishu Tengine WAF (`lilithgames.jobs.feishu.cn/api/v1/search/job/posts`)** —
  returns `405` from Tengine with `x-tt-trace-tag: id=03`, the classic
  ByteDance edge rejection. Same WAF as some other Feishu tenants we've
  successfully crossed, but Lilith's path is specifically flagged. The
  marketing page at `jobs.lilith.com` is purely a static SPA loading its
  recruiting widget from a different (TBD) backend.

* **Geo-block** — `hr.hikvision.com` and the campus subdomain resolve over
  public DNS but every TCP connect from non-CN ASNs is silently dropped.
  Probed from a US client, response: timeout. No bypass without a real CN
  egress; the SPA itself would not work without one either.

* **OAuth required** — `talent.antgroup.com` and `career.webank.com` both
  put every read endpoint behind a session cookie that's only obtainable
  after Alipay (or WeChat for WeBank) OAuth, with mobile-OTP step. No
  anonymous tokens exist; this is structural.

* **DNS-walled subdomains** — `campus.cainiao.com`, `career.geely.com`,
  `*.cambricon.com` simply don't have public A records (they resolve only
  on the company's internal DNS). Public marketing sites for these brands
  exist but expose no jobs JSON; recruiting flows go through WeChat
  official accounts or 3rd-party boards (BOSS Zhipin, 牛客网, 实习僧).

* **No public API** — `cicc.com` (中金) is a bank; the security posture is
  intentional. Their corporate careers page is a static brochure that
  links to recruiter emails. Same logic with `cainiao` (Alibaba Group
  funnels every public Cainiao role through `campus-talent.alibaba.com`,
  already covered by the `alibaba` adapter).

## CDP fallback proposal

> *Status: design only — not implemented yet.*

For the four "needs CDP" entries (`sensetime`, `horizonrobotics`, `lilith`,
optionally `hikvision`), add an opt-in browser-driven path. Design:

1. Add `puppeteer-core` as an **optional peer dependency** (not a runtime
   dependency — keeps the `npm i -g job-pro` install fast for the 80% of
   users who only need anonymous adapters).
2. New module `cli/src/cdp.ts` exposes `createCdpAdapter({ entryUrl,
   waitForSelector, extractFn })` that:
   * Launches the user's local Chrome/Edge via `puppeteer-core.connect`
     to a `--remote-debugging-port=9222` instance.
   * Navigates to the SPA, waits for the job-list selector, runs the
     extractor in page context, returns the canonical PositionSummary[].
   * Falls through to the existing stub message if puppeteer isn't
     available, so the smoke suite still passes.
3. CLI flag `--use-browser` opts a command into CDP mode (default off).
4. Document the one-time `chrome --remote-debugging-port=9222 --user-data-dir=/tmp/jpcdp`
   setup in `README.md` once the feature lands.

Why not headless puppeteer (no `connect`)? Two reasons:
* SenseTime / Horizon Robotics ship anti-bot challenges that fail in
  vanilla headless Chrome. Connecting to the user's real, logged-in
  browser sidesteps that.
* The Alipay / WeChat OAuth flows for `antgroup` / `webank` are only
  possible inside a logged-in session, which `connect` preserves.

Cost estimate: 1 day for the cdp.ts factory + 1 adapter (sensetime), 0.5
day each for the next two adapters. Total ≈ 2 days for 3 unblocks.

## Browser-extension proposal

> *Status: design only — not implemented yet.*

For the `antgroup` / `webank` OAuth-walled set, CDP-`connect` alone isn't
enough: the user still needs to be logged in. A small MV3 extension can:

1. Wait for the user to navigate to `talent.antgroup.com` / `career.webank.com`
   in their normal browsing.
2. Background script registers a `webRequest` listener on the careers API
   endpoints, captures the session cookie + CSRF header values.
3. Exports the captured tokens to a local file (`~/.jobpro/<company>.cookie.json`)
   that the CLI's adapter reads.
4. CLI's adapter switches from "stub" mode to "use captured cookie" mode
   when the file exists.

This stays **pull-based** (user explicitly visits the careers site → CLI
gets enabled), so we don't touch credentials we shouldn't.

Cost estimate: 2 days for the extension + 1 day to wire the cookie-reading
into one adapter (antgroup). Plus Chrome Web Store review if we publish it
(or self-load via `chrome://extensions`).

## Recommended order of work

1. **`lilith`** — explore `jobs.lilith.com` more (Vue data may be JSON-loaded
   from a sibling host). Probably the easiest of the four CDP candidates;
   maybe still anon-doable.
2. **CDP factory + `sensetime` proof-of-concept** — once the factory works,
   `horizonrobotics` falls quickly.
3. **`hikvision`** — needs CN egress; defer until we have a paid Chinese
   VPS in the CI pipeline.
4. **Browser-extension spike for `antgroup`** — separate npm package,
   `job-pro-extension`. Different release cadence.
5. Mark `cicc`, `cainiao` as permanent stubs in `KNOWN_LIMITED`.

That order also keeps each iteration of `/ralph-loop` independent: each step
unlocks 1–2 adapters, smoke test verifies, commit.

## Adapter quality follow-ups for the existing 40 live

(Surfaced by code-review subagent in the previous milestone, still open.)

* XPeng / WeRide / HoYoverse cover the **international Greenhouse / Lever
  boards**, not their China-side recruiting. CLI HELP for these three
  should call out the geo caveat. `cli/src/index.ts` HELP text was partly
  updated; sweep the other two next round.
* README.md roadmap matrix has only 5 rows. Either expand to 50 or replace
  with a link to job.ha7ch.com.
* `docs/auto-apply.md` tracking matrix lists 3 companies; needs to be
  rewritten or scoped down to "Phase 2 starts here".
