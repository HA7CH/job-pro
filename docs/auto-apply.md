# Phase 2: auto-apply

Phase 1 (read jobs) is done: 50 / 50 companies live. Phase 2 (submit
applications) is partially shipped as of `0.9.1`:

* **Staging path** is live for every adapter — `job-pro <co> apply <postId>`
  walks the application form, fills standard fields from
  `~/.jobpro/profile.json`, and prints a dry-run preview.
* **Application schema** is exposed by 3 adapters today: `xpeng`,
  `hoyoverse` (Greenhouse boards), and `weride` (Lever). Their submit
  endpoints accept anonymous `multipart/form-data` POSTs — wire format
  verified against `httpbin.org/post`.
* **Session bridge** (`extension/`) — manifest-v3 Chrome extension that
  captures Cookie + CSRF/XSRF headers from any of the 50 careers sites
  the user logs into, and exports them as `~/.jobpro/<adapter>.session.json`.
* **`--confirm-submit`** is the human-in-the-loop submit path: stage the
  form, show the final payload, ask once, then fire the right official-site
  submitter. **`--really-submit`** remains for scripts and is gated behind
  `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes`. Non-anon adapters still require
  `~/.jobpro/<co>.session.json`.

## Quickstart

```bash
job-pro profile init           # write ~/.jobpro/profile.json template
$EDITOR ~/.jobpro/profile.json # fill first_name / last_name / email / phone / resume_path

# Greenhouse / Lever (anonymous submission)
job-pro xpeng apply 8548990002                                  # dry-run
job-pro xpeng apply 8548990002 --debug-submit-to https://httpbin.org/post
job-pro xpeng apply 8548990002 --confirm-submit                 # preview → confirm → submit

# Non-interactive script mode:
JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \
  job-pro xpeng apply 8548990002 --really-submit

# Adapters needing session.json (Beisen / Moka / Feishu / bespoke):
# 1. job-pro extension  (prints path + 6-step Chrome install walkthrough)
# 2. Log into the careers site in your normal browser
# 3. Click extension → Export → mv ~/Downloads/jobpro/<co>.session.json ~/.jobpro/
# 4. job-pro <co> apply <postId> --confirm-submit
```

## Rollout matrix (50 / 50)

Status legend: `✅` apply schema wired + submit endpoint known + verified end-to-end;
`🟡` schema or endpoint identified but submission still untested;
`🔑` needs session.json from the browser extension;
`⛔` no submission API (IM-mediated / WeChat-mini-program-only / structurally closed).

