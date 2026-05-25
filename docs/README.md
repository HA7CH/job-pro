# docs/

This folder is the human-readable documentation for
[`@ha7ch/job-pro`](https://www.npmjs.com/package/@ha7ch/job-pro). The
project root has the headline [`README.md`](../README.md), the
[`CHANGELOG.md`](../CHANGELOG.md), and a [`LICENSE`](../LICENSE); the
files below go deeper on specific topics.

## Pick where to start

| You want to know… | Read |
|---|---|
| What `job-pro` is and how to install it | [`../README.md`](../README.md) |
| What submitting an application actually does, end-to-end | [`auto-apply.md`](./auto-apply.md) |
| Why hikvision / cicc / cainiao / webank route through Liepin | [`stub-unblock.md`](./stub-unblock.md) |
| The design decisions behind the campus / social / intern scope flag | [`social-hire-design.md`](./social-hire-design.md) |
| What's new in a specific release | [`changelog/v<version>.md`](./changelog/) (user-facing) |
| The technical "why" behind a release | [`devlog/v<version>.md`](./devlog/) (developer-facing) |

## Hand it to Claude Code

The [examples/](../examples/) folder has a copy-paste walkthrough that
hands the CLI to Claude Code with a resume and a city, and lets the agent
drive the search → shortlist → apply loop end-to-end.

## For maintainers

The release / changelog workflow for contributors and maintainers lives
in [`../AGENTS.md`](../AGENTS.md). The short version: every version bump
in `cli/package.json` requires a new `docs/changelog/v{version}.md`
(user-facing) and `docs/devlog/v{version}.md` (developer-facing); CI
enforces this via [`.github/workflows/docs-check.yml`](../.github/workflows/docs-check.yml).
