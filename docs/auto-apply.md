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

**Tally:** 3 ✅ wired, 38 🔑 awaiting session+endpoint recon, 9 ⛔ structural blocks
(WeChat mini-program + Liepin IM-mediated). For the 38 🔑 entries, each
unblock = one iteration: capture session via extension → probe upstream's
apply XHR with puppeteer-core → wire the family's submit factory.

## Per-family unblock playbook

The 38 🔑 entries fall into 6 families. Cracking each family unblocks
its whole row group:

1. **Feishu (9 adapters)** — single `cli/src/feishu.ts` factory addition.
   The `POST /api/v1/application/create` endpoint is documented; need to
   confirm the body shape per tenant (likely
   `{ job_post_id, applicant_info, resume_file_token }`). Resume upload
   is a separate `POST /api/v1/file/upload` step that returns a token.

2. **Moka (7 adapters)** — single `cli/src/moka.ts` factory addition.
   AES-128-CBC envelope same as our existing list-job decrypt path; we
   already have the `necromancer` key + `aesIv` extraction working.

3. **Beisen Wecruit (2 adapters)** — same generic playbook as our
   `cli/src/wecruit.ts` factory; submit endpoint is on the same host.

4. **Beisen iTalent (2 adapters)** — same playbook as `cli/src/vivo.ts`
   factory; submit endpoint is on `<tenant>.zhiye.com`.

5. **Bespoke (22 adapters)** — these unblock one at a time. The 22 share
   no common factory, so each needs ~30 LOC. Total estimated work:
   2-3 iterations of careful recon + wire-up.

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
