# Social-Hire Rollout — Design Document

Status: draft / v1
Target version: `1.1.0` (minor bump — additive, no breaking changes to default behaviour)
Scope: extend all 50 adapters with a unified `scope` axis (`social | campus | intern | all`) while preserving every existing campus-default behaviour.

## 0. Design intent and non-goals

**Goals.**
1. One CLI surface flag (`--scope`) maps to one canonical `PositionScope` enum across the type system.
2. Adapters declare which scopes they support; the dispatcher fails fast with a useful message when a caller asks for an unsupported one.
3. The existing default (largely campus / mixed) is preserved bit-for-bit when `--scope` is omitted, so 1.0.93 callers see no behaviour change after 1.1.0.
4. 30 Tier-1 companies become social-queryable in a single coordinated PR train without merge conflicts across many worktrees.

**Non-goals.**
- Adding new apply executors for social positions. The Phase 2 submit path is family-driven and scope-agnostic.
- Adding new ATS families.
- Changing `endpoint_verified` semantics.

---

## 1. CLI surface design

### 1.1 The flag

```
--scope <social|campus|intern|all>
```

- Position: works on every per-company verb (`search`, `all`, `match`, `apply`) and on the cross-company verb `find`.
- Default: **omitted** = `undefined`, NOT `"all"`. Adapters distinguish "caller didn't say" from "caller explicitly asked for everything", so we preserve each adapter's historical default.
- Casing: lower-case only. Reject anything else with `unknown scope: <value>. Accepted: social, campus, intern, all.`

### 1.2 Why `scope` not `recruit-type`

Six adapters already expose a `recruitType` field on their per-adapter `SearchOptions`, with slightly different value sets. Adding a top-level CLI flag named `--recruit-type` would shadow/conflict with these. `scope` is unused, short, and reads naturally with `social` / `campus` / `intern`.

The factory and adapter-level `recruitType` / `channel` / `campusOnly` / `workType` / `zpType` / `seasonType` fields stay untouched — `scope` is the **CLI-side ubiquitous name**, which each adapter translates internally.

### 1.3 Verbs and how each consumes `scope`

| Verb | `--scope` semantics |
|------|--------------------|
| `search`  | Passes `scope` into `adapter.searchPositions({ scope, ... })`. Adapter translates. |
| `all`     | Passes `scope` into `adapter.fetchAllPositions({ scope, ... })`. For multi-channel adapters, `scope=all` may issue parallel calls and merge. |
| `match`   | Passes `scope` into `adapter.matchResume(text, { scope })`. |
| `apply`   | Cosmetic — `scope` doesn't affect apply, since the upstream apply endpoint is the same per company. Accept it, ignore in body. |
| `find`    | Pass-through to every company. Companies that don't support the requested scope are excluded from the result set. |
| `detail`, `dicts`, `notices`, `notice`, `flow`, `resume-check`, `memory`, `recon`, `selftest`, `list`, `status`, `extension`, `profile` | Unaffected. `--scope` is silently ignored. |

### 1.4 Combining with existing flags

`--scope` is parsed by the existing `popAllOpts(args)` harvester. After parse, `opts.scope` arrives in the adapter's options bag as a plain string.

Validation: if the value isn't one of `social|campus|intern|all`, die early with `die(`unknown scope: ${v}. Accepted: social, campus, intern, all.`)`.

### 1.5 `find` cross-company scope semantics

`find` already iterates every adapter; the scope flag becomes a soft filter:

1. Companies whose `supportedScopes` includes the requested scope → searched with `scope` passed through.
2. Companies whose `supportedScopes` does NOT include it → SILENTLY skipped from the result body (NOT counted in `failed`). The summary line shows `... across N/M companies (scope-filtered)`.
3. When `--text` mode is on and `--scope social` is set, print a footer of skipped Tier-3 companies.

### 1.6 JSON output additions

For per-company verbs the adapter's existing JSON shape gains an optional `scope` echo:

```json
{
  "ok": true,
  "source": "job.byd.com",
  "scope": "social",
  "query": { /* unchanged */ },
  "positions": [
    {
      "post_id": "...",
      "title": "...",
      "recruit_label": "社招",
      ...
    }
  ]
}
```

