# job.pro

[![ci](https://github.com/HA7CH/job-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/HA7CH/job-pro/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/job-pro.svg)](https://www.npmjs.com/package/job-pro)

Query Chinese big-tech campus recruiting from your terminal — [job.ha7ch.com](https://job.ha7ch.com)

```bash
npx job-pro@latest tencent search "后台开发"
```

No signup, no token, no proxy server. **50 companies, all live.** The CLI talks
straight to each company's public API (e.g. `join.qq.com` for Tencent) and
prints JSON. Pipe it into `jq`, Claude Code, anything.

Run `job-pro help` for the full company list, or see the roadmap matrix at
[job.ha7ch.com](https://job.ha7ch.com). Per-release notes:
[CHANGELOG.md](./CHANGELOG.md).

## Demo: hand it to Claude Code

Drop the prompt from [job.ha7ch.com](https://job.ha7ch.com) into Claude Code,
attach your resume, and let the agent drive the CLI end-to-end.

**1. It pulls the city's intern list and shortlists roles against your resume.**

![Claude Code fetches Beijing intern roles and recommends top matches](docs/screenshots/01-recommend.png)

**2. It pulls multiple JDs in parallel and grades each one line-by-line.**

![Three JDs analyzed side-by-side with star ratings per requirement](docs/screenshots/02-jd-analysis.png)

**3. It hands you a final verdict — apply, fall back, or skip.**

![Final recommendation: AI-app primary, front-end fallback, skip PM track](docs/screenshots/03-verdict.png)

## Install

```bash
npm i -g job-pro
job-pro --version
```

Or one-shot via `npx`:

```bash
npx job-pro@latest help
```

## What you can do today

```bash
# search & inspect jobs
job-pro tencent search "数据科学" --page-size 10
job-pro tencent detail 1200791473415778304
job-pro tencent all --page-size 100             # drain every open post

# announcements
job-pro tencent notices
job-pro tencent notice 284
job-pro tencent flow "腾讯2026实习什么时候开始" --question-time 2026-05-13

# resume tooling (all offline)
echo "..." | job-pro tencent match -
job-pro tencent resume-check resume.md

# local memory for tracking your hunt
job-pro tencent memory set "stack=Go,Python" "target_city=深圳"
job-pro tencent memory event applied "腾讯后台 1200791473415778304"
job-pro tencent memory list

# list / browse adapters
job-pro list                 # human-readable, grouped by ATS family
job-pro list --compact       # JSON for piping

# cross-company parallel search
job-pro find "intern" --text                       # scan all 50 in parallel
job-pro find "AI" --apply-ready --text             # only show buckets you can fire today
job-pro find "前端" --companies tencent,bytedance,alibaba --limit 5
```

Add `--compact` to any command for a single-line JSON output (pipe-friendly).

## Phase 2 — auto-apply (1.0+)

Submit applications from the CLI. 50 / 50 adapters expose an
application schema; 45 / 50 have a working submitter wired:

```bash
# 1. Set up your profile (one-time)
job-pro profile init --interactive   # prompts for the 5 essential fields (validates each)
job-pro profile lint                 # check format of every field (exit 1 on fail)
# or: job-pro profile init && $EDITOR ~/.jobpro/profile.json

# 2. Inspect a job's schema (no profile required)
job-pro xpeng apply 8548990002 --schema

# 3. Dry-run an application (no network)
job-pro xpeng apply 8548990002       # stage + preview the POST
job-pro xpeng apply 8548990002 --interactive --remember  # fills answers, persists to profile

# 4. Verify the wire format against an echo server (no upstream impact)
job-pro xpeng apply 8548990002 --debug-submit-to https://httpbin.org/post

# 5. Actually submit
JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \
  job-pro xpeng apply 8548990002 --really-submit
```

Greenhouse / Lever boards (xpeng / hoyoverse / weride) submit
anonymously. Every other family needs a captured session — run
`job-pro extension` for the path + install walkthrough, log into the
careers site once, click Export, then drop
`~/Downloads/jobpro/<adapter>.session.json` under `~/.jobpro/`.

```bash
# After capturing nio's session via the extension:
JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \
  job-pro nio apply 7639693860494543167 --really-submit
```

The CLI gates `--really-submit` behind three layers:
1. `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes` env-var attestation.
2. `staged.ready` — every required field is filled.
3. For non-anon families, `~/.jobpro/<co>.session.json` must exist.

Bulk-stage with `apply --batch <file|-` (newline-separated post_ids;
`-` reads stdin); pairs with `--form-file` for uniform answers. Batch
intentionally refuses `--really-submit` — verify wire format with
`--debug-submit-to`, then submit jobs individually.

Five adapters (hikvision / cicc / cainiao / webank / unitree) are
intentionally `external` — recruiting is mediated through Liepin
recruiter chat or WeChat mini-programs; no API submission exists.
For those, `apply` surfaces the `apply_url` to open in browser.

See [docs/auto-apply.md](./docs/auto-apply.md) for the full per-adapter
submission flow matrix.

## Roadmap

**Phase 1 — Read jobs:** 50 / 50 companies, all live. See the full live matrix
with per-company status icons at [job.ha7ch.com](https://job.ha7ch.com), or run
`job-pro help` for the canonical list.

Coverage by source family:

| Source family            | Companies | Notes                                                              |
|--------------------------|-----------|--------------------------------------------------------------------|
| Bespoke per-company API  | 23        | Tencent, ByteDance, Alibaba, Meituan, Xiaohongshu, JD, …            |
| Feishu Recruiting (ATSX) | 9         | Xiaomi, NIO, MiniMax, Zhipu, iQIYI, Agibot, Lilith *via CDP*, 01.AI, Baichuan |
| Moka (app.mokahr.com)    | 7         | Moonshot, Megvii, DeepSeek, GalaxyUniversal, StepFun, Cambricon, Geely |
| Beisen Wecruit           | 2         | SenseTime, Horizon Robotics                                        |
| Beisen iTalent (zhiye)   | 2         | vivo, iFlytek                                                      |
| Greenhouse / Lever       | 3         | XPeng, WeRide, HoYoverse — international/US arms                   |
| Liepin third-party feed  | 4         | Hikvision, CICC, Cainiao, WeBank (no canonical public feed exists) |

23 + 9 + 7 + 2 + 2 + 3 + 4 = 50.

**Phase 2 — Auto-apply** is live: 45 / 50 adapters have a submitter
wired (3 anon Greenhouse/Lever, 42 via captured browser session); the
remaining 5 are intentionally `external` (Liepin recruiter chat × 4 +
Unitree WeChat QR × 1 — IM-mediated, no API submission exists).

### Notes on coverage edge cases

* **Greenhouse / Lever boards** (XPeng / WeRide / HoYoverse) only carry the
  *international* arm's postings (US AI center, Singapore game-dev, etc.).
  The China-side campus boards for these companies aren't publicly reachable
  from outside their networks; when they become accessible a sibling adapter
  will land.
* **Lilith** uses a Feishu tenant gated by a ByteDance Tengine `_signature`
  anti-bot token. The CLI cracks it via `puppeteer-core` driving the user's
  local Chrome. If Chrome isn't installed, this one adapter returns a
  helpful `ok:false` with the install hint — the other 49 are unaffected.
* **Hikvision / CICC / Cainiao / WeBank** have no canonical anonymous public
  feed (the first three are geo-fenced or DNS-internal; WeBank is WeChat-
  mini-program-only). For these four the CLI surfaces real currently-open
  positions through [Liepin](https://www.liepin.com) and clearly labels the
  result with `source: "api-c.liepin.com"` and `attribution: "via Liepin
  (third-party aggregator) — official portal not publicly accessible"`.
  See [docs/stub-unblock.md](./docs/stub-unblock.md) for the reasoning.

## How it's built

- `cli/` — the npm package (TypeScript, Node 18+). Single runtime dep:
  `puppeteer-core` (used only by the `lilith` adapter, see above).
- `cli/src/<company>.ts` — one thin adapter per company.
- `cli/src/{feishu,greenhouse,lever,moka,wecruit,liepin}.ts` — generic SaaS-ATS
  factories. Adding a new tenant on an existing ATS is a ~30-line wrapper.
- `cli/src/cdp.ts` — singleton headless-Chrome helper for anti-bot upstreams.
  Reads `$JOB_PRO_HTTPS_PROXY` for a CN-egress proxy when needed.
- `cli/src/adapter.ts` — the explicit `CompanyAdapter` contract every adapter
  must satisfy.
- `cli/test/smoke.ts` — strict gate: any live adapter regressing to `ok:false`
  FAILs the suite. `KNOWN_LIMITED` is currently the empty set.
- `src/` — the [job.ha7ch.com](https://job.ha7ch.com) landing page (Next.js).
- `python-reference/` — the original Python port for `join.qq.com`.
- `docs/` — endpoint inventories per company, plus `stub-unblock.md` with
  the full recon history.
- `extension/` — manifest v3 Chrome extension that captures careers-site
  session cookies + CSRF headers for Phase 2 auto-apply. Load it via
  `chrome://extensions/ → Developer mode → Load unpacked`. See
  `extension/README.md`.

## Why "local-direct" instead of a hosted backend

The data is public. We don't store anything on a server, don't see your
queries, don't rate-limit you, can't go down. The flipside: you get the
upstream's quirks (typos in field names, etc.) — we paper over them in the
client, but if the upstream changes, the CLI may need a release.

## Credit

The endpoint inventory for `join.qq.com` was recovered by inspecting the
official Tencent WorkBuddy skill bundle. We re-implemented the client in
both Python and TypeScript with our own structure, naming, and matching
heuristics. No prompt copy, no documentation copy, no skill body is reused.

## Contributing

Adding a new company is mechanical:
1. Find its public listing/detail API. DevTools → Network on the careers
   site is the fast path, but for SPAs with anti-bot challenges
   (Tengine `_signature`, EdgeOne JS cookies, etc.) you may need
   `cli/probe/<company>-network.ts` running puppeteer-core to intercept
   the real XHR — see existing probes for templates.
2. Identify the SaaS ATS family. If it's already supported
   (`feishu` / `greenhouse` / `lever` / `moka` / `wecruit` / `liepin`),
   add a ~30-line wrapper that calls `createAdapter({ … })`. Otherwise
   write a bespoke adapter mirroring `tencent.ts`.
3. Wire it into `cli/src/index.ts` `ADAPTERS` and `cli/test/smoke.ts`.
   The `satisfies CompanyAdapter` clause will refuse to compile if
   any of the 9 required verbs is missing.
4. Add an entry to `src/app/page.tsx`'s `COMPANIES` array.
5. Run `pnpm test`. The smoke gate runs every adapter in parallel and
   FAILs on `ok:false` for non-`KNOWN_LIMITED` adapters.
6. Open a PR.

The auto-apply phase needs more thought — see the roadmap doc.

## License

MIT — see [LICENSE](./LICENSE).
