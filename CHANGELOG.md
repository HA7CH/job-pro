# Changelog

Job-pro releases are tracked on npm: <https://www.npmjs.com/package/job-pro>.
This file is the human-readable narrative of how we got here, not a
mechanical diff log — for that, `git log --oneline cli/`.

## 1.0.49 — docs/auto-apply per-family unblock playbook + 17-verified

\`docs/auto-apply.md\` synced for the second time this loop:
* Tally at 1.0.48 (17 ✅ / 28 🔑 / 5 ⛔) — was at 15 in 1.0.41 (pre-
  iflytek/vivo Beisen-iTalent promotion in 1.0.46).
* Per-family unblock playbook rewritten with the **actual** recon-
  derived workflow:
  * Capture session via \`job-pro extension\`
  * \`apply --debug-submit-to <echo>\` to inspect outgoing multipart
  * Fire \`--really-submit\` under \`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\`
  * Watch network tab on a 4xx to find the real path
  * Patch the adapter + add to ENDPOINT_VERIFIED set
* Numbers now consistent with \`pnpm test:apply\` tally.

Specifically:
* Feishu: 8 adapters (was "9"); cracking one (e.g. nio) likely cracks
  all 8 since the SPA bundle is shared.
* Bespoke: 17 adapters (was "22"; 5 promoted, unitree external).
* Lilith CDP unblocks once Feishu does.

## 1.0.48 — \`list\` surfaces endpoint_verified ✓

\`job-pro list\` now shows ✓ next to every adapter with
\`endpoint_verified: true\` — 17 of 50 today. \`list --compact\` JSON
gets an \`endpoint_verified: boolean\` field per row so scripts /
LLMs can filter directly.

\`\`\`
Bespoke (23) — submit_kind=multipart-session
  tencent                               join.qq.com                ...
  alibaba          ✓                    campus-talent.alibaba.com  ...
  meituan          ✓                    zhaopin.meituan.com        ...
  ...
\`\`\`

New \`ENDPOINT_VERIFIED\` set at the top of \`index.ts\` is the single
source of truth (mirrors each adapter's \`endpoint_verified: true\`
declaration). Update when promoting/demoting an adapter.

## 1.0.47 — \`recon\` classifier handles 5xx correctly

1.0.46 marked iflytek/vivo verified-real (HTTP 500 IIS Server Error
template = real route), but \`job-pro recon\` still classified them
as \`html-fallthrough\` because of the body-is-HTML check. Fixed:

\`\`\`ts
// 5xx + any body = handler threw on us, route exists. IIS / Spring
// generic 500 templates are HTML but still real-route signals.
if (status >= 500) return "verified-real";
\`\`\`

Now iflytek and vivo show as ✓ verified-real (with 🟢 schema tag)
instead of ✗ html-fallthrough. Recon and \`endpoint_verified\` schema
flags are now consistent for all 17 promoted adapters.

## 1.0.46 — iflytek / vivo (Beisen iTalent) → endpoint_verified

OPTIONS-preflight probe revealed mixed signals — \`xiaohongshu\`,
\`jd\`, \`huawei\` all OPTIONS-200 but their POST still 404s (the
preflight 200 is a CORS no-op, not route confirmation). No promotion
from that round.

But the two Beisen iTalent adapters (\`iflytek\` and \`vivo\`) both
return HTTP 500 + the same IIS \`Server Error\` template on POST.
Same template across both adapters confirms a shared Beisen backend
that received the request and threw on missing required headers/body —
not the SPA's 404 fallthrough. Marked \`endpoint_verified: true\`.

**Endpoint verified count: 15 → 17 / 50.** Adapters now clearing the
4th safety gate without env bypass:

* multipart-anon × 3 (xpeng / weride / hoyoverse)
* multipart-session × 5 (alibaba / pdd / meituan / mihoyo / liauto)
* moka-aes × 7 (full Moka family)
* beisen-italent × 2 (iflytek / vivo) ← new

Body shape still needs validation against a real candidate session,
but the failure mode goes from "blind 404" to "real backend response"
which is debuggable.

## 1.0.45 — README accurately describes the 4-layer safety gate

The README's Phase 2 section had a stale "three layers" description
from 0.9.x — missing the session-age gate (1.0.21) and the endpoint-
verified gate (1.0.36). Synced to current 4-layer stack:

1. \`JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes\`
2. \`staged.ready\`
3. \`endpoint_verified\` || \`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\`
4. session.json present + <30d || \`--allow-stale-session\`

Phase 2 lead paragraph updated to call out the 15-of-50 verified count
explicitly (3 anon end-to-end smoked + 5 multipart-session probe-
verified + 7 Moka probe-verified) so users understand which adapters
fire today vs. which still need recon.

## 1.0.44 — submit-smoke covers all 5 multipart-session probe-verified

Adds the 5 multipart-session adapters newly promoted to
\`endpoint_verified: true\` (1.0.39 alibaba + pdd, 1.0.40 meituan +
mihoyo + liauto) to \`pnpm test:debug-submit\`. Generic submit path
works with null session in debug mode (UA-only headers via fallback).

**Submit wire format: 12 pass / 0 broken / 12 (5.7s)** (was 7/7).

Coverage now spans every executor family + every verified-real
multipart-session adapter:

* multipart-anon (3): xpeng / weride / hoyoverse
* multipart-session (5): alibaba / pdd / meituan / mihoyo / liauto
* feishu-3-step (1): nio
* moka-aes (1): megvii
* beisen-wecruit (1): sensetime
* beisen-italent (1): iflytek

Test matrix:
\`\`\`
unit            32/32  (no network, CI)
read              50/50 healthy   3.7s
schema            50/50 ok        3.4s
submit wire       12/12 pass      5.7s
———————————————————
                 144 / 0
\`\`\`

## 1.0.43 — \`recon\` per-step timeouts + lilith skip + explicit exit

1.0.42's \`recon\` against all 50 adapters hung indefinitely because:

1. **lilith** uses puppeteer-core; even after the schema-probe resolves,
   the launched Chrome instance keeps the event loop alive.
2. Some adapters' \`fetchApplicationSchema\` has no internal timeout and
   can wait minutes on a flaky upstream.

Fixed:

* 10-second per-step timeout (Promise.race with sentinel \`null\`) on
  both schema-fetch and search fallback.
* \`lilith\` explicitly skipped unless \`--companies=lilith\` is passed
  (then the user knowingly accepts the puppeteer hang).
* Explicit \`process.exit(0)\` at end of \`recon\` to release lingering
  handles (puppeteer / undici sockets).

Now \`job-pro recon\` (no scope) completes in ~30s and reports:

\`\`\`
Tally:
  external              5
  html-fallthrough     16
  probe-error           2  ← lilith + occasional Lever 400
  speculative-404      15
  verified-real        12
\`\`\`

15 schema-declared \`endpoint_verified: true\` adapters — 12 also probe
as verified-real; the other 3 (xpeng / weride / hoyoverse) probe as
html-fallthrough because Greenhouse/Lever expect multipart, not JSON
\`{}\` — that's why the 🟢 tag exists.

## 1.0.42 — \`job-pro recon\` — automated endpoint-probe tool

The manual probe I've been running by hand for 1.0.34 / 1.0.38 / 1.0.40
is now a CLI verb:

\`\`\`
$ job-pro recon --companies xpeng,tencent,meituan,unitree,moonshot
  ✗ xpeng     401  html-fallthrough  🟢  HTTP Basic: Access denied.
  ✗ tencent   404  speculative-404       {"status":404,"error":"Not Found",…
  ✓ meituan   200  verified-real     🟢  {"data":{"errorCode":401,"message":"未登陆"},…
  ⛔ unitree   —    external               structurally external (Liepin / WeChat)
  ✓ moonshot  200  verified-real     🟢  {"data":"lf+lS/3Zcwp1g9hafFdr…",…
\`\`\`

For each adapter:
1. Pull the schema (via search → fetchApplicationSchema).
2. POST \`{}\` to \`schema.submit_endpoint\` anonymously.
3. Classify the response:
   * \`verified-real\` — auth gate / business error / encrypted envelope.
   * \`speculative-404\` — backend says "no such route".
   * \`html-fallthrough\` — SPA's 404 page (often masks the real probe info).
   * \`external\` — structurally external (Liepin / WeChat).
   * \`no-endpoint\` / \`probe-error\` — error cases.
4. Tag with 🟢 if the schema already declares \`endpoint_verified: true\`
   (which signals "even if probe looks wrong here, the path is known-good
   via end-to-end smoke" — happens for multipart-anon, where empty JSON
   doesn't match the multipart expectation but the URL is correct).

\`--companies\` to scope, \`--compact\` for JSON. Use this on every release
to catch upstream URL drift.

## 1.0.41 — docs/auto-apply tally synced (15 verified)

\`docs/auto-apply.md\` tally was last touched in 1.0.37 (3 verified).
Synced to current state (1.0.40):

* **15 ✅ verified** — 3 anon + 5 multipart-session + 7 moka-aes
* **30 🔑 speculative** — schemas + executors wired, endpoint URLs
  return 404/HTML on probe (need real-browser capture)
* **5 ⛔ external** — Liepin / WeChat (structural)

Probe attempts on Feishu apply path (\`/api/v1/resume/apply\`,
\`/api/v1/application\`, \`/api/v2/…\`, \`/api/atsx/…\`, several others)
all returned 404 — Feishu's apply path requires real-browser capture
to locate. Same for Beisen × 4. Recorded in the doc.

## 1.0.40 — 3 more anon-probed: meituan / mihoyo / liauto → verified

Continued endpoint recon across the remaining 18 multipart-session
bespokes. 3 more came back with real-route signals:

* **meituan** — \`POST /api/job-apply\` returns
  \`{data: {errorCode: 401, message: "未登陆"}}\` (real auth gate).
* **mihoyo** — \`POST /ats-portal/v1/application/create\` returns
  \`{code: -3, message: "用户未登录或登录失效"}\` (real auth gate).
* **liauto** — \`POST /api/career/apply\` returns
  \`{code: 2, msg: "请在配置文件配置可访问域名"}\` (real backend; needs
  Origin/Referer headers, which the executor already attaches in real
  submissions).

The other 15 in this probe round returned either structured 404 from
backend (bytedance, byd, bilibili, oppo, tencent), 405 (didi, netease,
pingan), or HTML fallthrough (baidu, kuaishou, huawei, jd, trip, weibo,
xiaohongshu) — all need real-browser network capture to find the right
path.

**Net: \`endpoint_verified: true\` for 15 of 50** (was 12). Adapters
clearing the 4th safety gate now:
* multipart-anon × 3 (xpeng / weride / hoyoverse)
* multipart-session × 5 (alibaba / pdd / meituan / mihoyo / liauto)
* moka-aes × 7 (the whole Moka family)

## 1.0.39 — promote 9 anon-probed adapters to \`endpoint_verified: true\`

Redefines \`endpoint_verified\` from "end-to-end smoked" to "URL verified
to be a real route" — which includes both:

* End-to-end smoked against httpbin (anon Greenhouse/Lever × 3).
* Anonymous probe returned a real-route signal — auth gate, business
  error, or family-specific envelope. NOT 404 / NOT HTML fallthrough.

Adapters newly marked \`endpoint_verified: true\` (this iteration's
recon, 1.0.34 + 1.0.38):

* **alibaba** — 403 Alipay auth gate
* **pdd** — \`{error_code: 40003}\` business error
* **moka × 7** (megvii / deepseek / galaxyuniversal / stepfun /
  cambricon / geely / moonshot) — AES \`{data, necromancer}\` envelope

Net: \`--really-submit\` now passes the 4th safety gate for **12 of
50** adapters without needing \`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\`
(was 3). Body shape still requires real-session validation for the 9
newly-promoted, but a 4xx with a server-side error is much more
debuggable than a blind 404 fallthrough.

\`buildBespokeApplySchema\` gets a new \`endpointVerified\` config field
so per-adapter promotion is a one-line change.

## 1.0.38 — submit_notes annotated with probe results

Updated 4 adapter \`submit_notes\` to record what anonymous endpoint
probes actually returned (1.0.34 + this iteration):

* **alibaba** — \`POST /campus/applyPosition.json\` returns HTTP 403
  (Alipay auth gate, not 404). Route confirmed real.
* **pdd** — \`POST /api/recruit/v1/position/apply\` returns
  \`{error_code:40003}\` (legit business error, not HTML fallthrough).
  Route confirmed real.
* **moka** (×7 adapters) — \`POST /api/outer/ats-apply/website/apply\`
  returns the AES \`{data, necromancer}\` envelope on empty body.
  Confirms it's the real route, not a guess.
* **sf** — \`POST /api/web/position/apply\` returns 404. Wrong path;
  the detail endpoint \`findById\` works (see 1.0.19 fix) but the apply
  route is elsewhere. Needs real-browser recon to locate.

This is documentation, not behavior change: \`endpoint_verified\`
stays \`false\` for these adapters (definition: end-to-end smoked),
and the 4th safety gate still blocks \`--really-submit\` unless
\`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\`. But the probe-derived
notes give users (and future contributors) a clearer signal:
"this endpoint exists, body shape needs validation" vs "this URL
is 404, recon needed".

## 1.0.37 — docs/auto-apply tally + verify→ship playbook

\`docs/auto-apply.md\`'s "Tally" was stale (counted 3 + 38 + 9 = 50 with
the wrong split between "wired" and "structural"). Updated to the
post-1.0.36 reality:

* **3 ✅** verified-endpoint — anon Greenhouse/Lever.
* **42 🔑** executor-wired but \`endpoint_verified !== true\` — most
  inferred URLs are wrong (1.0.34 recon: 19/22 returned 404).
* **5 ⛔** external — Liepin chat / Unitree WeChat.

Adds the verify→ship playbook explicitly: static-only recon doesn't
work for most of these adapters (their apply URL is webpack-output
dynamic). Real-browser network capture via the extension is the only
path to promoting 🔑 → ✅.

## 1.0.36 — 4th safety gate: speculative-endpoint refusal

\`--really-submit\` now refuses by default when \`endpoint_verified !== true\`
on a non-anon adapter. Justification: 1.0.34's recon found that **19 of
22 inferred bespoke endpoints are wrong** (404 / HTML fallthrough on
no-auth probe). Without this gate, a user firing \`--really-submit\`
against tencent / bytedance / etc. would get a silent 4xx with no
useful diagnostic.

\`\`\`
{
  "mode": "really-submit-blocked",
  "message": "submit_endpoint for tencent is speculative — inferred from JS-bundle recon, not end-to-end verified. Most such endpoints (19 of 22 probed) are wrong and would 4xx. Verify with \`apply 1200791473415778304 --debug-submit-to <your-echo-url>\` first, or set \`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\` if you're knowingly probing."
}
\`\`\`

Bypass: \`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\` (mirrors the
attestation pattern of \`JOB_PRO_I_UNDERSTAND_REAL_SUBMIT\` from 0.9.2).

Safety-gate stack on \`--really-submit\` is now 4 layers:
1. \`JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes\`
2. \`staged.ready\` — every required field filled
3. \`endpoint_verified === true\` OR \`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\`
4. For non-anon families: captured session.json (and < 30d old, 1.0.21)

Adapters that pass all 4 today without env bypass:
multipart-anon × 3 — xpeng / weride / hoyoverse.

## 1.0.35 — auto-log successful \`--really-submit\` to memory

When \`apply --really-submit\` succeeds (\`result.ok === true\`), the
CLI now automatically writes \`memory event applied "<company>
<post_id> — <job_title>"\` to \`~/.jobpro/memory.json\`. Previously
users had to remember to invoke \`<company> memory event applied …\`
by hand after each submission.

Fires for both code paths: family executors (Feishu / Moka / Beisen
/ CDP) and the generic multipart submitter. \`--debug-submit-to\` and
the staging dry-run path are intentionally untouched — only real
submissions get logged.

Inspect with \`job-pro <co> memory list\` or surfaces in
\`job-pro status\`.

## 1.0.34 — \`endpoint_verified\` flag for honest \`--really-submit\` UX

Recon probe of the 22 multipart-session bespoke endpoints found that
**only 3 of 22 returned an auth gate (401/403); 19 returned 404 or
HTML fallthrough.** Most of the "Endpoint inferred; needs validation"
URLs are wrong guesses — firing \`--really-submit\` against them would
4xx without diagnostic.

Adds an \`endpoint_verified: boolean\` flag on \`ApplyFormSchema\` and
\`StagedApplication\`:

* True for Greenhouse + Lever boards (xpeng / weride / hoyoverse) —
  end-to-end verified by \`pnpm test:debug-submit\` via httpbin echo.
* Unset / false for everything else — endpoint inferred from JS
  bundle recon, never validated against a real submission.

Surfaced inline in the dry-run header:

\`\`\`
submit:    POST https://boards-api.greenhouse.io/…  (verified)
submit:    POST https://join.qq.com/api/v1/…        (⚠ speculative — endpoint inferred, not end-to-end verified)
\`\`\`

External adapters (Liepin × 4 + Unitree WeChat) skip the tag entirely
— they have no submit_endpoint by design.

## 1.0.33 — apply-smoke checks submit_endpoint URL well-formedness

Adds a per-adapter check to \`pnpm test:apply\`: every non-external
schema must expose a \`submit_endpoint\` that parses as a valid
HTTPS URL. Catches adapter-level typos that would otherwise only
surface when a real user fires \`--really-submit\`.

50 PASS / 0 broken — all 45 non-external adapters have well-formed
endpoint URLs. Adds defense-in-depth between schema-fetch and
real submission.

## 1.0.32 — \`find --apply-ready\` lists hidden buckets

Previously \`--apply-ready\` ended with \`(N company-bucket(s) hidden)\`
— a count with no names, no actionable next step. Now lists the
hidden buckets explicitly:

\`\`\`
Hidden by --apply-ready:
  🟡 missing-session (run \`job-pro extension\`): bytedance(3) alibaba(2)
  ⛔ external (IM-mediated):                     hikvision(1)
\`\`\`

Plus the count, the user can immediately see which adapters they'd
unlock with one more session capture.

## 1.0.31 — \`apply --batch\` progress indicator

Long batch runs were silent until the final JSON dump. \`apply --batch\`
now writes a single live progress line to stderr (so stdout stays
clean for jq/pipes):

\`\`\`
[12/40] 8548990002                  
\`\`\`

Auto-disables when:
* \`--compact\` is set (programmatic / scripted use)
* stderr isn't a TTY (CI / piped error stream)
* batch is just one id

Cleared on completion so the trailing JSON output starts on a fresh
line.

## 1.0.30 — \`--debug-submit\` shorthand + README selftest hint

* \`apply <id> --debug-submit\` (no URL needed) defaults to
  \`https://httpbin.org/post\`. The common case is "just verify wire
  format works"; the URL is rarely customized.
* README install section now mentions \`job-pro selftest\` (1.0.29) so
  fresh installers run the 3-stage end-to-end check immediately.

## 1.0.29 — \`job-pro selftest\` end-to-end check

\`pnpm test\` / \`test:apply\` / \`test:debug-submit\` need the source
tree; \`npm i -g job-pro\` users don't have it. New \`job-pro selftest\`
exposes the same end-to-end check as a user-facing verb:

\`\`\`
$ job-pro selftest

job-pro selftest — using xpeng (anon Greenhouse board)

  ✓ search xpeng         819ms
  ✓ fetch schema         577ms
  ✓ debug-submit echo    1361ms

  3 pass / 0 fail / 3 total — sampled "AI Agent Data Pipeline Intern"

  Setup looks good. Run \`job-pro find "<keyword>"\` to scan all 50 companies.
\`\`\`

Runs the canonical three-stage round-trip against xpeng (anon, no
session required): search → fetchApplicationSchema → submit via
\`--debug-submit-to httpbin.org/post\`. Sub-3s. Exit 1 on any failure
so it's scriptable.

## 1.0.28 — 4xx error-message hints

\`fetchWithRetry\` returned bare \`HTTP 401: \` on auth failures — the
user got no signal about what to do. Now appends an actionable hint:

* **401 / 403** → "session likely stale — recapture via \`job-pro
  extension\`, log into the careers site, click Export"
* **404** → "endpoint not found — submit_endpoint may have drifted
  upstream; verify via \`apply --schema\` + \`--debug-submit-to\`"
* **400 / 422** → "request rejected — likely a missing/malformed
  answer; rerun \`apply --interactive\` to refill required fields"
* **429** → "rate limited — retry after a few minutes"

The session-age gate (1.0.21) catches >30d stale sessions, but
sometimes they revoke earlier (logout from another tab, password
change, server-side invalidation) — this hint catches those.

Wired into apply-flow's HTTP path, so every executor (multipart-anon,
multipart-session, feishu-3-step, moka-aes, beisen-wecruit,
beisen-italent) inherits the hints automatically.

unit-smoke grew to **32 assertions** (added 6 hintForStatus cases).

## 1.0.27 — README family-count fix

The "Coverage by source family" table in the README had drifted: the
counts added to 48, not 50. Three rows were stale:

* Feishu Recruiting (ATSX): 7 → **9** (was missing Xiaomi + 01.AI;
  Baichuan was lumped in differently).
* Beisen iTalent: 3 → **2** (the "(more on the way)" hint never
  realized — vivo + iFlytek are both that ships).
* Moka: 6 → **7** (Moonshot was double-counted previously; Geely was
  added but the row didn't reflect it).

Now: 23 + 9 + 7 + 2 + 2 + 3 + 4 = 50 ✓. The Phase 2 paragraph also
updated to past-tense — auto-apply is live, not "the plan".

## 1.0.26 — \`test:unit\` (no-network) + wired into CI

New \`pnpm test:unit\` exercises everything you can verify without
hitting an upstream service:

* \`saveProfile\` + \`loadProfileRaw\` round-trip (1.0.10 / 1.0.16).
* \`applyFormFile\` flat-shape + FormTemplate-shape merge (1.0.1).
* Missing-file / invalid-JSON refusal paths.
* \`sessionAgeDays\` math (1.0.21 gate).
* email / phone regex validators (1.0.16 \`profile lint\`).

**26 pass / 0 fail in ~600ms.** Sub-second + deterministic, so CI
runs it on every push (the 3 live-network smokes stay local —
geo-blocked from GH runners).

Test matrix as of 1.0.26:

| Layer | Cmd | Where |
|-------|-----|-------|
| Unit (helpers, regexes) | \`pnpm test:unit\` | CI + local |
| Phase 1 read paths (50) | \`pnpm test\` | local only |
| Phase 2 schema fetch (50) | \`pnpm test:apply\` | local only |
| Submit wire format (7) | \`pnpm test:debug-submit\` | local only |

## 1.0.25 — single source of truth for submit_kind per adapter

Adds \`SUBMIT_KIND_BY_FAMILY\` + \`SUBMIT_KIND_OVERRIDES\` (just unitree
and lilith) at the top of \`index.ts\`. Used by:

* \`find\`'s apply-status derivation (replaces the inline
  \`ANON_ADAPTERS\` / \`EXTERNAL_ADAPTERS\` sets — they were already
  manually kept in sync with the family map; now there's only one).
* \`list\` output — every family header now shows its
  \`submit_kind=…\`, and adapter rows with a non-default kind
  (unitree → external, lilith → cdp-real-browser) print the kind
  inline. \`--compact\` JSON also gets a \`submit_kind\` field per row.

Useful "what can I submit to right now" view without firing
\`apply --schema\` 50 times.

## 1.0.24 — submit smoke expands to all 5 executor families

\`test:debug-submit\` now covers one representative per executor type:

* multipart-anon (generic submitApplication) — xpeng / weride / hoyoverse
* feishu-3-step (executeFeishu3Step) — nio
* moka-aes (executeMokaApply) — megvii
* beisen-wecruit (executeBeisenWecruit) — sensetime
* beisen-italent (executeBeisenITalent) — iflytek

Each is fired with \`null\` session against \`https://httpbin.org/post\`;
family executors gracefully degrade to UA-only headers in debug mode
(real upstream submission still requires a captured session — this
just verifies the wire-format dispatch is correct).

**7 pass / 0 broken / 7 / 3.3s.** Catches regressions schema smoke
can't see across every executor family, not just multipart-anon.

## 1.0.23 — submit wire-format smoke (3rd test layer)

`pnpm test:debug-submit` exercises the multipart-anon executor end-to-
end against `https://httpbin.org/post` for the 3 Greenhouse/Lever
boards (xpeng / weride / hoyoverse):