`find` output adds `scope_used` and `companies_skipped_by_scope[]`.

### 1.7 HELP text additions

Add to the per-verb help:

```
  --scope <social|campus|intern|all>     restrict to a single recruit channel
                                         (default: each adapter's historical pick)
```

Example block gets one line:
```
  job-pro tencent search "后台开发" --scope social --page-size 5
```

---

## 2. CompanyAdapter contract extension

### 2.1 Type additions in `cli/src/adapter.ts`

```ts
/** One canonical scope name across the entire CLI. */
export type PositionScope = "social" | "campus" | "intern" | "all";

export interface AdapterSearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Caller-requested recruit scope. Adapters translate to their upstream
   *  channel/recruitType/jobType/workType key. `undefined` = adapter's
   *  historical default (preserves 1.0.93 behaviour). */
  scope?: PositionScope;
  [extra: string]: unknown;
}

export interface AdapterAllOptions extends AdapterSearchOptions {
  maxPages?: number;
}
```

### 2.2 `supportedScopes` declaration

```ts
export interface CompanyAdapter {
  /** Scopes this adapter can actually query. Optional for backward
   *  compatibility — undefined = "I accept all 4". */
  readonly supportedScopes?: ReadonlyArray<PositionScope>;
  searchPositions(opts?: AdapterSearchOptions): Promise<unknown>;
  fetchAllPositions(opts?: AdapterAllOptions): Promise<unknown>;
  /* ... rest unchanged ... */
}
```

Each adapter module exports `supportedScopes` as a `readonly` tuple alongside its existing exports:

```ts
export const supportedScopes = ["social", "campus", "intern", "all"] as const;
```

### 2.3 Dispatcher behaviour for unsupported scope

In `runCompany`, after `popAllOpts` extracts `scope`:

```ts
const scope = typeof opts.scope === "string" ? opts.scope : undefined;
if (scope !== undefined) {
  const supported = (adapter.supportedScopes as readonly string[] | undefined) ?? ["social","campus","intern","all"];
  if (!supported.includes(scope)) {
    die(`${company} does not support --scope ${scope}. Supported: ${supported.join(", ")}.`);
  }
}
```

### 2.4 `scope: "all"` semantics

- Single-upstream-channel adapters (didi, weride, xpeng, hoyoverse, alibaba, agibot, minimax, zerooneai): `all` and `undefined` produce identical results.
- Multi-channel adapters (antgroup, megvii, weibo, horizonrobotics, mihoyo, baidu, oppo, sf, iflytek, vivo, pingan, kuaishou, bytedance, xiaomi, netease): `all` means "fetch each channel and merge".

---

## 3. ATS family factory changes

### 3.1 `cli/src/feishu.ts`

Config gains:

```ts
export interface FeishuAdapterConfig {
  host: string;
  channel: string;
  socialChannel?: string;
  internChannel?: string;
  label: string;
  applyUrlPrefix: string;
  supportedScopes?: ReadonlyArray<PositionScope>;
}
```

Scope translation:

```ts
function channelForScope(s: PositionScope | undefined): { channel: string; recruitmentIdList?: string[] } {
  if (s === "social" && cfg.socialChannel) return { channel: cfg.socialChannel };
  if (s === "intern"  && cfg.internChannel) return { channel: cfg.internChannel };
  if (s === "social") return { channel: cfg.channel, recruitmentIdList: ["101"] };
  if (s === "intern") return { channel: cfg.channel, recruitmentIdList: ["202"] };
  if (s === "campus") return { channel: cfg.channel, recruitmentIdList: ["201"] };
  return { channel: cfg.channel };
}
```

### 3.2 `cli/src/moka.ts`

Add `pickChannelForScope(s: PositionScope)`. For `scope=all` on tenants with both campus + social channels, parallel-fetch and merge.

### 3.3 `cli/src/wecruit.ts`

Already structurally scope-aware via `SearchOptions.recruitType`. Bespoke adapter translates CLI `scope` → factory `recruitType`. Wire `supportedScopes` derived from `cfg.channels[].recruitType`.

### 3.4 Beisen iTalent (vivo / iflytek)

