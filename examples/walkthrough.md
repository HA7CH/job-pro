# End-to-end walkthrough: applying to an XPeng intern role

This walks through exactly what happens when you run
`job-pro xpeng apply <id> --really-submit`. XPeng's Greenhouse board
(`xpengmotors`) is one of three adapters that submits anonymously
(no session.json needed), so it's the cleanest entry point.

## Stage 1 — Profile

The fastest path is the interactive wizard (1.0.8+):

```bash
$ job-pro profile init --interactive
First name: Jian
Last name: Zhang
Email: jian.zhang@example.com
Phone (with country code, e.g. +86 13800138000): +86 13800138000
Resume file path (absolute, PDF/DOCX): /Users/jian/Documents/resume.pdf
```

Or write the template and edit manually:

```bash
$ job-pro profile init && $EDITOR ~/.jobpro/profile.json
```

Either way, verify the result:

```bash
$ job-pro profile lint           # checks email regex, phone country code, resume_path exists
  ✓ first_name    Jian
  ✓ last_name     Zhang
  ✓ email         jian.zhang@example.com
  ✓ phone         +86 13800138000
  ✓ resume_path   /Users/jian/Documents/resume.pdf

  0 fail / 0 warn / 5 pass
```

`job-pro status` should also report `Profile ✓`.

## Stage 2 — Find a job

```bash
$ job-pro xpeng search "AI" --page-size 3
{
  "ok": true,
  "source": "boards-api.greenhouse.io/xpengmotors",
  "total": 7,
  "positions": [
    {
      "post_id": "8548990002",
      "title": "AI Agent Data Pipeline Intern",
      "work_cities": "Santa Clara, CA",
      "apply_url": "https://job-boards.greenhouse.io/xpengmotors/jobs/8548990002"
    },
    …
  ]
}
```

## Stage 3 — Stage the application (dry-run)

```bash
$ job-pro xpeng apply 8548990002
source:    boards-api.greenhouse.io/xpengmotors
job:       8548990002 — AI Agent Data Pipeline Intern
apply_url: https://job-boards.greenhouse.io/xpengmotors/jobs/8548990002
submit:    POST https://boards-api.greenhouse.io/v1/boards/xpengmotors/jobs/8548990002

ready: ✗ 7 required field(s) unfilled

Staged payload:
  • first_name            input_text  Jian
  • last_name             input_text  Zhang
  • email                 input_text  jian.zhang@example.com
  • phone                 input_text  +86 13800138000
  • resume                input_file  <file: /Users/jian/Documents/resume.pdf>
    cover_letter          input_file  <empty>
    question_36528765002  input_text  <empty>
    question_36528766002  input_text  <empty>
  • question_36528767002  multi_value_single_select  <unanswered>
  • question_36528768002  multi_value_single_select  <unanswered>
  • question_36528769002  multi_value_single_select  <unanswered>
  • question_36528770002  textarea                   <unanswered>
  • question_36528771002  multi_value_single_select  <unanswered>
  • question_36528772002  multi_value_single_select  <unanswered>
  • question_36528773002  multi_value_single_select  <unanswered>

Fill the unanswered required fields. Easiest path:
  1. job-pro xpeng apply 8548990002 --print-form > form.json
  2. Edit form.json — set each `value` for required fields.
  3. job-pro xpeng apply 8548990002 --form-file form.json
```

## Stage 4 — Fill the form (pick one)

### Option A — `--interactive` (recommended)

```bash
$ job-pro xpeng apply 8548990002 --interactive

Interactive mode — fill the required fields for "AI Agent Data Pipeline Intern".

Will you be able to intern full-time and onsite at our Santa Clara, CA office?
(required) [question_36528767002]
  Options:
    [1] Yes
    [2] No
> 1

Have you ever worked at XPENG or any of its affiliates? (required)
  Options:
    [1] Yes
    [2] No
> 2

… (5 more)

Collected 7 answer(s). Staging now…
ready: ✓ all required fields filled
```

Add `--remember` to persist the collected answers into
`~/.jobpro/profile.json` under `custom.<question_name>`. Next job at
the same Greenhouse board will auto-resolve shared questions without
re-prompting:

```bash
$ job-pro xpeng apply 8548990002 --interactive --remember
…
Saved 7 answer(s) to /Users/jian/.jobpro/profile.json (custom.*).
```

### Option B — `--form-file`

```bash
$ cp examples/forms/greenhouse-xpeng.json /tmp/form.json
$ $EDITOR /tmp/form.json   # adjust any default answers
$ job-pro xpeng apply 8548990002 --form-file /tmp/form.json
ready: ✓ all required fields filled
```

## Stage 5 — Verify wire format (no upstream impact)

```bash
$ job-pro xpeng apply 8548990002 \
    --form-file /tmp/form.json \
    --debug-submit-to https://httpbin.org/post --compact \
  | python3 -m json.tool

{
  "mode": "debug-submit",
  "submit_kind": "multipart-anon",
  "result": {
    "ok": true,
    "status": 200,
    "posted_to": "https://httpbin.org/post",
    "message": "submission accepted (HTTP 200)",
    "response_preview": "..."
  }
}
```

The `--debug-submit-to` redirect lets you inspect the exact
multipart/form-data body that would have hit Greenhouse, fired through
your chosen echo server.

## Stage 6 — Actually submit

```bash
$ job-pro xpeng apply 8548990002 --form-file /tmp/form.json --confirm-submit

# Script mode is still available when you intentionally want no prompt:
$ JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \
    job-pro xpeng apply 8548990002 --form-file /tmp/form.json --really-submit
```

Four gates fire before any HTTP request:

1. User consent: either type `submit` in the `--confirm-submit` prompt,
   or set `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes` for script mode.
2. `staged.ready` — every required field has a value.
3. `endpoint_verified === true` unless you explicitly set
   `JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes` while probing.
4. For non-anon adapters (everyone except Greenhouse/Lever), a captured
   `~/.jobpro/<adapter>.session.json` from the browser extension.

Missing any of those, the CLI returns `mode: "really-submit-blocked"`
or `mode: "confirm-submit-blocked"` with a pointed remediation message
instead of firing anything.

## Stage 7 — Log it

```bash
$ job-pro xpeng memory event applied "XPeng AI Pipeline Intern 8548990002"
$ job-pro status   # now reports the event in the Memory section
```

The `memory` subcommand is the local-only journal — useful for tracking
which jobs you've applied to without leaking that data anywhere.
