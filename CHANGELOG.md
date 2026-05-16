# Changelog

Job-pro releases are tracked on npm: <https://www.npmjs.com/package/job-pro>.
This file is the human-readable narrative of how we got here, not a
mechanical diff log — for that, `git log --oneline cli/`.

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