The `categoryFromRecruitType()` helper in vivo.ts: rename to `categoryFromScope`. Fill iflytek's mapping (`"3"=intern, "4"=social, "5"=campus`).

### 3.5 Greenhouse / Lever (xpeng / hoyoverse / weride)

Set `supportedScopes = ["social","all"]` and ignore the flag (these boards are 100% social/experienced by convention).

### 3.6 Liepin

`supportedScopes = ["social","campus","intern","all"]`; scope flows into Liepin search URL fragment.

---

## 4. Tier-1 adapter mapping table (30 companies)

| # | Adapter key | Current endpoint | Default param | `scope=social` ⇒ param value | Translation location |
|---:|---|---|---|---|---|
| 1 | `meituan` | POST `/job/getJobList` | `jobType:["1","2"]` | `jobType:["3"]` | meituan.ts (bespoke) |
| 2 | `xiaohongshu` | POST `/websiterecruit/position/pageQueryPosition` | `recruitType:"campus"` | `recruitType:"social"` | xiaohongshu.ts |
| 3 | `antgroup` | POST `/social/position/search` or `/campus/position/search` | `recruitType:"all"` | `recruitType:"social"` | antgroup.ts |
| 4 | `liauto` | GET `/v1/recruit/school/job-page` | `campusOnly:true` | `campusOnly:false` (use `/social/job-page`) | liauto.ts |
| 5 | `byd` | POST `/portal/api/portal-api/position/queryList` | `zpType:"00251"` | `zpType:"00251"` (already social) | byd.ts `supportedScopes:["social","all"]` |
| 6 | `trip` | POST `/getJobAd` | `category:"2"` | `category:"1"` | trip.ts |
| 7 | `netease` | POST `/post-app/.../list` | `workType:"1"` | `workType:"0"` | netease.ts |
| 8 | `moonshot` | Moka portal | `defaultRecruitType:"social"` | unchanged | moonshot.ts `supportedScopes:["social","all"]` |
| 9 | `zhipu` | Feishu host `zhipu-ai.jobs.feishu.cn` | social-only | unchanged | zhipu.ts `supportedScopes:["social","all"]` |
| 10 | `baichuan` | Feishu host `cq6qe6bvfr6.jobs.feishu.cn` | `channel:"job"` | unchanged (社招 only) | baichuan.ts `supportedScopes:["social","all"]` |
| 11 | `geely` | Moka portal | social-only | unchanged | geely.ts via moka |
| 12 | `weibo` | Moka via sina proxy | `channel:"campus"` siteId 43534 | `channel:"social"` siteId `43535` | weibo.ts |
| 13 | `mihoyo` | POST `/v1/job/list` | `channelDetailIds:[1], hireType:0` | unchanged (already social) | mihoyo.ts |
| 14 | `sensetime` | Wecruit `/wecruit/positionInfo/listPosition/SU60fa…` | social channel | unchanged | sensetime.ts `supportedScopes:["social","all"]` |
| 15 | `horizonrobotics` | Wecruit | `recruitType:1` | `recruitType:2` → `SU64819a4f2f9d2433ba8b043a` | horizonrobotics.ts |
| 16 | `iflytek` | Beisen iTalent | no Category filter | `Category:["4"]` | iflytek.ts |
| 17 | `vivo` | Beisen iTalent | no Category filter | `Category:["4"]` | vivo.ts |
| 18 | `iqiyi` | Feishu `careers.iqiyi.com` | `portal:"job"` (already social) | unchanged | iqiyi.ts |
| 19 | `xiaomi` | Feishu `xiaomi.jobs.f.mioffice.cn` | `channel:"campus"` | OMIT `portal-channel` header → 2533 social posts | xiaomi.ts |
| 20 | `megvii` | Moka tenant `megviihr` | campus siteId:38642 | social siteId:38641 | megvii.ts |
| 21 | `deepseek` | Moka tenant `high-flyer` | social default | unchanged | deepseek.ts |
| 22 | `galaxyuniversal` | Moka tenant `yinhetongyong` | social default | unchanged | galaxyuniversal.ts |
| 23 | `stepfun` | Moka tenant `step` | social default | unchanged | stepfun.ts |
| 24 | `alibaba` | bespoke campus-talent | mixed feed | scope passed through | alibaba.ts `supportedScopes:["campus","intern","all"]` |
| 25 | `agibot` | Feishu | mixed feed | unchanged | agibot.ts |
| 26 | `minimax` | Feishu | mixed feed | unchanged | minimax.ts |
| 27 | `zerooneai` | Feishu | mixed feed | unchanged | zerooneai.ts |
| 28 | `didi` | bespoke | mixed feed | client-side filter by `post_id` prefix (`J-` social, `JR-` campus) | didi.ts |
| 29 | `weride` | Lever board | mixed feed | unchanged | weride.ts `supportedScopes:["social","all"]` |
| 30 | `xpeng` | Greenhouse board | mixed feed | unchanged | xpeng.ts `supportedScopes:["social","all"]` |
| 31 | `hoyoverse` | Greenhouse board | mixed feed | unchanged | hoyoverse.ts `supportedScopes:["social","all"]` |

