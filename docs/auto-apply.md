# Phase 2: auto-apply

Right now `job-pro` only hits each company's public read APIs. Submitting an
application is gated by a logged-in session, which we deliberately don't
implement yet.

## What we'd need

1. **Capture session.** Each careers site uses its own login UX. The CLI can't
   embed a browser, so the most user-friendly path is "log into the site in
   your normal browser, then run a one-time bookmarklet / export step that
   copies the cookies into `~/.jobpro/`".
2. **Re-use that session for the submission call.** This is the part that
   needs reverse-engineering per company. Tencent's `join.qq.com` uses
   server-side session cookies + CSRF tokens; the others differ.
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

## Tracking

| Company    | Login method                          | Submit endpoint        | Status |
|------------|---------------------------------------|------------------------|--------|
| Tencent    | session cookie via join.qq.com login  | TBD                    | ⏳     |
| ByteDance  | unknown                               | unknown                | ⏳     |
| Didi       | unknown                               | unknown                | ⏳     |