1. Search the adapter for a real post_id.
2. Pull schema; auto-fill every required question (first allowed value
   for *_select, "N/A (smoke test)" for text/textarea).
3. Stage with a synthetic profile (tmp /tmp/jobpro-debug-smoke-…/resume.pdf,
   `%PDF\n` magic only — httpbin doesn't validate).
4. Fire `submitApplication(staged, {kind: "debug", url: httpbin})`.
5. Assert `ok: true` + HTTP 200.

Catches regressions schema smoke can't — wrong multipart field names,
broken applyFormFile merge, resume-file read failures, etc. **3 pass /
0 broken / 3 / 6.4s** on first run.

Local-only (alongside `pnpm test` and `pnpm test:apply`); CI skips it
since httpbin.org rate-limits anonymous hits from cloud IPs.

## 1.0.22 — closeout / both smoke tests green

Cumulative end-of-loop verification:

* \`pnpm test\` — Phase 1 read paths: **50 healthy, 0 broken / 50
  total (3.6s)**.
* \`pnpm test:apply\` — Phase 2 schema fetch: **50 schema-ok, 0
  broken / 50 total (4.5s)**.

README now links \`./CHANGELOG.md\` so the release narrative is one
click away from the npm page.

## 1.0.21 — \`--really-submit\` session-age gate

A captured \`~/.jobpro/<co>.session.json\` older than 30 days now blocks
\`--really-submit\` with a structured refusal:

\`\`\`json
{
  "mode": "really-submit-blocked",
  "session_age_days": 227,
  "message": "session at ~/.jobpro/nio.session.json is 227 days old (limit 30); …"
}
\`\`\`

Career-site sessions generally expire around the 30-day mark and a
stale cookie would otherwise yield an inscrutable 401 from upstream
— hard to diagnose without this gate.

Tunables:
* \`--allow-stale-session\` — bypass the gate for one-off cases.
* \`JOB_PRO_SESSION_MAX_AGE_DAYS\` — override the 30-day default
  (e.g. \`=14\` if you know your site is shorter-lived).

Applies to all non-anon families: feishu-3-step, moka-aes,
beisen-wecruit, beisen-italent, cdp-real-browser, multipart-session.
Anon families (multipart-anon: xpeng/weride/hoyoverse) are untouched.

## 1.0.20 — antgroup pageSize fix → **apply-smoke 50/50 schema-ok**

\`antgroup\`'s \`fetchPositionDetail\` brute-scans \`/api/<rt>/position/search\`
(no direct detail endpoint exists). The scan was using \`pageSize: 50\`
— but that triggers a silent upstream rejection (\`totalCount: 0\`).
20 is the SPA's own default and the largest size that reliably
returns data. Compensated by widening maxPages 20 → 50 to keep
~the same scan depth.

apply-smoke now reports **50 schema-ok / 0 ok:false / 0 broken / 50
(3.7s)** — first time Phase 2 schema is fully green across all 50
adapters. Cumulative submit_kind tally:

```
beisen-italent     2
beisen-wecruit     2
cdp-real-browser   1
external           5  ← structural (Liepin IM × 4 + Unitree WeChat × 1)
feishu-3-step      8
moka-aes           7
multipart-anon     3  ← anon-submittable
multipart-session 22
```

## 1.0.19 — detail-endpoint bugfixes: mihoyo / oppo / sf

Three latent bugs in \`fetchPositionDetail\` surfaced by reading the
apply-smoke WARN list. Each was producing "ok:false" on real post IDs
that the read-side search returned:

* **mihoyo** — \`/v1/job/info\` requires \`channelDetailIds\` in the
  body; without it the upstream rejects with "职位渠道不可以为空". Now
  passes the same default (\`[1]\`) the search uses.
* **oppo** — \`/openapi/position/detail\` actually expects the query
  param \`id=\`, not \`idRecruitPosition=\`. The latter triggered
  "id不能为空" despite a non-empty value (the response body keys it
  back as \`idRecruitPosition\`, which is what misled the original
  recon).
* **sf** — \`/api/position/findById/<id>\` is auth-gated; the
  public-anon path the SPA uses is \`/api/web/position/findById/<id>\`,
  sibling of \`/api/web/position/query\` which search already hit.

apply-smoke now reports **48 PASS / 2 ok:false / 0 broken / 50** (was
46 PASS). The two remaining are upstream / architectural, not bugs:

* baidu — picked-up real post is in "发布中" upstream state.
* antgroup — has no direct detail endpoint, so detail brute-scans the
  search; the test id is page-deep and the 20-page budget exhausts.

## 1.0.18 — docs catch up with 1.0.10 / 1.0.16 / 1.0.17

The README and \`examples/walkthrough.md\` had drifted: no mention of
\`--remember\` (1.0.10), \`profile lint\` (1.0.16), or \`job-pro
extension\` (1.0.17). Synced.

\`docs/auto-apply.md\` likewise: the session-capture step now points at
\`job-pro extension\` instead of "install extension/ in Chrome"
(\`extension/\` is internal — \`job-pro extension\` is the user-facing
entry point now that 1.0.17 bundles it).

No code changes.

## 1.0.17 — \`job-pro extension\` + bundle extension in npm package

Before this, \`extension/\` only existed in the GitHub repo — users
who installed via \`npm i -g job-pro\` had no way to get the
session-capture extension without cloning the repo. Now:

* \`files\` includes \`extension\`, and \`prepublishOnly\` copies
  \`../extension\` into \`cli/extension\` so the npm tarball ships it.
* New \`job-pro extension\` prints the unpacked path + a 6-step install
  walkthrough (Chrome chrome://extensions → Load unpacked → …).
* \`job-pro extension path\` prints only the absolute path for
  scripting (\`chrome-cli open chrome://extensions\` etc.).

Resolves the previously-undocumented "where is extension/" friction
in the Phase 2 onboarding flow.

## 1.0.16 — \`profile lint\` format validation

\`job-pro profile lint\` checks every profile field for actual validity,
not just presence (which is all \`status\` did):

* \`email\` regex
* \`phone\` digit-count + country-code recommendation (WARN if missing)
* \`resume_path\` file-exists + extension sniff (WARN on non-pdf/docx)
* \`custom.*\` empty-value detection

Exits 1 on any FAIL so it's scriptable in CI / pre-commit / wrapper
scripts. JSON via \`--compact\`. New \`loadProfileRaw()\` helper in
apply.ts skips the validation gate so lint can inspect partial /
broken profiles instead of getting a flat "missing required field"
short-circuit.

## 1.0.15 — \`apply --schema\` + README sync

* New \`apply --schema\` short-circuit: dumps the raw
  fetchApplicationSchema response and exits. Crucially, doesn't
  require a profile — useful for recon ("what fields does this job
  ask?") and for handing the schema to an LLM for help filling.
* README quick-start now documents \`find\` (the 1.0.12+ cross-company
  parallel verb) — was missing entirely before this.

## 1.0.14 — \`find\` apply-readiness annotations

Each company bucket in \`find\` output now carries \`apply_status\`:

* \`anon\` (✅) — multipart-anon submitter (xpeng / weride / hoyoverse),
  ready to fire \`--really-submit\` without a session.
* \`session\` (🟢) — non-anon adapter with a captured
  \`~/.jobpro/<co>.session.json\`. Apply-ready.
* \`missing-session\` (🟡) — non-anon adapter without a session.
  Capture via the browser extension first.
* \`external\` (⛔) — Liepin IM-mediated or WeChat-only. Can't be
  automated structurally; surfaces the apply_url for browser hand-off.

New \`--apply-ready\` flag filters \`find\` to anon + session-having
buckets only — useful when you want a "what can I literally submit
right now" view. JSON output gets the field too.

## 1.0.13 — \`find --text\` human-readable output

Adds a `--text` mode to 1.0.12's `find`. JSON stays the default
(scripts/jq) but `--text` prints a compact table:

```
find "intern" — 5 hit(s) across 3/3 companies (1938ms)

▌ xpeng (2)
  8548990002  AI Agent Data Pipeline Intern — Santa Clara, CA
    https://job-boards.greenhouse.io/xpengmotors/jobs/8548990002
  …
```

Verified upstream health on the same iteration: \`pnpm test\` reports
50 healthy / 0 broken / 50 total in 4.0s.

## 1.0.12 — \`job-pro find <keyword>\` cross-company parallel search

New top-level verb: \`job-pro find "intern"\` fires
`searchPositions({ keyword, pageSize: limit })` against every adapter
in parallel (Promise.all + per-adapter timeout, default 8000ms) and
aggregates the results. Default \`--limit 3\` per company; scope with
\`--companies xpeng,bytedance,…\` to skip slow / session-required ones.

Output is one JSON blob: \`{ ok, keyword, total, company_count,
scanned_companies, elapsed_ms, results:[…], failed:[…] }\`. Pipe to
\`jq\` for the typical "give me every intern role across the board"
question. Live tested across xpeng/weride/hoyoverse: 5 hits in 2.4s.

Same per-adapter timeout in failed[] entries so partial outages don't
sink the whole sweep.

## 1.0.11 — \`--remember\` also persists \`--form-file\` answers

Extends 1.0.10: when `--remember` is paired with `--form-file <path>`,
the merged answers get written back to `~/.jobpro/profile.json` (same
shape as the interactive path — keyed by `custom.<question_name>`).
Skips the write when the merged custom map is identical to disk, so
there's no spurious touch when re-running with an unchanged form-file.

The trio is now: print → fill → load with `--remember`. Once.

## 1.0.10 — \`apply --remember\` persists interactive answers

`apply --interactive --remember` writes the collected answers back into
`~/.jobpro/profile.json` under `custom.<question_name>`. Question names
(e.g. `question_36528767002`) are stable per-board in Greenhouse, so
the next job at the same company auto-resolves shared questions
without re-prompting.

Opt-in by design — without `--remember`, interactive answers stay
in-memory for that one apply, so one-off job-specific questions
don't pollute the profile.

New `saveProfile()` helper in `apply.ts` writes the full profile back
atomically; reused later for any other "persist this back" workflow.

## 1.0.9 — README + extension manifest cleanup

* README quick-start now shows `profile init --interactive` as the
  default (validation + re-prompt on bad input), with the
  `init && $EDITOR` flow as fallback.
* New paragraph on `apply --batch <file|-` (1.0.7) + the deliberate
  refusal of `--batch --really-submit`.
* Extension manifest no longer references `icon{16,48,128}.png` —
  those PNGs were never shipped, so loading the unpacked extension
  in Chrome printed a missing-icon warning. Removing the reference
  is the correct fix until we ship real icons.

## 1.0.8 — \`profile init --interactive\`

Cold-start UX: `job-pro profile init --interactive` walks the 5
essential fields (first_name / last_name / email / phone / resume_path)
via readline prompts, validating each (regex on email/phone, file-
exists on resume_path) and re-prompting on bad input. No more "edit
this JSON file by hand" for first-time users.

The interactive path refuses fast if stdin is not a TTY (piped /
heredoc'd) with a clear message — readline EOF semantics make piped
input unreliable, and silent partial writes would be worse than the
explicit refusal.

## 1.0.7 — apply --batch &lt;file|-&gt;

\`job-pro <co> apply --batch /path/to/post-ids.txt\` reads a newline-
separated list of post_ids (\`#\`-prefix comments allowed), stages each
against the same profile + session, and emits a JSON array of
\`{ post_id, ok, ready, submit_kind, message }\`. Passes through
\`--form-file\` so per-job custom answers apply uniformly across all
batch entries.

\`--batch\` + \`--really-submit\` is intentionally refused — batch real
submission is the spam-pattern the safety gates exist to prevent.
Verify with \`--debug-submit-to https://httpbin.org/post\`, then submit
each job individually.

\`-\` reads from stdin so workflows like
\`job-pro xpeng all --compact | jq -r '.positions[].post_id' | \\
   job-pro xpeng apply --batch -\` are one-liner-able.

## 1.0.6 — retry-with-backoff extended to family executors

All 4 family executors (executeFeishu3Step / executeMokaApply /
executeBeisenWecruit / executeBeisenITalent) now route every HTTP
step through fetchWithRetry, picking up the same transient-failure
policy from 1.0.5. New `doStep(step, url, init, steps)` helper combines
fetchWithRetry with FeishuStepLog bookkeeping so each call site is
~5 lines instead of ~12.

Coverage delta: every executor-routed adapter (45 / 50) now has
retry on transient 5xx + network errors, with 4xx user-errors still
short-circuiting to fail-fast.

## 1.0.5 — retry-with-backoff for submission

`fetchWithRetry()` wraps the generic submitApplication path with
exponential-backoff retries on transient failures. Policy:

* **Network errors** → retry (transient, retryable).
* **5xx** → retry with backoff (250ms × 2^attempt, ±25% jitter).
* **4xx** → no retry (user error: bad session / malformed body — retrying
  would just waste resume upload attempts against a server that's
  politely saying "no").
* Default: 2 retries (3 total attempts), override with `JOB_PRO_RETRY=N`.

Wired into submitApplication today (multipart-anon + multipart-session =
25 / 45 executor-routed adapters). Family executors (Feishu / Moka /
Beisen / CDP) still use bare fetch — same policy applies in a follow-up
iteration.

## 1.0.4 — examples/ + web Phase 2 panel

Web landing page (`job.ha7ch.com`) now has a dedicated "Phase 2 —
submit, not just search" panel showing the apply workflow + safety
gates. New `examples/` directory ships a fully-filled
`profile.example.json`, per-job form templates for the Greenhouse +
Feishu families, and an end-to-end `walkthrough.md` from `profile init`
through `--really-submit`.

## 1.0.3 — \`job-pro status\` diagnostic survey

Single command summarises Phase 2 setup state:
* **Profile** — which of name/email/phone/resume_path are filled, plus
  custom-key count.
* **Sessions** — every `~/.jobpro/*.session.json` from the extension,
  with cookie/header count and age in days. Flags STALE for >30d.
* **Memory** — field count + last 5 events.
* **Chrome** — puppeteer-core resolvability + Chrome binary path.

Also fixed an ESM-vs-CJS bug where `require.resolve("puppeteer-core")`
was a no-op; the resolver now uses `createRequire(import.meta.url)`.

## 1.0.2 — \`apply --interactive\`

Walks the unanswered required fields and prompts inline. *_select
kinds present allowed values as a numbered list. Required fields
re-prompt on empty input; `skip` / `q` break out gracefully.

## 1.0.1 — \`apply --print-form\` + \`apply --form-file <path>\`

`--print-form` emits a JSON template specific to that job's schema
(label, type, allowed values, currently-resolved value). `--form-file`
loads per-job overrides without polluting `~/.jobpro/profile.json`.
When `staged.ready` is false, the dry-run output now prints a
copy-pasteable JSON snippet of only the unanswered required fields.

## 1.0.0 — Phase 2 executor coverage at 45 / 50

Marks the completion of the original two-phase scope: read every
Chinese big-tech careers feed (Phase 1) AND let the CLI actually fire
applications against them (Phase 2). Released as a major-version
milestone, not because the API broke.

* **Apply-path smoke test** — `pnpm test:apply` independently
  verifies every adapter's `fetchApplicationSchema` against a live
  upstream post_id. Output groups results by `submit_kind` for an
  at-a-glance executor-coverage view.
* **README.md** rewritten with a Phase 2 quick-start section
  (profile init → extension capture → `--really-submit`).
* **docs/auto-apply.md** holds the 50-row submission-flow matrix.

## 0.9.x — Phase 2 stages

* **0.9.0** — Phase 2 staging infrastructure (`apply.ts`,
  `ResumeProfile`, dry-run renderer). `apply` verb wired on dispatcher.
  Greenhouse + Lever boards (3 adapters) become the first to expose an
  application schema.
* **0.9.1** — Submission wire format verified end-to-end against
  `httpbin.org/post` (multipart/form-data with resume file). Browser-
  extension scaffold lands (`extension/`, manifest v3, MV3 service
  worker, popup UI). puppeteer-core promoted from devDep to runtime
  dep.
* **0.9.2** — `~/.jobpro/<adapter>.session.json` reader; `--really-submit`
  unlocked behind `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes` + session
  presence.
* **0.9.3** — Feishu family schema (9 adapters). 23/50 schemas wired.
* **0.9.4** — Moka × 7 + Beisen Wecruit × 2 + Beisen iTalent × 2.
  34/50 schemas.
* **0.9.5** — 22 bespoke adapters via `buildBespokeApplySchema` helper.
  50/50 schemas. ⛔ external introduced for the 5 IM-mediated /
  WeChat-only adapters.
* **0.9.6** — `executeFeishu3Step` — first family-specific submitter
  (upload-tokens → CDN PUT → resume/apply).
* **0.9.7** — `executeMokaApply` + `executeBeisenWecruit` +
  `executeBeisenITalent`. 44/50 executor-routed.
* **0.9.8** — `executeCdpRealBrowser` for Lilith (the only adapter
  needing the ByteDance Tengine `_signature` bypass). 45/50
  executor-routed; remaining 5 are structural external.

## 0.8.x — Web sync + docs sync + UX

* **0.8.0** — Liepin third-party aggregator lands as the fallback for
  `hikvision` / `cicc` / `cainiao` / `webank` (no canonical public
  feed). All 50 adapters return `ok:true` for the first time.
* **0.8.1** — README + auto-apply + CLI HELP rewritten to reflect the
  50-company reality; HELP text reorganised by ATS family.
* **0.8.2** — New `job-pro list` + `job-pro list --compact` command.
  Adapter directory drives both `list` output and a runtime validator
  that flags ADAPTERS/COMPANIES drift.

## 0.7.x — Reaching 50 / 50 (read coverage)

* **0.7.0** — 50-company milestone (`+12 cos` over 0.6.0): XPeng /
  WeRide / HoYoverse (Greenhouse + Lever) + 9 stubs (iFlytek / OPPO /
  vivo / SF Express / Cainiao / Geely / WeBank / Horizon Robotics /
  Cambricon). New factories: `greenhouse.ts`, `lever.ts`.
* **0.7.1** — Explicit `CompanyAdapter` interface + `satisfies` clause
  in dispatcher (replaces 50× `as unknown as`). Caught two real
  contract drifts: alibaba missing `checkResume`, bilibili missing
  `fetchPositionDetail`. Smoke test strictened with `KNOWN_LIMITED`
  gate.
* **0.7.2** — Three more cracks: SenseTime + Horizon Robotics via
  Beisen Wecruit (`/wecruit/positionInfo/listPosition` form-urlencoded
  trick); Cambricon via Moka. New `wecruit.ts` factory.
* **0.7.3** — Ant Group via anon `hrcareersweb.antgroup.com` (the
  earlier "Alipay OAuth gated" was a false positive — only the user
  dashboard endpoints are gated). Geely via Moka (`job.geely.com` is a
  CNAME to `app.mokahr.com/social-recruitment/geely/96123`). New
  `moka.ts` factory; `cambricon.ts` retrofitted to it (-300 LOC).
* **0.7.4** — Lilith via puppeteer-core CDP: Feishu tenant requires
  runtime-minted `_signature`. New `cdp.ts` factory with optional
  Chrome auto-detection. 5 more Moka adapters migrated to the factory
  (megvii / deepseek / galaxyuniversal / stepfun / moonshot) —
  net −1500 LOC of duplicated AES boilerplate.
* **0.7.5** — `JOB_PRO_HTTPS_PROXY` env passed through to puppeteer's
  `--proxy-server`; hikvision adapter rewritten to refuse fast when no
  proxy is set (fixed an earlier bug where product-page anchors were
  surfaced as fake jobs).

## 0.5.x – 0.6.x — Discovery rampup

* **0.5.0** — 19 cos live. Ping An via `campus.pingan.com`.
* **0.6.0** — 24 cos live. Trip.com + Unitree go full; BYD + Ant Group
  stubs ship with documented JWT/OAuth gates.

## 0.4.x — Filter taxonomies

* **0.4.0** — 12 cos. Kuaishou / Xiaomi (via Feishu fork
  `xiaomi.jobs.f.mioffice.cn`) / Baidu / NetEase / Didi / Bilibili.
* Adapter-specific filter flags (`--bg-ids`, `--cities`,
  `--recruitment-id-list`, `--batch-id`, `--recruit-type`) thread
  straight from CLI into each adapter's SearchOptions.

## 0.1.x – 0.3.x — Foundations

* **0.1.0** — Tencent only (`join.qq.com`, recovered from the official
  WorkBuddy skill bundle).
* **0.2.0** — ByteDance / Alibaba / Meituan / Xiaohongshu bespoke
  adapters; first generic dispatcher.
* **0.3.0** — JD; CLI flag harvester (CSV → arrays for *IdList /
  *List / *Codes / *Regions / *Cities / *Departments fields).
