# Contributing to job-pro

Thanks for taking the time to look at this project. The bar for accepted
contributions is "makes the CLI safer, broader, or easier for a future
contributor to extend." Most PRs land in under a week.

## Quick start

The repo is a monorepo. **The root is a Next.js landing page; the
`cli/` directory is the npm package.** They use different package managers:

```bash
# CLI (npm + package-lock.json) — this is what we publish
cd cli
npm ci
npm run build
npm run test:unit       # 35 pure unit tests, no network

# Web site (pnpm + pnpm-lock.yaml)
pnpm install            # at repo root; npm install will hang on this tree
pnpm run build
```

`Node >= 18` everywhere. `tsx` is the dev runner (`npx tsx src/index.ts <co> <verb>`).

## Running tests

Three test suites live in `cli/test/`:

| Command | What it does | Network? | Safe to run? |
|---|---|---|---|
| `npm run test:unit`         | Validators / regexes / form helpers — no I/O | no  | always |
| `npm run test`              | Live smoke against every adapter's read APIs | yes | yes — read-only |
| `npm run test:debug-submit` | End-to-end apply against `httpbin.org/post`  | yes | yes — echoes the wire format, never reaches careers sites |
| `npm run test:apply`        | **Real submission against the careers sites** | yes | **NO** — only run with full understanding |

GitHub Actions only runs `test:unit` (the live suites hit China-hosted APIs
that the runners get geo-blocked on). Live smoke is part of every local
dev cycle.

## Adding a new company

Most additions are mechanical. The full checklist:

1. **Find the public listing/detail API.** DevTools → Network on the
   careers page is the fast path. If the SPA is gated by Tengine
   `_signature` / EdgeOne JS cookies / Cloudflare challenges, you may
   need `cli/probe/<company>-network.ts` (puppeteer-core) to intercept
   the real XHR — see existing probes for templates.
2. **Check for an existing factory first.** If the careers site is built
   on Feishu / Greenhouse / Lever / Moka / Beisen-Wecruit /
   Beisen-iTalent / Liepin, the corresponding `cli/src/<family>.ts`
   factory does most of the work — your adapter becomes a ~30-line
   `createAdapter({ … })` wrapper. **Do not copy a bespoke adapter when
   a factory exists.**
3. **Otherwise mirror an existing bespoke adapter** — `cli/src/tencent.ts`
   is the canonical reference (it predates the factory pattern but is
   the most-tested bespoke shape).
4. **Wire it up:**
   - add the export to `cli/src/index.ts` `ADAPTERS`
   - add a smoke-test entry in `cli/test/smoke.ts`
   - the `satisfies CompanyAdapter` clause will refuse to compile if any
     of the 9 required verbs is missing
5. **Add the company card** to `src/app/page.tsx`'s `COMPANIES` array.
6. **Run the smoke suite.** `npm test` runs every adapter in parallel and
   FAILs on `ok:false` for non-`KNOWN_LIMITED` adapters.
7. **Update the per-version docs** (next section).
8. **Open a PR.**

## Documentation is mandatory

Every PR that bumps `cli/package.json` "version" must also include:

* `docs/changelog/v{version}.md` — **user-facing** notes (口语化, no
  file paths, no code).
* `docs/devlog/v{version}.md`    — **developer-facing** technical log
  (file paths, function names, root cause).

CI enforces this via `.github/workflows/docs-check.yml`; the PR will
fail until both files exist. See `AGENTS.md` for the templates and
`docs/changelog/v1.0.93.md` + `docs/devlog/v1.0.93.md` for full
worked examples.

## PR checklist

- [ ] `npm run build` passes inside `cli/`
- [ ] `npm run test:unit` passes
- [ ] `npm test` shows your new/modified adapter as `ok:true`
- [ ] `docs/changelog/v{version}.md` and `docs/devlog/v{version}.md`
      exist for the new version
- [ ] No unrelated whitespace / formatting churn in unrelated files

## Reporting security issues

Please **do not** open public GitHub issues for security findings. See
[`SECURITY.md`](./SECURITY.md) for the responsible-disclosure path.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md)
v2.1. By participating you agree to uphold those norms.

## Licence

By submitting a PR you agree your contribution is licensed under the
project's [MIT licence](./LICENSE).