---

## 5. Tier-2 unknowns (~12 companies) — discovery plan

| # | Adapter | Hypothesis | First probe | Fallback | Priority |
|---|---|---|---|---|---|
| 1 | `bytedance` | jobs.bytedance.com/experienced; POST returns 405 on standard channel | `curl -X POST -H "portal-channel: experienced" -H "website-path: experienced" "https://jobs.bytedance.com/api/v1/search/job/posts" -d '{"limit":1,"offset":0,"portal_type":3,"portal_entrance":1,"language":"zh"}'` | If 405: try header `portal-channel: society`, then `recruitment_id_list:["301"]`. If still 405: route through CDP. | P0 |
| 2 | `kuaishou` | Path analogue to antgroup — `/api/social/position/search` on `careers.kuaishou.com` | Probe `/recruit/social/e/api/v1/`; inspect JS bundle | Mirror antgroup recipe | P0 |
| 3 | `baidu` | `recruitType:"SOCIAL"` on existing `/talentapi/job/search` | `curl ... -d '{"recruitType":"SOCIAL","pageSize":1,"pageIndex":1}'` | Find social subdomain (talent.baidu.com/jobs/list/SOCIAL); Liepin proxy | P0 |
| 4 | `bilibili` | `/api/srs/*` is login-gated; check public social path | Probe `/api/srs/job/list?recruitType=2`; `/api/post/social/list` | If session-only: declare `supportedScopes` excluding `"social"` | P1 |
| 5 | `pdd` | careers.pddglobalhr.com / careers.pinduoduo-inc.com unrecognized | `curl https://careers.pinduoduo-inc.com/`; inspect SPA AJAX targets; `/api/recruit/social/list` | Try existing `/api/recruit/position/list` with `recruitType:"social"` | P1 |
| 6 | `oppo` | recruitmentType currently only Campus/Intern; check if `"Social"` works | `curl -d '{"recruitmentType":"Social", ...}'` to existing `/openapi/position/queryList` | Probe careers.oppo.com for separate social path | P1 |
| 7 | `sf` | Separate social site beyond `campus.sf-express.com` | `curl https://career.sf-express.com/`; try `seasonType:"4"`, `"5"` | If still empty, mark `supportedScopes:["campus","intern","all"]` | P1 |
| 8 | `cambricon` | Moka `siteId:1113` confirmed exists, not wired | Add `siteId:1113` to `channels[]` in cambricon.ts | If 1113 returns 0 jobs, leave channel disabled | P0 |
| 9 | `huawei` | `career.huawei.com` jobTypes only carries campus values | Try POST with `jobType:"SOCIAL"`, `"EXPERIENCED"` | Huawei recruits social externally. Mark `supportedScopes:["campus","intern","all"]` | P2 |
| 10 | `pingan` | `recruitType:"3"` (campus) | Try `recruitType:"2"` (推断), `"1"`, `"4"` | Probe campus.pingan.com for /social path | P1 |
| 11 | `lilith` | Feishu via CDP; social channel TBD | Run lilith adapter under puppeteer with header variations | If single-portal mixed, mark `supportedScopes:["social","campus","intern","all"]` mapped to one endpoint | P2 |
| 12 | `nio` | Feishu social portal-channel value TBD | `curl -H "portal-channel: society" https://nio.jobs.feishu.cn/api/v1/search/job/posts -d '{...}'` | If campus-only, mark `supportedScopes:["campus","intern","all"]` | P1 |

