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
* **`--really-submit`** is gated behind `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes`
  AND (for non-anon adapters) requires `~/.jobpro/<co>.session.json` to
  exist. Both gates can be cleared with explicit user action; we never
  fire a submission without them.

## Quickstart

```bash
job-pro profile init           # write ~/.jobpro/profile.json template
$EDITOR ~/.jobpro/profile.json # fill first_name / last_name / email / phone / resume_path

# Greenhouse / Lever (anonymous submission)
job-pro xpeng apply 8548990002                                  # dry-run
job-pro xpeng apply 8548990002 --debug-submit-to https://httpbin.org/post
JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \
  job-pro xpeng apply 8548990002 --really-submit                # actually fires

# Adapters needing session.json (Beisen / Moka / Feishu / bespoke):
# 1. job-pro extension  (prints path + 6-step Chrome install walkthrough)
# 2. Log into the careers site in your normal browser
# 3. Click extension → Export → mv ~/Downloads/jobpro/<co>.session.json ~/.jobpro/
# 4. job-pro <co> apply <postId> --really-submit (with the env-var set)
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

**Tally as of 1.0.48:**
* **17 ✅ verified** — endpoint URL confirmed real via probe or
  end-to-end smoke. Cleared the 4th safety gate. See ✓ in `job-pro list`.
  * 3 anon multipart (xpeng / weride / hoyoverse) — end-to-end smoked
    against httpbin echo.
  * 5 multipart-session (alibaba / pdd / meituan / mihoyo / liauto) —
    probe returned auth gate or business error.
  * 7 moka-aes (all Moka adapters: moonshot / megvii / deepseek /
    galaxyuniversal / stepfun / cambricon / geely) — probe returned
    AES `{data, necromancer}` envelope.
  * 2 beisen-italent (iflytek / vivo) — probe returned HTTP 500 + IIS
    server-error template (route exists, handler threw on missing input).
* **28 🔑 executor-wired, endpoint speculative** — schema + executor
  exist but probe returned 404 / HTML fallthrough. Split:
  * 17 bespoke multipart-session — tencent / bytedance / xiaohongshu /
    jd / kuaishou / baidu / netease / didi / bilibili / huawei / weibo
    / pingan / trip / byd / antgroup / sf / oppo
  * 8 feishu-3-step — xiaomi / nio / minimax / zhipu / iqiyi / agibot
    / zerooneai / baichuan
  * 2 beisen-wecruit — sensetime / horizonrobotics
  * 1 cdp-real-browser — lilith
  Need real-browser network capture to find the right apply path.
  `--really-submit` requires `JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes`.
* **5 ⛔ external** — Liepin recruiter chat × 4 (hikvision / cicc /
  cainiao / webank), Unitree WeChat QR × 1. Structurally non-API
  (IM-mediated); the CLI surfaces `apply_url` and declines to automate.

Run `job-pro recon` for the live matrix.

To promote a 🔑 to ✅: capture the adapter's session via the browser
extension, run `apply <id> --debug-submit-to <your-echo>` to inspect what
goes out, fire a real `--really-submit` against your own application
(under JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes), confirm 200, then patch
the adapter to set `endpoint_verified: true`. Static-only recon (curl +
grep on the JS bundle) doesn't work for most of these — the apply URL is
constructed dynamically by the SPA's webpack output and requires
real-browser network capture to extract reliably.

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
5. JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \
   JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes \
   job-pro <co> apply <id> --really-submit
   # 200 OK = success; 4xx = the specific path is wrong, network-tab
   # XHR shows real path → patch adapter
6. Set endpoint_verified: true in the adapter + add to ENDPOINT_VERIFIED
   in cli/src/index.ts. Add to test/debug-submit-smoke.ts.
```

6. **Liepin third-party (4 adapters)** — permanent ⛔. Liepin submission
   is recruiter-IM-mediated; `apply_url` opens the chat in browser
   (already the right UX).

## Why we don't auto-submit yet

A real `--really-submit` from a bug-ridden first version to a real
Greenhouse board sends a real application to a real recruiter. That's
worse than a read-side bug. Hence the layered safety:

1. Default verb is dry-run (no network).
2. `--debug-submit-to <url>` requires an explicit echo URL.
3. `--really-submit` requires `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes`.
4. Non-anon adapters additionally require `~/.jobpro/<co>.session.json`
   to exist (i.e. you've explicitly captured a session via the
   extension).

Together these mean a submission only fires when the user has explicitly:
- captured their session in the browser,
- attested to the env-var prompt,
- run a verb that says "really submit",
- and have a complete profile + resume on disk.
