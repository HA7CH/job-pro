# job-pro — examples

Templates + a walkthrough for running an actual application end-to-end.
Mostly useful once you've installed the CLI globally:

```bash
npm i -g job-pro
job-pro --version
```

## Files in this directory

| File                                  | Purpose                                                              |
|---------------------------------------|----------------------------------------------------------------------|
| `profile.example.json`                | A fully-filled `~/.jobpro/profile.json` template.                    |
| `forms/greenhouse-xpeng.json`         | Per-job overrides for an XPeng (Greenhouse) posting — 9 fields.      |
| `forms/feishu-nio.json`               | Per-job overrides for a NIO (Feishu) posting — mostly empty.         |
| `walkthrough.md`                      | Step-by-step e2e dry-run + real submit for an XPeng intern role.     |

## Five-minute setup

```bash
# 1. Profile
job-pro profile init                            # writes ~/.jobpro/profile.json template
cp examples/profile.example.json ~/.jobpro/profile.json
$EDITOR ~/.jobpro/profile.json                  # fill name/email/phone/resume_path

# 2. Sanity check
job-pro status                                  # should show Profile ✓, Chrome ✓

# 3. Find a job
job-pro xpeng search "AI" --page-size 5

# 4. Stage an application (dry-run, no network)
job-pro xpeng apply 8548990002

# 5. Fill the custom fields
#    Option A — programmatic (one-off per job):
job-pro xpeng apply 8548990002 --form-file examples/forms/greenhouse-xpeng.json

#    Option B — interactive (terminal prompts):
job-pro xpeng apply 8548990002 --interactive

#    Option C — write the answers to your global profile:
job-pro xpeng apply 8548990002 --print-form > /tmp/form.json
$EDITOR /tmp/form.json                          # fill `value` for each field
job-pro xpeng apply 8548990002 --form-file /tmp/form.json

# 6. Verify the wire format (no upstream impact)
job-pro xpeng apply 8548990002 \
  --form-file examples/forms/greenhouse-xpeng.json \
  --debug-submit-to https://httpbin.org/post

# 7. Actually submit
JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \
  job-pro xpeng apply 8548990002 \
  --form-file examples/forms/greenhouse-xpeng.json \
  --really-submit
```

## Capturing a session (for non-Greenhouse/Lever adapters)

The 42 non-anon adapters need a logged-in candidate session. Install
`extension/` in Chrome, log into the careers site, click the toolbar
icon → **Export**. Then move the file:

```bash
mv ~/Downloads/jobpro/nio.session.json ~/.jobpro/
job-pro nio apply 7639693860494543167 --really-submit
```

`job-pro status` will then show `Sessions ✓  N captured`.