---

## 6. Tier-3 — structurally blocked (7 companies)

| Adapter | `supportedScopes` declaration | `--scope social` message |
|---|---|---|
| `tencent` | `["campus","intern","all"]` | `tencent social-hire is served by careers.tencent.com (SPA, obfuscated bundle). Use --scope campus, or open the apply_url in a browser.` |
| `jd` | `["campus","intern","all"]` | `jd has no public social-hire API. Try campus.jd.com or jobs.jd.com via browser.` |
| `cainiao` | `["campus","intern","all"]` | `cainiao social-hire requires browser-driven recon. The Liepin third-party fallback covers some listings.` |
| `webank` | `["campus","intern","all"]` | `WeBank social hires are WeChat-only. The CLI surfaces apply_url; open in WeChat.` |
| `hikvision` | `["campus","intern","all"]` | `hikvision careers site is CN-IP gated. The Liepin entry surfaces the chat URL.` |
| `cicc` | `["campus","intern","all"]` | (same as hikvision) |
| `unitree` | `["campus","intern","all"]` | `Unitree applications go through a WeChat QR — apply_url surfaces the contact path.` |

---

## 7. Smoke / selftest changes

### 7.1 `cli/test/smoke.ts`

- `KNOWN_LIMITED` stays empty.
- Add a second pass: each adapter runs `searchPositions({ pageSize: 1, scope: "social" })` IF its `supportedScopes.includes("social")`. Pass criteria:
  - `ok:true`
  - `total >= 0`
  - When `total > 0`: `positions[0]` has `post_id`, `title`, `apply_url`. `recruit_label` mismatch is WARN not FAIL.

### 7.2 Tier-3 expectations

Don't request `scope=social` against Tier-3 adapters (skip with `tag: PASS, reason: "no social channel"`).

### 7.3 `selftest`

Keep existing `xpeng` smoke. Add a check that `supportedScopes` is exported and includes `"social"`.

---

## 8. Shared-file conflict map (worktree contract)

### 8.1 `cli/src/adapter.ts` — owned by **worktree A_infra** only

### 8.2 `cli/src/index.ts` — owned by **worktree A_infra** for dispatcher

- HELP constant: append `--scope` to verbs list and one example.
- `runCompany`: add scope-extraction and supportedScopes check at the top.
- `find` block: add scope-pass-through and `companies_skipped_by_scope` filtering.

### 8.3 `cli/src/{adapter}.ts` files

Each worktree gets disjoint adapter sets (§9). One adapter per worktree per file.

### 8.4 `cli/src/{feishu,moka,wecruit}.ts` — owned by worktrees B / C / D

Only the factory file. Thin adapters that consume the factory are touched by the Tier-1 worktrees, NOT by B/C/D.

### 8.5 `cli/test/smoke.ts` — owned by **worktree A_infra**

### 8.6 `src/app/page.tsx` — owned by **worktree A_infra**

### 8.7 `docs/auto-apply.md` — owned by **worktree A_infra**

### 8.8 `README.md` — owned by **worktree A_infra**

### 8.9 `CHANGELOG.md` — owned by **worktree A_infra**

Anchored sub-sections for each worktree:

```md
## 1.1.0 — Social-hire rollout

<!-- WORKTREE-A:CLI -->
… (worktree A's main writeup) …
<!-- /WORKTREE-A:CLI -->

### Adapters
<!-- WORKTREE-B:FEISHU -->
- ...
<!-- /WORKTREE-B:FEISHU -->
<!-- WORKTREE-C:MOKA -->
...
<!-- /WORKTREE-C:MOKA -->
```

Worktrees append between their own anchor pair only.

---

## 9. Worktree split (14 agents — more aggressive than original 11)

Worktree A_infra is the **dependency root**: it lays down the type contract, the dispatcher, the test scaffolding, the docs scaffolding. All other worktrees rebase ON top of A_infra's branch.