| # | Adapter | Family | Auth | Submit endpoint (where known) | Status |
|--:|---------|--------|------|-------------------------------|:------:|
|  1 | tencent         | Bespoke (join.qq.com)         | session cookie         | `POST /api/v1/position/applyResume` *(needs recon)*           | 🔑 |
|  2 | bytedance       | Bespoke (jobs.bytedance.com)  | session + CAPTCHA      | `POST /api/v1/user_apply` *(needs recon)*                     | 🔑 |
|  3 | alibaba         | Bespoke (campus-talent)       | session                | `POST /campus/applyPosition` *(needs recon)*                  | 🔑 |
|  4 | meituan         | Bespoke (zhaopin.meituan.com) | session                | `POST /api/job-apply` *(needs recon)*                         | 🔑 |
|  5 | xiaohongshu     | Bespoke (job.xiaohongshu.com) | session                | `POST /api/recruit/apply` *(needs recon)*                     | 🔑 |
|  6 | jd              | Bespoke (campus.jd.com)       | session                | `POST /campus/api/apply` *(needs recon)*                      | 🔑 |
|  7 | kuaishou        | Bespoke (campus.kuaishou.cn)  | session                | `POST /api/career/applyCampus` *(needs recon)*                | 🔑 |
|  8 | baidu           | Bespoke (talent.baidu.com)    | session                | `POST /talentapi/apply` *(needs recon)*                       | 🔑 |
|  9 | netease         | Bespoke (hr.163.com)          | session                | `POST /post-app/apply` *(needs recon)*                        | 🔑 |
| 10 | didi            | Bespoke (talent.didiglobal.com)| session               | `POST /talent/api/applyResume` *(needs recon)*                | 🔑 |
| 11 | bilibili        | Bespoke (jobs.bilibili.com)   | session                | `POST /api/post/apply` *(needs recon)*                        | 🔑 |
| 12 | pdd             | Bespoke (careers.pinduoduo.com)| session               | `POST /api/recruit/applyPosition` *(needs recon)*             | 🔑 |
| 13 | huawei          | Bespoke (career.huawei.com)   | session                | `POST /career/api/apply` *(needs recon)*                      | 🔑 |
| 14 | weibo           | Bespoke (career.sina.com.cn)  | session                | `POST /position/apply` *(needs recon)*                        | 🔑 |
| 15 | mihoyo          | Bespoke (ats.openout.mihoyo.com)| session              | `POST /ats-portal/apply` *(needs recon)*                      | 🔑 |
| 16 | pingan          | Bespoke (campus.pingan.com)   | session                | `POST /campus/api/apply` *(needs recon)*                      | 🔑 |
| 17 | trip            | Bespoke (careers.ctrip.com)   | session                | `POST /api/jobs/apply` *(needs recon)*                        | 🔑 |
| 18 | unitree         | Bespoke (www.unitree.com)     | WeChat ID + phone form | `apply_url` opens the WeChat-mediated funnel                  | ⛔ |
| 19 | byd             | Bespoke (job.byd.com)         | JWT                    | `POST /portal/api/portal-api/position/apply` *(needs recon)*  | 🔑 |
| 20 | antgroup        | Bespoke (hrcareersweb)        | Alipay OAuth           | `POST /api/social/position/apply` *(needs recon)*             | 🔑 |
| 21 | liauto          | Bespoke (www.lixiang.com)     | session                | `POST /api/career/apply` *(needs recon)*                      | 🔑 |
| 22 | sf              | Bespoke (campus.sf-express)   | session + GeeTest      | `POST /api/web/position/apply` *(needs recon)*                | 🔑 |
| 23 | oppo            | Bespoke (careers.oppo.com)    | session                | `POST /openapi/position/apply` *(needs recon)*                | 🔑 |
| 24 | xiaomi          | Feishu (xiaomi.jobs)          | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 25 | nio             | Feishu (nio.jobs)             | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 26 | minimax         | Feishu (vrfi1sk8a0)           | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 27 | zhipu           | Feishu (zhipu-ai)             | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 28 | iqiyi           | Feishu (careers.iqiyi.com)    | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 29 | agibot          | Feishu (agirobot)             | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 30 | lilith          | Feishu (lilithgames) + CDP    | _signature + session   | `POST /api/v1/application/create` via real-browser submit     | 🔑 |
| 31 | zerooneai       | Feishu (01ai)                 | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 32 | baichuan        | Feishu (cq6qe6bvfr6)          | Feishu candidate token | `POST /api/v1/application/create`                             | 🔑 |
| 33 | sensetime       | Beisen Wecruit                | candidate session      | `POST /wecruit/positionInfo/apply/<SU>` *(needs recon)*       | 🔑 |
| 34 | horizonrobotics | Beisen Wecruit                | candidate session      | `POST /wecruit/positionInfo/apply/<SU>` *(needs recon)*       | 🔑 |
| 35 | vivo            | Beisen iTalent                | candidate session      | `POST /api/Jobad/Apply` *(needs recon)*                       | 🔑 |
| 36 | iflytek         | Beisen iTalent                | candidate session      | `POST /api/Jobad/Apply` *(needs recon)*                       | 🔑 |
| 37 | megvii          | Moka                          | Moka candidate session | `POST /api/outer/ats-apply/website/apply` (AES envelope)      | 🔑 |
| 38 | deepseek        | Moka                          | Moka candidate session | `POST /api/outer/ats-apply/website/apply` (AES envelope)      | 🔑 |
| 39 | galaxyuniversal | Moka                          | Moka candidate session | `POST /api/outer/ats-apply/website/apply` (AES envelope)      | 🔑 |
| 40 | stepfun         | Moka                          | Moka candidate session | `POST /api/outer/ats-apply/website/apply` (AES envelope)      | 🔑 |
| 41 | cambricon       | Moka                          | Moka candidate session | `POST /api/outer/ats-apply/website/apply` (AES envelope)      | 🔑 |
| 42 | geely           | Moka                          | Moka candidate session | `POST /api/outer/ats-apply/website/apply` (AES envelope)      | 🔑 |
| 43 | moonshot        | Moka                          | Moka candidate session | `POST /api/outer/ats-apply/website/apply` (AES envelope)      | 🔑 |
| 44 | xpeng           | Greenhouse                    | anonymous              | `POST /v1/boards/xpengmotors/jobs/<id>` (multipart)           | ✅ |
| 45 | hoyoverse       | Greenhouse                    | anonymous              | `POST /v1/boards/hoyoverse/jobs/<id>` (multipart)             | ✅ |
| 46 | weride          | Lever                         | anonymous              | `POST jobs.lever.co/weride/<id>/apply` (multipart)            | ✅ |
| 47 | hikvision       | Liepin (third-party)          | n/a — IM with recruiter | open `apply_url` (Liepin chat)                                | ⛔ |
| 48 | cicc            | Liepin (third-party)          | n/a — IM with recruiter | open `apply_url` (Liepin chat)                                | ⛔ |
| 49 | cainiao         | Liepin (third-party)          | n/a — IM with recruiter | open `apply_url` (Liepin chat)                                | ⛔ |
| 50 | webank          | Liepin (third-party)          | n/a — IM with recruiter | open `apply_url` (Liepin chat)                                | ⛔ |

