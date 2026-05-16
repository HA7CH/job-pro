# Changelog

Job-pro releases are tracked on npm: <https://www.npmjs.com/package/job-pro>.
This file is the human-readable narrative of how we got here, not a
mechanical diff log — for that, `git log --oneline cli/`.

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