| Worktree | Owner / scope | Files touched | Depends on |
|---|---|---|---|
| **A_infra** | CLI flag + `adapter.ts` contract + `PositionScope` type + dispatcher scope-check + smoke pass + landing page + README + auto-apply docs + CHANGELOG anchors | `cli/src/index.ts`, `cli/src/adapter.ts`, `cli/test/smoke.ts`, `src/app/page.tsx`, `README.md`, `docs/auto-apply.md`, `CHANGELOG.md` | nothing |
| **A_tier1_bespoke** | 10 bespoke Tier-1 adapters | meituan, xiaohongshu, antgroup, liauto, byd, trip, netease, mihoyo, alibaba, didi | A_infra (type only) |
| **A_tier1_feishu_consumers** | Feishu-tenant Tier-1 adapters | zhipu, baichuan, agibot, minimax, zerooneai, xiaomi, iqiyi | A_infra + B (Feishu factory) |
| **A_tier1_moka_consumers** | Moka-tenant Tier-1 adapters | moonshot, megvii, deepseek, galaxyuniversal, stepfun, geely, weibo | A_infra + C (Moka factory) |
| **B** | Feishu factory `--scope` plumbing | `cli/src/feishu.ts` only | A_infra |
| **C** | Moka factory `--scope` plumbing + multi-channel parallel-merge | `cli/src/moka.ts` only | A_infra |
| **D** | Wecruit factory `--scope` + thin adapters (sensetime, horizonrobotics) | `cli/src/wecruit.ts`, `cli/src/sensetime.ts`, `cli/src/horizonrobotics.ts` | A_infra |
| **E** | Beisen iTalent (vivo + iflytek) — `categoryFromScope` mapping | `cli/src/vivo.ts`, `cli/src/iflytek.ts` | A_infra |
| **F** | Greenhouse + Lever (xpeng / weride / hoyoverse) — `supportedScopes` only | `cli/src/greenhouse.ts`, `cli/src/lever.ts`, `cli/src/xpeng.ts`, `cli/src/weride.ts`, `cli/src/hoyoverse.ts` | A_infra |
| **G** | `bytedance` social recon + adapter wiring | `cli/src/bytedance.ts` | A_infra |
| **H** | `kuaishou` + `baidu` social recon + wiring | `cli/src/kuaishou.ts`, `cli/src/baidu.ts` | A_infra |
| **I** | `bilibili` + `pdd` social recon | `cli/src/bilibili.ts`, `cli/src/pdd.ts` | A_infra |
| **J** | `oppo` + `sf` social recon | `cli/src/oppo.ts`, `cli/src/sf.ts` | A_infra |
| **K** | `huawei` + `pingan` + `cambricon` + `lilith` + `nio` social wiring | `cli/src/huawei.ts`, `cli/src/pingan.ts`, `cli/src/cambricon.ts`, `cli/src/lilith.ts`, `cli/src/nio.ts` | A_infra |

**Sequencing.** A_infra merges first. The other 13 worktrees branch off A_infra's merge commit and run in parallel. Final merge train: B,C,D,E,F (factories) → A_tier1_* (Tier-1 wiring that consumes factories) → G,H,I,J,K (Tier-2).

To maximize parallelism in this rollout, all 14 worktree agents are spawned simultaneously. The Tier-1 consumer worktrees include the factory changes inline as patches, in case factory worktrees haven't merged yet — the merge agent reconciles.

---

## 10. CHANGELOG draft (1.1.0)

```md
## 1.1.0 — `--scope social|campus|intern|all`

Adds a unified `--scope` flag to the dispatcher; every adapter now declares
which recruit channels it can query via `supportedScopes`. The flag works on
`search`, `all`, `match`, and the cross-company `find` verb. Default
behaviour (no flag) is preserved bit-for-bit — every adapter keeps its
1.0.93 query shape.

Coverage as of 1.1.0:
* social-hire: NN/50 adapters support `--scope social` (Tier-1
  + verified Tier-2).
* campus / intern: unchanged (50/50, same as 1.0.93).
```

Version bump: **MINOR (1.0.93 → 1.1.0)**.
