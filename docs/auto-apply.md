# Phase 2: auto-apply

Phase 1 (read jobs) is now done: 50 / 50 companies live. This doc is the
forward plan for Phase 2 — actually submitting applications. We deliberately
do NOT implement it yet because every careers site uses its own login UX
and CSRF flow, and writing a bug there has worse consequences than a
read-side bug.

## What we'd need

1. **Capture session.** Each careers site uses its own login UX. Two
   user-friendly paths:
   * Re-use `cli/src/cdp.ts` to drive the user's local Chrome — they log in
     manually, the CLI watches the cookie jar.
   * Ship a small browser extension that exposes the page's cookies +
     CSRF headers to the CLI via a local file under `~/.jobpro/<co>.json`.
2. **Re-use that session for the submission call.** This is the part that
   needs reverse-engineering per company. Tencent's `join.qq.com` uses
   server-side session cookies + CSRF tokens; the Feishu / Beisen / Moka
   tenants each gate submissions differently.
3. **Decide what to actually post.** A submission usually means picking a
   stored resume variant, answering 1–3 questions, and confirming. We can
   stage all of that locally before the user types `confirm`.
4. **Avoid abuse.** No bulk submission, no scraping. One application at a
   time, user-initiated, dry-run by default.

## Open questions

- Where do we keep resume variants? The `memory` subcommand already stores
  arbitrary key=value pairs, but a full resume is JSON, not a string.
- Should auto-apply require an explicit "I've read the company's terms"
  flag on first use?
- Should we maintain a leaderboard of which company breaks the integration
  most often, so users know what to expect?

## Tracking — Phase 2 starts here

The matrix below scopes Phase 2 to a *representative subset* across the
ATS families we already cover. Once the pattern works for one tenant on
each family, expanding to the rest is mechanical.

| Phase-2 pilot | ATS family             | Login method                              | Submit endpoint                          | Status |
|---------------|------------------------|-------------------------------------------|------------------------------------------|--------|
| Tencent       | bespoke (join.qq.com)  | session cookie via login form             | `POST /api/v1/position/applyResume`       | ⏳     |
| ByteDance     | bespoke (jobs.bytedance.com) | session cookie + CAPTCHA              | `POST /api/v1/user_apply`                 | ⏳     |
| NIO           | Feishu Recruiting      | Feishu tenant session                     | `POST /api/v1/application/create`         | ⏳     |
| Megvii        | Moka                   | Moka org login + AES envelope              | `POST /api/outer/ats-apply/website/apply` | ⏳     |
| vivo          | Beisen iTalent (zhiye) | iTalent candidate session                  | TBD                                       | ⏳     |
| SenseTime     | Beisen Wecruit         | Beisen Wecruit candidate session           | TBD                                       | ⏳     |
| XPeng         | Greenhouse             | n/a (apply via Greenhouse-hosted form)     | `POST /v1/applications`                   | ⏳     |
| WeRide        | Lever                  | n/a (apply via Lever-hosted form)          | `POST /v0/applications`                   | ⏳     |
| Hikvision     | Liepin (third-party)   | Liepin login + IM-recruiter chat          | n/a (IM-mediated, no API submission)      | ⛔     |

The bottom row is intentional: for the four Liepin-backed adapters
(`hikvision` / `cicc` / `cainiao` / `webank`) Phase 2 doesn't apply
because their canonical portals don't expose anonymous submission either.
For those, "auto-apply" reduces to opening the Liepin job's
`apply_url` in the user's browser and surfacing the recruiter's IM
handle — which is what `apply_url` already does today.

## Rollout plan

1. Build `cli/src/auto-apply.ts` infrastructure: `~/.jobpro/<co>.json`
   reader, dry-run wrapper, confirmation prompt.
2. Pilot with Tencent — the original recon source, simplest cookie auth.
3. Move to Greenhouse / Lever — they have well-documented public submit
   APIs and self-hosted apply forms.
4. Tackle Feishu / Moka / Beisen — each needs separate session capture.
5. ByteDance / ant social / Alibaba — these have CAPTCHA / OAuth gates;
   expect each to need a CDP-driven login dance.
