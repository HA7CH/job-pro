# job-pro session bridge — Chrome extension

Manifest v3 extension that captures careers-site session cookies + CSRF/XSRF
headers for use by the CLI's auto-apply (Phase 2.1). Unlike the simple
Greenhouse / Lever boards (where the apply form is open-access and the CLI
can submit anonymously via `--debug-submit-to`), most Chinese ATS tenants
gate `apply` behind a logged-in candidate session. This extension lets
users log in once in their normal browser, then export the captured
session into `~/.jobpro/<adapter>.session.json` for the CLI to re-use.

## Install (developer mode, local)

```bash
# Repo root
cd extension/
# Optional: generate placeholder icons (just colored squares).
# The extension still loads without them; popup just won't have an icon.
```

1. Open Chrome → `chrome://extensions/` → enable **Developer mode**.
2. Click **Load unpacked** → select the `extension/` directory.
3. Pin the puzzle-piece icon to the toolbar for quick access.

## Capture a session

1. Log into any supported careers site (e.g. `talent.antgroup.com`,
   `iflytek.zhiye.com`, `app.mokahr.com/.../<org>/<siteId>`).
2. Browse around — view a job, open the apply modal — so the SPA fires
   its auth-bearing XHRs. The extension listens for `Cookie`,
   `X-Xsrf-Token`, `Authorization`, and Feishu/Beisen-style headers
   (`X-Fscp-Std-Info`, `langtype`, etc.) and caches them by adapter key.
3. Click the toolbar icon → **Export** on the captured row. The
   extension downloads `jobpro/<adapter>.session.json` via Chrome's
   download manager.
4. Move the file:
   ```bash
   mkdir -p ~/.jobpro
   mv ~/Downloads/jobpro/<adapter>.session.json ~/.jobpro/
   ```

## What's in the JSON

```json
{
  "adapter": "antgroup",
  "host": "talent.antgroup.com",
  "exported_at": "2026-05-16T08:00:00.000Z",
  "headers": {
    "x-xsrf-token": "VSQK2wSZQC-DRAZxaQevxQ",
    "x-fscp-std-info": "{\"client_id\": \"40108\"}",
    "cookie": "<full cookie header>",
    "...": "..."
  },
  "cookies": [
    { "name": "XSRF-TOKEN", "value": "…", "domain": ".liepin.com", "path": "/", … }
  ]
}
```

The CLI doesn't read this file yet — Phase 2.1 wires that in.
Today the file is the deliverable; future iterations land the
`<adapter>.applyWithSession(sessionPath, postId)` flow.

## Why MV3, not a content script injection

We need `chrome.cookies` to dump HttpOnly cookies (used by every Chinese
ATS we've probed). Only background service workers can call
`chrome.cookies.getAll()`. The popup just talks to the worker via
`chrome.runtime.sendMessage`.

## Scope (privacy)

* Only captures headers from hosts explicitly listed in
  `manifest.json#host_permissions`. Browsing anywhere else is invisible
  to the extension.
* Storage is `chrome.storage.local` — never synced, never sent to any
  remote.
* Exports are user-triggered downloads to `~/Downloads/jobpro/`. No
  network egress.