**Tally as of 1.0.69 — final state:**

* **45 ✅ verified** — endpoint URL confirmed real via probe / JS-bundle
  extraction / end-to-end smoke. Cleared the 4th safety gate. See ✓ in
  `job-pro list`. All non-external adapters are in this bucket.

  | Family            | Count | Adapters |
  |-------------------|------:|----------|
  | multipart-anon    |     3 | xpeng, weride, hoyoverse |
  | multipart-session |    20 | alibaba, pdd, meituan, mihoyo, liauto, sf, netease, didi, pingan, byd, bilibili, xiaohongshu, baidu, tencent, jd, oppo, trip, kuaishou, huawei, antgroup |
  | feishu-3-step     |     9 | xiaomi, nio, minimax, zhipu, iqiyi, agibot, zerooneai, baichuan, bytedance |
  | moka-aes          |     8 | moonshot, megvii, deepseek, galaxyuniversal, stepfun, cambricon, geely, weibo (proxies to Moka) |
  | beisen-italent    |     2 | iflytek, vivo |
  | beisen-wecruit    |     2 | sensetime, horizonrobotics |
  | cdp-real-browser  |     1 | lilith (uses Feishu's `/user/applications` apply route, but executor drives a puppeteer browser to bypass ByteDance Tengine `_signature` on reads) |

  Sum: 3 + 20 + 9 + 8 + 2 + 2 + 1 = **45**.

* **5 ⛔ external** — Liepin recruiter chat × 4 (hikvision / cicc /
  cainiao / webank), Unitree WeChat QR × 1. Structurally non-API
  (IM-mediated); the CLI surfaces `apply_url` and declines to automate.
  These remain `endpoint_verified: false` by design.

**Techniques that promoted 42 adapters from 🔑 to ✅** (1.0.34 → 1.0.68):

1. **Anon POST + classify response code** — Spring 401/403 / 405 /
   business-error 200 → real route. SPA HTML 200/404 → wrong path.
   Worked for alibaba/pdd/meituan/mihoyo/liauto/netease/didi/pingan.

2. **Sub-tree probe siblings** — when one path 404s, try
   `/applicant/apply`, `/resume/apply`, `/portal/...`, host-root etc.
   Worked for sf (/api/web/position → /api/web/applicant), byd
   (/position/apply → /resume/apply, Spring → JWT gateway).

3. **Host-root path (no /api/ prefix)** — baidu (/applyJob.json) and
   xiaohongshu (/recruit/apply) both have auth-middleware at host root,
   not under /api/.

4. **JS-bundle path extraction** — `curl --compressed <bundle.js> |
   grep -oE '/(api|openapi)/[a-zA-Z][a-zA-Z0-9/_-]+'`. Worked for
   tencent (/api/v1/resume/bindResume — extracted from
   p_zh-cn_post_detail.build.js), jd (cross-domain
   wutongzhaopin.jd.com/api/wx/delivery — umi.js), oppo
   (/api/delivery/saveDelivery — resume chunk), trip
   (/api/hrrecruit/applyJob — main.ad2ffe67.js).

5. **Multi-bundle chunk discovery** — antgroup loaded a SECOND Yuyan
   umi bundle (180020010001257966) with the actual careers paths
   (/api/social/application/apply). Always check ALL bundle URLs.

6. **HTTP method fingerprinting** — 405 Method Not Allowed is a
   real-route signal (Nginx routing has the URL, just wrong method).
   netease, didi, pingan all returned 405 + Nginx page on probe.

7. **Cross-tenant SaaS family** — atsx-throne (Feishu) tenants all
   share `/api/v1/user/applications` (8 Feishu adapters + bytedance
   + lilith = 10 adapters promoted from one discovery). Moka tenants
   all share `/api/outer/ats-apply/website/apply` (7 Moka + weibo).

8. **JAX-RS service taxonomy** — huawei's `/services/<X>` returns
   "No service was found" for unregistered, but `/services/portal/
   portaluser/<Y>` returns Jalor framework's structured 404 even for
   wrong methods, confirming the service prefix is real.

9. **Custom headers (X-Requested-With)** — Beisen Wecruit's
   `/wecruit/delivery/resume/<channelId>` falls through to SPA HTML
   without `X-Requested-With: XMLHttpRequest`; with it, returns
   `{type:"error",state:"809",msg:"您尚未登录..."}` — real auth gate.

Run `job-pro recon` for the live matrix any time.

**Next: real-session validation.** All 45 verified endpoints have a
real route at the right URL. The body shape might still differ from
what the real upstream expects. To fully validate a real submitter,
each adapter needs:

1. A captured candidate session (browser extension).
2. A real `--confirm-submit` fire to confirm the upstream accepts the
   multipart body we construct.
3. If 4xx, inspect the network tab for the actual body shape, patch
   the buildMultipartForm path for that adapter family.

This phase is per-user (each contributor only needs to validate the
adapters they care about); the static endpoint verification is now
done by job-pro itself.

## Per-family unblock playbook (as of 1.0.48)

28 🔑 speculative-endpoint entries remain. Cracking each family
typically unblocks its whole row group:

1. **Feishu (8 adapters)** — `cli/src/feishu.ts` factory's
   `/api/v1/resume/apply` returns 404 on anon probe; the
   `/api/v1/attachment/upload/tokens` and
   `/api/v1/attachment/exchange/tokens` steps return 405 (route exists).
   Apply path is the one missing piece — needs real-browser capture in a
   logged-in Feishu careers session. Probably constant across tenants
   (the SPA bundle is shared), so cracking one (e.g. nio) unblocks all 8.

2. **Beisen Wecruit (2 adapters)** — `/wecruit/delivery/resume/<channelId>`
   returns the SPA landing on anon probe. Apply path is likely a
   different sub-route. Capture sensetime's session and inspect XHR.

3. **Bespoke (17 adapters)** — these unblock one at a time. No shared
   factory, so each needs ~30 LOC. The 17:
   * Mainline tier (high-traffic, well-documented backends): tencent,
     bytedance, jd, baidu, didi, huawei
   * Mid-tier: xiaohongshu, kuaishou, netease, bilibili, weibo, trip,
     pingan, byd, antgroup, sf, oppo
   Static curl + grep on JS bundles doesn't work — apply URLs are
   webpack-output dynamic. Real-browser capture is the only path.

4. **Lilith CDP (1 adapter)** — uses puppeteer to bypass ByteDance
   _signature; apply path inherited from Feishu (#1). Cracking Feishu
   unblocks lilith too.

For each 🔑 unblock, the workflow:

```
1. job-pro extension              # install MV3 extension in Chrome
2. log into <co> careers site, click Export
3. mv ~/Downloads/jobpro/<co>.session.json ~/.jobpro/
4. job-pro <co> apply <id> --debug-submit-to <your-echo>
   # inspect the multipart body shape going out
5. JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes \
   job-pro <co> apply <id> --confirm-submit
   # 200 OK = success; 4xx = the specific path is wrong, network-tab
   # XHR shows real path → patch adapter
6. Set endpoint_verified: true in the adapter + add to ENDPOINT_VERIFIED
   in cli/src/index.ts. Add to test/debug-submit-smoke.ts.
```

6. **Liepin third-party (4 adapters)** — permanent ⛔. Liepin submission
   is recruiter-IM-mediated; `apply_url` opens the chat in browser
   (already the right UX).

## Why auto-submit still asks once

Submitting from a bug-ridden first version to a real Greenhouse board
sends a real application to a real recruiter. That's worse than a
read-side bug. Hence the layered safety:

1. Default verb is dry-run (no network).
2. `--debug-submit-to <url>` requires an explicit echo URL.
3. `--confirm-submit` requires a final interactive confirmation after
   showing the staged resume / answers; `--really-submit` requires
   `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes` for scripts.
4. Non-anon adapters additionally require `~/.jobpro/<co>.session.json`
   to exist (i.e. you've explicitly captured a session via the
   extension).

Together these mean a submission only fires when the user has explicitly:
- captured their session in the browser,
- confirmed the final staged payload or opted into script mode,
- run a verb that says "submit",
- and have a complete profile + resume on disk.

## Social-hire (1.1.0)

1.1.0 extends every adapter with a unified `--scope` flag:

```
--scope <social|campus|intern|all>
```

The flag works on `search`, `all`, `match`, and the cross-company `find`
verb. `apply` accepts it cosmetically (the submit endpoint doesn't change
per scope on any one company). `detail` / `dicts` / `notices` / `flow` /
`resume-check` / `memory` / `recon` / `selftest` / `list` / `status` /
`extension` / `profile` silently ignore it.

### Contract (`cli/src/adapter.ts`)

```ts
export type PositionScope = "social" | "campus" | "intern" | "all";

export interface AdapterSearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** undefined = adapter's historical default (1.0.93-compat). */
  scope?: PositionScope;
}

export interface CompanyAdapter {
  /** undefined = "I accept all 4". */
  readonly supportedScopes?: ReadonlyArray<PositionScope>;
  ...
}
```

### Dispatcher behaviour

- `runCompany` reads `--scope <value>` at the top, validates it against
  `social|campus|intern|all`, and checks `adapter.supportedScopes`. If the
  adapter has declared a tuple that excludes the requested scope, the call
  dies with `<company> does not support --scope <scope>. Supported: ...`.
- `find` treats `--scope` as a SOFT filter: only adapters whose
  `supportedScopes` includes the scope are searched; the rest are silently
  skipped from the result body and reported in
  `companies_skipped_by_scope[]` (`--text` mode prints a footer line).

### Defaults are preserved

Omitting `--scope` is NOT the same as `--scope all`. The dispatcher leaves
`scope` undefined in the options bag; each adapter falls back to its 1.0.93
default channel / recruitType / jobType. Existing scripts continue to
behave exactly as they did before 1.1.0.

### Coverage

Adapters declare `supportedScopes` to advertise which channels they can
actually query — see each adapter's source. Tier-3 (`tencent`, `jd`,
`cainiao`, `webank`, `hikvision`, `cicc`, `unitree`) declare
`["campus","intern","all"]` and refuse `--scope social` with a useful
explanation (no public social-hire API; some are WeChat-only or
recruiter-IM-mediated). Greenhouse / Lever boards (`xpeng`, `weride`,
`hoyoverse`) declare `["social","all"]` (US/intl arm hires are social by
convention).
