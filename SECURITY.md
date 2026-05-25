# Security policy

`job-pro` is a local-first CLI: it reads public careers APIs from your own
machine, optionally submits applications using **your** browser session
that you capture yourself. There is no `job-pro` server. There is no
account. We do not see your queries, your résumé, or your applications.

That said, two parts of the surface area carry real risk if mishandled:

1. **Captured session files** (`~/.jobpro/<adapter>.session.json`). These
   contain cookies + CSRF/XSRF headers that authenticate you to a careers
   site. They are stored locally, never transmitted to any third party by
   `job-pro` itself, and are not collected by us. Treat them as you would
   any other browser credential: they grant the same access your browser
   has to that site.
2. **The `--really-submit` / `--confirm-submit` path** posts an actual
   application to a real employer. We layer 4 safety gates (consent,
   `staged.ready`, `endpoint_verified`, fresh session) but the final
   responsibility is yours.

## Reporting a vulnerability

If you find a security issue — credential exposure, unintended network
egress, a way to bypass the consent gates, anything you'd want fixed
before a tweet — please **email** the maintainer instead of opening a
public issue:

> **security@ha7ch.com**

Include:

* a description of the issue and its impact,
* steps to reproduce (`job-pro --version` + the exact command line),
* what behaviour you expected vs. observed,
* any mitigations you've identified.

We aim to acknowledge within 72 hours and to ship a fix (or a clear
explanation of why we can't) within 30 days for confirmed issues.
Coordinated disclosure is appreciated; we'll credit you in the release
notes unless you'd rather stay anonymous.

## Supported versions

We ship fixes for the **latest minor** on npm
(`@ha7ch/job-pro@latest`). Older versions are not patched.

## Out of scope

* Issues that require physical access to an already-unlocked machine
  with `~/.jobpro/` readable.
* Behaviour of upstream careers sites themselves (Tencent, ByteDance,
  Liepin, etc.) — those are not our infrastructure. Please report
  upstream-side issues to the operator.
* Findings that depend on running an unrelated malicious binary on the
  user's machine.
