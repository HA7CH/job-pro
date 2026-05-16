#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as tencent from "./tencent.js";
import * as bytedance from "./bytedance.js";
import * as alibaba from "./alibaba.js";
import * as meituan from "./meituan.js";
import * as xiaohongshu from "./xiaohongshu.js";
import * as jd from "./jd.js";
import * as kuaishou from "./kuaishou.js";
import * as xiaomi from "./xiaomi.js";
import * as baidu from "./baidu.js";
import * as netease from "./netease.js";
import * as didi from "./didi.js";
import * as bilibili from "./bilibili.js";
import * as pdd from "./pdd.js";
import * as nio from "./nio.js";
import * as minimax from "./minimax.js";
import * as huawei from "./huawei.js";
import * as weibo from "./weibo.js";
import * as mihoyo from "./mihoyo.js";
import * as pingan from "./pingan.js";
import * as sensetime from "./sensetime.js";
import * as trip from "./trip.js";
import * as unitree from "./unitree.js";
import * as byd from "./byd.js";
import * as antgroup from "./antgroup.js";
import * as liauto from "./liauto.js";
import * as moonshot from "./moonshot.js";
import * as zhipu from "./zhipu.js";
import * as hikvision from "./hikvision.js";
import * as iqiyi from "./iqiyi.js";
import * as megvii from "./megvii.js";
import * as lilith from "./lilith.js";
import * as agibot from "./agibot.js";
import * as deepseek from "./deepseek.js";
import * as zerooneai from "./zerooneai.js";
import * as galaxyuniversal from "./galaxyuniversal.js";
import * as stepfun from "./stepfun.js";
import * as cicc from "./cicc.js";
import * as baichuan from "./baichuan.js";
import * as xpeng from "./xpeng.js";
import * as weride from "./weride.js";
import * as hoyoverse from "./hoyoverse.js";
import * as iflytek from "./iflytek.js";
import * as oppo from "./oppo.js";
import * as vivo from "./vivo.js";
import * as sf from "./sf.js";
import * as cainiao from "./cainiao.js";
import * as geely from "./geely.js";
import * as webank from "./webank.js";
import * as horizonrobotics from "./horizonrobotics.js";
import * as cambricon from "./cambricon.js";
import type { CompanyAdapter } from "./adapter.js";
import {
  loadProfile,
  loadProfileRaw,
  loadSession,
  profileTemplate,
  saveProfile,
  stageApplication,
  submitApplication,
  executeFeishu3Step,
  executeMokaApply,
  executeBeisenWecruit,
  executeBeisenITalent,
  executeCdpRealBrowser,
  buildFormTemplate,
  applyFormFile,
  promptUnansweredFields,
  formatStaged,
  type ApplyFormSchema,
  type ResumeProfile,
} from "./apply.js";
import { createInterface } from "node:readline";
import {
  memoryList,
  memoryGet,
  memorySet,
  memoryEvent,
  memoryClear,
} from "./memory.js";
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { createRequire as require_createRequire } from "node:module";
function require_module(): { createRequire: typeof require_createRequire } {
  return { createRequire: require_createRequire };
}

const VERSION = "1.0.7";

// COMPANY_DIRECTORY drives both `job-pro list` output and the company table
// that used to be inlined in HELP. Each entry is `{ key, family, source, label }`;
// `key` matches an ADAPTERS map slot. Update this when wiring a new adapter.
type CompanyFamily =
  | "Bespoke"
  | "Feishu"
  | "Beisen Wecruit"
  | "Beisen iTalent"
  | "Moka"
  | "Greenhouse / Lever (intl arm)"
  | "Liepin (third-party)";

interface CompanyDirEntry {
  key: string;
  family: CompanyFamily;
  source: string;
  label: string;
}

const COMPANIES: CompanyDirEntry[] = [
  { key: "tencent",         family: "Bespoke",                       source: "join.qq.com",                 label: "Tencent / 腾讯" },
  { key: "bytedance",       family: "Bespoke",                       source: "jobs.bytedance.com",          label: "ByteDance / 字节跳动" },
  { key: "alibaba",         family: "Bespoke",                       source: "campus-talent.alibaba.com",   label: "Alibaba / 阿里巴巴" },
  { key: "meituan",         family: "Bespoke",                       source: "zhaopin.meituan.com",         label: "Meituan / 美团" },
  { key: "xiaohongshu",     family: "Bespoke",                       source: "job.xiaohongshu.com",         label: "Xiaohongshu / 小红书" },
  { key: "jd",              family: "Bespoke",                       source: "campus.jd.com",               label: "JD / 京东" },
  { key: "kuaishou",        family: "Bespoke",                       source: "campus.kuaishou.cn",          label: "Kuaishou / 快手" },
  { key: "baidu",           family: "Bespoke",                       source: "talent.baidu.com",            label: "Baidu / 百度" },
  { key: "netease",         family: "Bespoke",                       source: "hr.163.com",                  label: "NetEase / 网易" },
  { key: "didi",            family: "Bespoke",                       source: "talent.didiglobal.com",       label: "Didi / 滴滴" },
  { key: "bilibili",        family: "Bespoke",                       source: "jobs.bilibili.com",           label: "Bilibili / 哔哩哔哩" },
  { key: "pdd",             family: "Bespoke",                       source: "careers.pinduoduo.com",       label: "PDD / 拼多多" },
  { key: "huawei",          family: "Bespoke",                       source: "career.huawei.com",           label: "Huawei / 华为" },
  { key: "weibo",           family: "Bespoke",                       source: "career.sina.com.cn",          label: "Weibo / 微博" },
  { key: "mihoyo",          family: "Bespoke",                       source: "ats.openout.mihoyo.com",      label: "miHoYo / 米哈游" },
  { key: "pingan",          family: "Bespoke",                       source: "campus.pingan.com",           label: "Ping An / 平安" },
  { key: "trip",            family: "Bespoke",                       source: "careers.ctrip.com",           label: "Trip.com / 携程" },
  { key: "unitree",         family: "Bespoke",                       source: "www.unitree.com",             label: "Unitree / 宇树科技" },
  { key: "byd",             family: "Bespoke",                       source: "job.byd.com",                 label: "BYD / 比亚迪" },
  { key: "antgroup",        family: "Bespoke",                       source: "hrcareersweb.antgroup.com",   label: "Ant Group / 蚂蚁集团" },
  { key: "liauto",          family: "Bespoke",                       source: "www.lixiang.com",             label: "Li Auto / 理想汽车" },
  { key: "sf",              family: "Bespoke",                       source: "campus.sf-express.com",       label: "SF Express / 顺丰" },
  { key: "oppo",            family: "Bespoke",                       source: "careers.oppo.com",            label: "OPPO" },
  { key: "xiaomi",          family: "Feishu",                        source: "xiaomi.jobs.f.mioffice.cn",   label: "Xiaomi / 小米" },
  { key: "nio",             family: "Feishu",                        source: "nio.jobs.feishu.cn",          label: "NIO / 蔚来" },
  { key: "minimax",         family: "Feishu",                        source: "vrfi1sk8a0.jobs.feishu.cn",   label: "MiniMax" },
  { key: "moonshot",        family: "Moka",                          source: "app.mokahr.com/moonshot",     label: "Moonshot / 月之暗面" },
  { key: "zhipu",           family: "Feishu",                        source: "zhipu-ai.jobs.feishu.cn",     label: "Zhipu / 智谱AI" },
  { key: "iqiyi",           family: "Feishu",                        source: "careers.iqiyi.com",           label: "iQIYI / 爱奇艺" },
  { key: "agibot",          family: "Feishu",                        source: "agirobot.jobs.feishu.cn",     label: "Agibot / 智元机器人" },
  { key: "lilith",          family: "Feishu",                        source: "lilithgames.jobs.feishu.cn",  label: "Lilith Games / 莉莉丝 — needs local Chrome" },
  { key: "zerooneai",       family: "Feishu",                        source: "01ai.jobs.feishu.cn",         label: "01.AI / 零一万物" },
  { key: "baichuan",        family: "Feishu",                        source: "cq6qe6bvfr6.jobs.feishu.cn",  label: "Baichuan / 百川智能" },
  { key: "sensetime",       family: "Beisen Wecruit",                source: "hr.sensetime.com",            label: "SenseTime / 商汤" },
  { key: "horizonrobotics", family: "Beisen Wecruit",                source: "wecruit.hotjob.cn",           label: "Horizon Robotics / 地平线" },
  { key: "vivo",            family: "Beisen iTalent",                source: "vivo.zhiye.com",              label: "vivo" },
  { key: "iflytek",         family: "Beisen iTalent",                source: "iflytek.zhiye.com",           label: "iFlytek / 科大讯飞" },
  { key: "megvii",          family: "Moka",                          source: "app.mokahr.com/megviihr",     label: "Megvii / 旷视" },
  { key: "deepseek",        family: "Moka",                          source: "app.mokahr.com/high-flyer",   label: "DeepSeek / 深度求索" },
  { key: "galaxyuniversal", family: "Moka",                          source: "app.mokahr.com/yinhetongyong", label: "Galaxy Universal / 银河通用" },
  { key: "stepfun",         family: "Moka",                          source: "app.mokahr.com/step",         label: "StepFun / 阶跃星辰" },
  { key: "cambricon",       family: "Moka",                          source: "app.mokahr.com/cambricon",    label: "Cambricon / 寒武纪" },
  { key: "geely",           family: "Moka",                          source: "app.mokahr.com/geely",        label: "Geely / 吉利" },
  { key: "xpeng",           family: "Greenhouse / Lever (intl arm)", source: "boards.greenhouse.io/xpengmotors", label: "XPeng / 小鹏汽车 — US AI" },
  { key: "weride",          family: "Greenhouse / Lever (intl arm)", source: "jobs.lever.co/weride",        label: "WeRide / 文远知行 — US / 广州" },
  { key: "hoyoverse",       family: "Greenhouse / Lever (intl arm)", source: "boards.greenhouse.io/hoyoverse", label: "HoYoverse / 米哈游国际" },
  { key: "hikvision",       family: "Liepin (third-party)",          source: "api-c.liepin.com",            label: "Hikvision / 海康威视" },
  { key: "cicc",            family: "Liepin (third-party)",          source: "api-c.liepin.com",            label: "CICC / 中金" },
  { key: "cainiao",         family: "Liepin (third-party)",          source: "api-c.liepin.com",            label: "Cainiao / 菜鸟" },
  { key: "webank",          family: "Liepin (third-party)",          source: "api-c.liepin.com",            label: "WeBank / 微众银行" },
];

// Family → default submit_kind. Mirrors what fetchApplicationSchema returns
// for each adapter today; kept here as the static source of truth used by
// `list` output and `find`'s apply-status derivation.
const SUBMIT_KIND_BY_FAMILY: Record<CompanyFamily, string> = {
  "Bespoke":                       "multipart-session",
  "Feishu":                        "feishu-3-step",
  "Moka":                          "moka-aes",
  "Beisen Wecruit":                "beisen-wecruit",
  "Beisen iTalent":                "beisen-italent",
  "Greenhouse / Lever (intl arm)": "multipart-anon",
  "Liepin (third-party)":          "external",
};
// Adapter-level deviations from their family default.
const SUBMIT_KIND_OVERRIDES: Record<string, string> = {
  unitree:    "external",          // Bespoke family, but WeChat-QR — no API submit.
  lilith:     "cdp-real-browser",  // Feishu tenant, but needs ByteDance _signature bypass.
  bytedance:  "feishu-3-step",     // Bespoke family but jobs.bytedance.com is atsx-throne.
  weibo:      "moka-aes",          // Sina careers proxies to Moka (app.mokahr.com/sina).
};
function submitKindFor(adapterKey: string, family: CompanyFamily): string {
  return SUBMIT_KIND_OVERRIDES[adapterKey] ?? SUBMIT_KIND_BY_FAMILY[family];
}

// Mirrors `endpoint_verified: true` in each adapter's schema. Kept here as
// the canonical set so `list` can surface it without firing 50 schema
// fetches. Update whenever an adapter is promoted (see CHANGELOG 1.0.34+).
const ENDPOINT_VERIFIED: ReadonlySet<string> = new Set([
  // multipart-anon (end-to-end smoked via httpbin)
  "xpeng", "weride", "hoyoverse",
  // multipart-session (anon-probe-verified)
  "alibaba", "pdd", "meituan", "mihoyo", "liauto",
  // moka-aes (anon-probe-verified — AES envelope)
  "moonshot", "megvii", "deepseek", "galaxyuniversal", "stepfun", "cambricon", "geely",
  // beisen-italent (anon-probe-verified — IIS 500 template)
  "iflytek", "vivo",
  // multipart-session probe-verified via re-routing (1.0.50)
  "sf",
  // multipart-session probe-verified via 405 (route exists, method/body wrong)
  "netease", "didi", "pingan",
  // probe-verified via re-routed sub-tree + JWT gateway response (1.0.52)
  "byd",
  // probe-verified via re-routed sub-tree (1.0.53)
  "bilibili",
  // probe-verified via host-root path (1.0.54)
  "xiaohongshu",
  // probe-verified via host-root + auth-middleware (1.0.55)
  "baidu",
  // probe-verified via JS-bundle string extraction (1.0.57)
  "tencent",
  // verified via JS-bundle path extraction + cross-domain check (1.0.58)
  "jd",
  // probe-verified via Spring 500 + JS-bundle sub-tree discovery (1.0.59)
  "oppo",
  // probe-verified via JS-bundle extraction (1.0.60)
  "trip",
  // Feishu family: /api/v1/user/applications discovered via SPA chunk 4026
  // (1.0.62). Promotes all 8 Feishu adapters since they share backend.
  "xiaomi", "nio", "minimax", "zhipu", "iqiyi", "agibot", "zerooneai", "baichuan",
  // bytedance: atsx-throne tenant, same /api/v1/user/applications (1.0.63)
  "bytedance",
  // Beisen Wecruit family: anon probe with X-Requested-With (1.0.63)
  "sensetime", "horizonrobotics",
  // kuaishou: /recruit/campus/e/api/v1/ sub-tree discovered (1.0.64)
  "kuaishou",
  // weibo: proxies to Moka (verified earlier) (1.0.65)
  "weibo",
  // huawei: /reccampportal/services/portal/portaluser/ Jalor framework (1.0.66)
  "huawei",
  // lilith: atsx-throne tenant, /api/v1/user/applications 405 (1.0.67)
  "lilith",
  // antgroup: talent.antgroup.com second umi bundle revealed (1.0.68)
  "antgroup",
]);

const HELP = `
job-pro — query Chinese big-tech campus recruiting from your terminal
            (job.ha7ch.com)

USAGE
  job-pro <company> <verb> [options]
  job-pro list [--compact]            list all 50 companies + source family
  job-pro status [--compact]          survey profile / sessions / memory / chrome
  job-pro selftest [--compact]        end-to-end check: search → schema → echo-submit
  job-pro recon [--companies a,b,c]   probe every adapter's submit_endpoint
                                      (classifies as verified-real / 404 /
                                      html-fallthrough / external)
                                      [--summary] for tally only
                                      [--compact] for JSON
  job-pro profile init [--interactive] [--force]
                                      write ~/.jobpro/profile.json
                                      --interactive fills it via prompts.
  job-pro profile show                print the loaded profile
  job-pro profile lint                validate format of every field
                                      (exits 1 on any FAIL — scriptable)
  job-pro find <keyword>              search ALL 50 companies in parallel
                                      [--limit N] [--companies a,b,c]
                                      [--timeout ms] [--apply-ready]
                                      [--compact | --text]
  job-pro extension                   print extension/ path + install steps
  job-pro extension path              just the absolute path (scriptable)
  job-pro --version
  job-pro help

50 companies, all live. Run \`job-pro list\` for the full table grouped
by ATS family (Bespoke / Feishu / Beisen Wecruit / Beisen iTalent / Moka
/ Greenhouse-Lever / Liepin). Coverage summary at job.ha7ch.com.

PHASE 2 (auto-apply) — schema coverage is now 50/50:
  ✅ 3   Greenhouse / Lever  (xpeng / hoyoverse / weride — auto-submit
                              ready, no session needed)
  🟡 22  bespoke session     (tencent, bytedance, alibaba, …)
  🟡 9   Feishu               (xiaomi, nio, minimax, moonshot, zhipu,
                              iqiyi, agibot, lilith, zerooneai, baichuan)
  🟡 7   Moka                 (megvii, deepseek, galaxyuniversal,
                              stepfun, cambricon, geely, moonshot)
  🟡 2   Beisen Wecruit       (sensetime, horizonrobotics)
  🟡 2   Beisen iTalent       (vivo, iflytek)
  ⛔ 5   external             (unitree WeChat, hikvision/cicc/cainiao/
                              webank — Liepin IM-mediated)
\`apply <postId>\` dry-runs the staged POST for any of them. The 🟡
families need a session.json (extension/) + a family-specific
multi-step submitter; --really-submit currently fires only for ✅.
See docs/auto-apply.md.

VERBS (same surface for every company)
  search <kw>                       search openings (free text)
  detail <post_id>                  show full JD for one job
  all [<kw>]                        paginate every job (filter by kw if given)
  dicts                             dump filter dictionaries (where supported)
  notices                           list official announcements (where supported)
  notice <id>                       show one announcement's content (tencent only)
  flow <question>                   answer using best-matching notices (tencent only)
  match <resume-text-or-->          rank jobs by overlap with resume text
                                    pass "-" to read resume from stdin
  resume-check <resume-text-or-->   structural sanity check on a resume
  apply <post_id>                   stage an application (Phase 2 dry-run)
                                    --schema                   dump raw schema (no profile needed)
                                    --print-form               emit a fillable JSON template
                                    --form-file <path>         merge per-job answers
                                    --interactive              prompt for unanswered fields
                                    --remember                 + persist answers to profile.custom
                                    --batch <file|->           apply to many post_ids (one/line)
                                    --debug-submit-to <url>    verify wire format
                                    --debug-submit             ↑ shorthand → httpbin.org/post
                                    --really-submit            actually fire (env-gated)
                                    --allow-stale-session      bypass 30-day session-age gate
  memory list | get <k> | set k=v | event <kind> [payload] | clear

OUTPUT
  Add --compact for one-line JSON (good for piping to jq / claude).

EXAMPLES
  job-pro tencent search "后台开发" --page-size 5
  job-pro bytedance search "前端" --page-size 5
  job-pro alibaba search "AI" --page-size 5
  job-pro tencent detail 1200791473415778304
  job-pro bytedance detail 7638940721068099893
  job-pro alibaba detail 199903220038
  job-pro tencent notices
  job-pro tencent flow "腾讯2026实习什么时候开始投递" --question-time 2026-05-13
  cat my-resume.md | job-pro tencent match -
  job-pro tencent memory set "stack=Go,Python" "target_city=深圳"
  job-pro bytedance memory event applied "ByteDance 前端 7638940721068099893"

DOCS
  https://job.ha7ch.com
  https://github.com/HA7CH/job-pro
`.trim();

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function popCompactFlag(args: string[]): { args: string[]; compact: boolean } {
  const compact = args.includes("--compact");
  return { args: args.filter((a) => a !== "--compact"), compact };
}

function popFlagValue(args: string[], name: string): { args: string[]; value?: string } {
  const out = [...args];
  const i = out.indexOf(name);
  if (i === -1) return { args: out, value: undefined };
  const value = out[i + 1];
  out.splice(i, 2);
  return { args: out, value };
}

// Generic flag harvester: walk the remaining args, pull every `--<flag> <value>`
// pair into an options bag (kebab-case → camelCase), parse CSVs to arrays and
// integer-looking values to numbers, and return the positional args left over.
// This is what lets adapter-specific filters like `--bg-ids 956,29294`,
// `--cities 北京,上海`, `--recruitment-id-list 201,202`, `--batch-id 100000560002`,
// `--recruit-type social` flow straight into the adapter's SearchOptions.
function kebabToCamel(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
function parseScalar(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}
function parseValue(v: string): unknown {
  if (v.includes(",")) return v.split(",").map((p) => parseScalar(p.trim()));
  return parseScalar(v);
}
// Adapter SearchOptions whose names look like plurals / id lists must always
// receive an array, so `--bg-ids 29294` (single value) becomes `[29294]`,
// not `29294`. Multi-value via CSV (`--bg-ids 29294,956`) already arrays.
function maybeArrayWrap(key: string, value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (/(?:Ids|IdList|List|Codes|Categories|Regions|Cities|Departments)$/.test(key)) {
    return [value];
  }
  return value;
}
function popAllOpts(args: string[]): { args: string[]; opts: Record<string, unknown> } {
  const out: string[] = [];
  const opts: Record<string, unknown> = {};
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith("--") && a.length > 2) {
      const key = kebabToCamel(a.slice(2));
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = maybeArrayWrap(key, parseValue(next));
        i += 2;
      } else {
        opts[key] = true;
        i += 1;
      }
    } else {
      out.push(a);
      i += 1;
    }
  }
  return { args: out, opts };
}

function emit(value: unknown, compact: boolean) {
  if (compact) {
    console.log(JSON.stringify(value));
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

function readResumeArg(arg: string | undefined): string {
  if (!arg) die("expected resume text or '-' for stdin");
  if (arg === "-") {
    try {
      return readFileSync(0, "utf8");
    } catch {
      die("could not read resume text from stdin");
    }
  }
  // if it looks like a file path that exists, read it; otherwise treat as
  // the resume text itself
  try {
    return readFileSync(arg, "utf8");
  } catch {
    return arg;
  }
}

// Every company adapter exposes the same set of functions, so one dispatcher
// can route verbs against any of them. New companies plug in by adding an
// `import * as <name>` and a line in `ADAPTERS`. The `satisfies` clause
// makes any contract drift (missing verb, wrong signature) a compile error
// instead of a silent runtime hazard.
const ADAPTERS = {
  tencent,
  bytedance,
  alibaba,
  meituan,
  xiaohongshu,
  jd,
  kuaishou,
  xiaomi,
  baidu,
  netease,
  didi,
  bilibili,
  pdd,
  nio,
  minimax,
  huawei,
  weibo,
  mihoyo,
  pingan,
  sensetime,
  trip,
  unitree,
  byd,
  antgroup,
  liauto,
  moonshot,
  zhipu,
  hikvision,
  iqiyi,
  megvii,
  lilith,
  agibot,
  deepseek,
  zerooneai,
  galaxyuniversal,
  stepfun,
  cicc,
  baichuan,
  xpeng,
  weride,
  hoyoverse,
  iflytek,
  oppo,
  vivo,
  sf,
  cainiao,
  geely,
  webank,
  horizonrobotics,
  cambricon,
} satisfies Record<string, CompanyAdapter>;

async function runCompany(
  adapter: CompanyAdapter,
  company: string,
  rawArgs: string[]
): Promise<void> {
  const [verb, ...rest] = rawArgs;
  if (!verb) die(`expected a verb. Try \`job-pro help\`.`);

  const { args, compact } = popCompactFlag(rest);

  if (verb === "search") {
    const { args: positional, opts } = popAllOpts(args);
    const keyword = positional.join(" ").trim();
    return emit(
      await adapter.searchPositions({
        keyword,
        ...opts,
      }),
      compact
    );
  }

  if (verb === "detail") {
    const postId = args[0];
    if (!postId) die(`usage: job-pro ${company} detail <post_id>`);
    return emit(await adapter.fetchPositionDetail(postId), compact);
  }

  if (verb === "all") {
    const { args: positional, opts } = popAllOpts(args);
    const keyword = positional.join(" ").trim();
    return emit(
      await adapter.fetchAllPositions({
        keyword,
        ...opts,
      }),
      compact
    );
  }

  if (verb === "dicts") {
    return emit(await adapter.fetchDictionaries(), compact);
  }

  if (verb === "notices") {
    return emit(await adapter.listNotices(), compact);
  }

  if (verb === "notice") {
    const id = args[0];
    if (!id) die(`usage: job-pro ${company} notice <id>`);
    return emit(await adapter.getNotice(id), compact);
  }

  if (verb === "flow") {
    const { args: a, value: questionTime } = popFlagValue(args, "--question-time");
    const { args: a2, value: topK } = popFlagValue(a, "--top-k");
    const question = a2.join(" ").trim();
    if (!question)
      die(`usage: job-pro ${company} flow <question> [--question-time YYYY-MM-DD] [--top-k N]`);
    return emit(
      await adapter.findNoticesByQuestion(question, {
        questionTime,
        topK: topK ? Number(topK) : undefined,
      }),
      compact
    );
  }

  if (verb === "match") {
    const { args: a, value: topN } = popFlagValue(args, "--top-n");
    const { args: a2, value: candidates } = popFlagValue(a, "--candidates");
    const text = readResumeArg(a2[0]);
    return emit(
      await adapter.matchResume(text, {
        topN: topN ? Number(topN) : undefined,
        candidates: candidates ? Number(candidates) : undefined,
      }),
      compact
    );
  }

  if (verb === "resume-check") {
    const text = readResumeArg(args[0]);
    return emit(adapter.checkResume(text), compact);
  }

  if (verb === "apply") {
    const reallySubmit = args.includes("--really-submit");
    const printForm = args.includes("--print-form");
    const schemaOnly = args.includes("--schema");
    const interactive = args.includes("--interactive");
    const remember = args.includes("--remember");
    let { args: aDebug, value: debugUrl } = popFlagValue(args, "--debug-submit-to");
    // Shorthand: `--debug-submit` without URL → default httpbin echo.
    if (!debugUrl && aDebug.includes("--debug-submit")) {
      aDebug = aDebug.filter((a) => a !== "--debug-submit");
      debugUrl = "https://httpbin.org/post";
    }
    const { args: aForm, value: formFilePath } = popFlagValue(aDebug, "--form-file");
    const { args: aBatch, value: batchPath } = popFlagValue(aForm, "--batch");

    // Batch mode: read post_ids from a file (or stdin if "-"). Each non-empty,
    // non-`#`-prefixed line is a post_id. Output is a JSON array of
    // { post_id, result } so downstream tooling can iterate.
    if (batchPath) {
      if (reallySubmit) {
        die(
          `--batch + --really-submit is intentionally refused. Submitting to ` +
            `multiple jobs at once is the exact failure mode this CLI is designed to ` +
            `prevent. Drop --really-submit and use --debug-submit-to <url> for batch ` +
            `verification, or run apply one job at a time.`
        );
      }
      let rawLines: string;
      try {
        rawLines = batchPath === "-" ? readFileSync(0, "utf8") : readFileSync(batchPath, "utf8");
      } catch (err) {
        die(`could not read batch file ${batchPath}: ${err instanceof Error ? err.message : err}`);
      }
      const postIds = rawLines
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      if (postIds.length === 0) die(`batch file ${batchPath} contains no post_ids`);
      // We need the schema fetcher / profile / session ONCE, not per-job.
      const fetchSchema = adapter.fetchApplicationSchema;
      if (typeof fetchSchema !== "function") {
        return emit(
          { ok: false, source: company, message: `apply: not wired for "${company}"` },
          compact
        );
      }
      const prof = loadProfile();
      if (!prof.ok) die(prof.message);
      let effectiveProfile = prof.profile;
      if (formFilePath) {
        const merged = applyFormFile(effectiveProfile, formFilePath);
        if (!merged.ok) die(merged.message);
        effectiveProfile = merged.profile;
      }
      const session = loadSession(company);

      type BatchRow = { post_id: string; ok: boolean; ready?: boolean; message?: string; submit_kind?: string; debug_result?: unknown };
      const out: BatchRow[] = [];
      // Progress to stderr (so stdout JSON stays clean for pipes). Only when
      // not --compact AND not piping stdout (interactive TTY).
      const showProgress = !compact && process.stderr.isTTY && postIds.length > 1;
      let progressIdx = 0;
      for (const id of postIds) {
        progressIdx++;
        if (showProgress) {
          process.stderr.write(`\r[${progressIdx}/${postIds.length}] ${id.padEnd(28)}\x1b[K`);
        }
        try {
          const schemaResult = (await fetchSchema.call(adapter, id)) as { ok?: boolean; schema?: ApplyFormSchema; message?: string };
          if (!schemaResult.ok || !schemaResult.schema) {
            out.push({ post_id: id, ok: false, message: schemaResult.message ?? "schema fetch failed" });
            continue;
          }
          const staged = stageApplication(schemaResult.schema, effectiveProfile);
          if (debugUrl) {
            const kind = schemaResult.schema.submit_kind ?? "multipart-anon";
            const debugExecutor =
              kind === "feishu-3-step" ? executeFeishu3Step :
              kind === "moka-aes" ? executeMokaApply :
              kind === "beisen-wecruit" ? executeBeisenWecruit :
              kind === "beisen-italent" ? executeBeisenITalent :
              kind === "cdp-real-browser" ? executeCdpRealBrowser :
              null;
            const result = debugExecutor
              ? await debugExecutor(staged, session, { kind: "debug", url: debugUrl })
              : await submitApplication(staged, { kind: "debug", url: debugUrl });
            out.push({ post_id: id, ok: result.ok, ready: staged.ready, submit_kind: kind, debug_result: result });
          } else {
            out.push({
              post_id: id,
              ok: staged.ready,
              ready: staged.ready,
              submit_kind: schemaResult.schema.submit_kind,
              message: staged.ready ? "staged ok" : `${staged.unanswered_required.length} required field(s) unfilled`,
            });
          }
        } catch (err) {
          out.push({ post_id: id, ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      }
      if (showProgress) process.stderr.write(`\r\x1b[K`);
      const okCount = out.filter((r) => r.ok).length;
      return emit({ mode: debugUrl ? "batch-debug" : "batch-dry-run", company, total: out.length, ok_count: okCount, results: out }, compact);
    }
    void aBatch;

    const postId = args[0];
    if (!postId) die(`usage: job-pro ${company} apply <post_id> [--schema | --print-form | --form-file <path> | --interactive [--remember] | --batch <file>] [--debug-submit-to <url> | --really-submit]`);

    const fetchSchema = adapter.fetchApplicationSchema;
    if (typeof fetchSchema !== "function") {
      return emit(
        {
          ok: false,
          source: company,
          post_id: postId,
          message:
            `apply: Phase 2 not yet wired for "${company}". Only Greenhouse + Lever ` +
            `boards (xpeng / hoyoverse / weride) expose an application schema today. ` +
            `See docs/auto-apply.md for the rollout plan.`,
        },
        compact
      );
    }
    // Note: we DON'T early-return on reallySubmit here — we fall through
    // to stage the application first, then re-gate before actually posting.
    // This lets the user verify the staged payload one last time even
    // when they pass --really-submit by accident.
    const schemaResult = await fetchSchema.call(adapter, postId);
    const sr = schemaResult as { ok?: boolean; schema?: ApplyFormSchema; message?: string };
    if (!sr.ok || !sr.schema) {
      return emit({ ok: false, source: company, post_id: postId, message: sr.message ?? "unknown error" }, compact);
    }
    // --schema short-circuits everything (and crucially doesn't need a
    // profile). Useful for recon: "what fields does this job ask?".
    if (schemaOnly) {
      return emit({ ok: true, source: company, post_id: postId, schema: sr.schema }, compact);
    }
    const prof = loadProfile();
    if (!prof.ok) {
      return emit(
        {
          ok: false,
          source: company,
          post_id: postId,
          schema: sr.schema,
          message: prof.message,
          hint: `run \`job-pro profile init\` to create a template.`,
        },
        compact
      );
    }

    // --print-form short-circuits everything else: emit a fillable
    // template specific to this job's schema and exit.
    if (printForm) {
      const template = buildFormTemplate(sr.schema, prof.profile);
      return emit(template, compact);
    }

    // --form-file merges per-job overrides into profile.custom.
    let effectiveProfile: ResumeProfile = prof.profile;
    if (formFilePath) {
      const merged = applyFormFile(effectiveProfile, formFilePath);
      if (!merged.ok) {
        return emit(
          {
            ok: false,
            source: company,
            post_id: postId,
            message: merged.message,
          },
          compact
        );
      }
      effectiveProfile = merged.profile;
      // --remember + --form-file: persist the merged answers back to profile.
      if (remember && !compact) {
        const before = JSON.stringify(prof.profile.custom ?? {});
        const after = JSON.stringify(effectiveProfile.custom ?? {});
        if (before !== after) {
          const saved = saveProfile(effectiveProfile);
          if (saved.ok) {
            console.log(`Saved form-file answers to ${saved.path} (custom.*).`);
          } else {
            console.error(`--remember failed: ${saved.message}`);
          }
        }
      }
    }

    // --interactive: prompt stdin for each unanswered required field.
    // Skipped in --compact mode (we'd be polluting JSON output with prompts).
    if (interactive && !compact) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const io = {
        write: (s: string) => process.stdout.write(s),
        read: () =>
          new Promise<string | null>((resolve) => {
            rl.once("close", () => resolve(null));
            rl.question("", (a) => resolve(a));
          }),
      };
      console.log(`\nInteractive mode — fill the required fields for "${sr.schema.job_title || postId}".`);
      console.log(`Type \`q\` or Ctrl-D to abort. Hit Enter to skip an optional field.`);
      const overrides = await promptUnansweredFields(sr.schema, effectiveProfile, io);
      rl.close();
      // Merge into effectiveProfile.custom for the rest of the flow.
      effectiveProfile = {
        ...effectiveProfile,
        custom: { ...(effectiveProfile.custom ?? {}), ...overrides },
      };
      const collectedCount = Object.keys(overrides).length;
      console.log(`\nCollected ${collectedCount} answer(s). Staging now…\n`);
      if (remember && collectedCount > 0) {
        const saved = saveProfile(effectiveProfile);
        if (saved.ok) {
          console.log(`Saved ${collectedCount} answer(s) to ${saved.path} (custom.*).\n`);
        } else {
          console.error(`--remember failed: ${saved.message}`);
        }
      }
    }

    const staged = stageApplication(sr.schema, effectiveProfile);
    const session = loadSession(company);

    // Mode selection: --debug-submit-to <url> overrides everything.
    if (debugUrl) {
      // Route through the family-specific executor where appropriate so the
      // user can verify each step's wire format against their echo server.
      const kindForDebug = sr.schema.submit_kind ?? "multipart-anon";
      const debugExecutor =
        kindForDebug === "feishu-3-step" ? executeFeishu3Step :
        kindForDebug === "moka-aes" ? executeMokaApply :
        kindForDebug === "beisen-wecruit" ? executeBeisenWecruit :
        kindForDebug === "beisen-italent" ? executeBeisenITalent :
        kindForDebug === "cdp-real-browser" ? executeCdpRealBrowser :
        null;
      if (debugExecutor) {
        const result = await debugExecutor(staged, session, { kind: "debug", url: debugUrl });
        return emit({ mode: "debug-submit", staged, submit_kind: kindForDebug, result }, compact);
      }
      const result = await submitApplication(staged, { kind: "debug", url: debugUrl });
      return emit({ mode: "debug-submit", staged, submit_kind: kindForDebug, result }, compact);
    }

    // Session staleness gate (applies to any --really-submit that uses a
    // captured session). Sessions for non-anon adapters generally expire
    // around the 30-day mark; firing a stale cookie just nets a 401 with
    // no diagnostic. Catch it before the submit fires.
    const allowStaleSession = args.includes("--allow-stale-session");
    const maxAgeDays = Number(process.env.JOB_PRO_SESSION_MAX_AGE_DAYS ?? 30);
    function sessionAgeDays(s: typeof session): number | null {
      if (!s?.exported_at) return null;
      const ts = Date.parse(s.exported_at);
      if (!Number.isFinite(ts)) return null;
      return Math.floor((Date.now() - ts) / 86_400_000);
    }

    // --really-submit: actually hit the upstream endpoint. Guarded by both
    // an env-var attestation and (for non-anon adapters) a session.json.
    if (reallySubmit) {
      const understood = process.env.JOB_PRO_I_UNDERSTAND_REAL_SUBMIT === "yes";
      if (!understood) {
        return emit(
          {
            ok: false,
            source: company,
            post_id: postId,
            mode: "really-submit-blocked",
            staged,
            message:
              `--really-submit is gated by an env-var attestation. To unlock, set ` +
              `JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes in your shell. This submission will ` +
              `POST a real application to ${staged.submit_endpoint}; doing so without a ` +
              `valid resume / answers is spam against the company's recruiters.`,
          },
          compact
        );
      }
      if (!staged.ready) {
        return emit(
          {
            ok: false,
            source: company,
            post_id: postId,
            mode: "really-submit-blocked",
            staged,
            message: `${staged.unanswered_required.length} required field(s) still unanswered; refusing to submit incomplete application`,
          },
          compact
        );
      }
      // Speculative-endpoint gate (4th safety layer). 19 of 22 bespoke
      // multipart-session endpoints returned 404 on no-auth probe — the
      // inferred URLs are wrong guesses. Refusing by default prevents
      // accidental fires against broken endpoints; users who *want* to
      // shake out what the real endpoint should be opt in via env.
      const allowSpeculative = process.env.JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT === "yes";
      if (staged.submit_kind !== "external" && staged.submit_kind !== "multipart-anon" && staged.endpoint_verified !== true && !allowSpeculative) {
        return emit(
          {
            ok: false,
            source: company,
            post_id: postId,
            mode: "really-submit-blocked",
            staged,
            message:
              `submit_endpoint for ${company} is speculative — inferred from JS-bundle recon, ` +
              `not end-to-end verified. Most such endpoints (19 of 22 probed) are wrong and ` +
              `would 4xx. Verify with \`apply ${postId} --debug-submit-to <your-echo-url>\` first, ` +
              `or set \`JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes\` if you're knowingly probing.`,
          },
          compact
        );
      }
      // Submission flow selection by submit_kind. Only the generic
      // multipart families are wired to actually fire today; everything
      // else gets a useful refusal message.
      const kind = (sr.schema.submit_kind ?? "multipart-anon");
      const isAnonMultipart = kind === "multipart-anon";
      const isSessionMultipart = kind === "multipart-session";
      const isGenericMultipart = isAnonMultipart || isSessionMultipart;

      if (kind === "external") {
        return emit(
          {
            ok: false,
            source: company,
            post_id: postId,
            mode: "really-submit-external",
            staged,
            submit_kind: kind,
            apply_url: staged.apply_url,
            message:
              `${company} has no programmatic submit API — recruiting is mediated ` +
              `via WeChat mini-program / Liepin recruiter chat / other IM channel. ` +
              `Open apply_url in your browser to start the actual application flow.`,
          },
          compact
        );
      }
      // Family executors: each takes (staged, session, target) and returns
      // a MultiStepResult. All gate on session.json existing.
      const familyExecutor =
        kind === "feishu-3-step" ? executeFeishu3Step :
        kind === "moka-aes" ? executeMokaApply :
        kind === "beisen-wecruit" ? executeBeisenWecruit :
        kind === "beisen-italent" ? executeBeisenITalent :
        kind === "cdp-real-browser" ? executeCdpRealBrowser :
        null;
      if (familyExecutor) {
        if (!session) {
          return emit(
            {
              ok: false,
              source: company,
              post_id: postId,
              mode: "really-submit-blocked",
              staged,
              submit_kind: kind,
              message:
                `${kind} submission requires a captured session at ` +
                `~/.jobpro/${company}.session.json. Install extension/ in Chrome, ` +
                `log in to the careers site, click Export.`,
            },
            compact
          );
        }
        const age = sessionAgeDays(session);
        if (age !== null && age > maxAgeDays && !allowStaleSession) {
          return emit(
            {
              ok: false,
              source: company,
              post_id: postId,
              mode: "really-submit-blocked",
              staged,
              submit_kind: kind,
              session_age_days: age,
              message:
                `session at ~/.jobpro/${company}.session.json is ${age} days old (limit ${maxAgeDays}); ` +
                `careers-site sessions usually expire around 30d and a stale cookie would yield ` +
                `an inscrutable 401. Re-capture via the extension, or pass --allow-stale-session ` +
                `(also: JOB_PRO_SESSION_MAX_AGE_DAYS env).`,
            },
            compact
          );
        }
        const result = await familyExecutor(staged, session, { kind: "upstream" });
        if (result.ok) {
          memoryEvent("applied", `${company} ${postId} — ${staged.job_title}`);
        }
        return emit({ mode: "really-submit", staged, submit_kind: kind, session_used: true, result }, compact);
      }
      if (!isGenericMultipart) {
        return emit(
          {
            ok: false,
            source: company,
            post_id: postId,
            mode: "really-submit-blocked",
            staged,
            submit_kind: kind,
            submit_notes: sr.schema.submit_notes,
            message:
              `submit_kind="${kind}" — this adapter family doesn't yet have an ` +
              `executor wired. The application schema + submit endpoint are ` +
              `documented (see submit_notes), but firing the submission needs a ` +
              `family-specific multi-step flow (token exchange / AES envelope / ` +
              `CDP / etc.). Landing per-family executors is the next iteration of ` +
              `Phase 2. Use --debug-submit-to <url> to inspect what we have today.`,
          },
          compact
        );
      }
      // Non-anon multipart families need session.json.
      if (!isAnonMultipart && !session) {
        return emit(
          {
            ok: false,
            source: company,
            post_id: postId,
            mode: "really-submit-blocked",
            staged,
            message:
              `no captured session at ~/.jobpro/${company}.session.json. Install the ` +
              `extension/ directory in Chrome, log into the careers site, click Export, ` +
              `then mv ~/Downloads/jobpro/${company}.session.json ~/.jobpro/`,
          },
          compact
        );
      }
      if (!isAnonMultipart) {
        const age = sessionAgeDays(session);
        if (age !== null && age > maxAgeDays && !allowStaleSession) {
          return emit(
            {
              ok: false,
              source: company,
              post_id: postId,
              mode: "really-submit-blocked",
              staged,
              submit_kind: kind,
              session_age_days: age,
              message:
                `session at ~/.jobpro/${company}.session.json is ${age} days old (limit ${maxAgeDays}); ` +
                `re-capture via the extension or pass --allow-stale-session.`,
            },
            compact
          );
        }
      }
      const result = await submitApplication(staged, { kind: "upstream" }, { session });
      if (result.ok) {
        memoryEvent("applied", `${company} ${postId} — ${staged.job_title}`);
      }
      return emit({ mode: "really-submit", staged, submit_kind: kind, session_used: !!session, result }, compact);
    }

    // Default: dry-run print, no network.
    if (compact) {
      return emit({ mode: "dry-run", staged, has_session: !!session }, compact);
    }
    console.log(formatStaged(staged));
    if (session) {
      console.log(`\nSession captured (~/.jobpro/${company}.session.json): ${session.cookies.length} cookies + ${Object.keys(session.headers).length} auth headers.`);
    }
    if (!staged.ready) {
      console.log(
        `\nFill the unanswered required fields. Easiest path:\n` +
          `  1. job-pro ${company} apply ${postId} --print-form > form.json\n` +
          `  2. Edit form.json — set each \`value\` for required fields.\n` +
          `  3. job-pro ${company} apply ${postId} --form-file form.json\n` +
          `Or paste the following into ${profileTemplate().path} under \`custom\`:`
      );
      // Emit a copy-pasteable JSON snippet listing each unanswered required.
      const snippet: Record<string, string> = {};
      for (const f of staged.unanswered_required) snippet[f.name] = "";
      console.log(JSON.stringify({ custom: snippet }, null, 2));
    } else {
      const isAnon =
        staged.source.startsWith("boards-api.greenhouse.io/") ||
        staged.source.startsWith("api.lever.co/");
      console.log(
        `\nDry-run complete. To actually submit:\n` +
          `  • --debug-submit-to https://httpbin.org/post  — verify wire format\n` +
          `  • JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes job-pro ${company} apply ${postId} --really-submit\n` +
          (isAnon
            ? `  ${company} is Greenhouse/Lever (anonymous submission, no session needed).\n`
            : `  ${company} needs ~/.jobpro/${company}.session.json — capture via the browser extension.\n`)
      );
    }
    void aDebug; // silence "unused" — `args` flow goes through popFlagValue
    return;
  }

  if (verb === "memory") {
    const [sub, ...subArgs] = args;
    if (!sub) die(`usage: job-pro ${company} memory <list|get|set|event|clear>`);
    if (sub === "list") return emit(memoryList(), compact);
    if (sub === "get") {
      const key = subArgs[0];
      if (!key) die(`usage: job-pro ${company} memory get <key>`);
      return emit(memoryGet(key), compact);
    }
    if (sub === "set") {
      return emit(memorySet(subArgs), compact);
    }
    if (sub === "event") {
      const [kind, ...payload] = subArgs;
      return emit(memoryEvent(kind, payload.join(" ")), compact);
    }
    if (sub === "clear") return emit(memoryClear(), compact);
    die(`unknown memory subcommand: ${sub}`);
  }

  die(`unknown verb: ${verb}. Try \`job-pro help\`.`);
}

interface StatusReport {
  profile: {
    path: string;
    exists: boolean;
    filled_standard: string[];
    missing_standard: string[];
    custom_keys: number;
  };
  sessions: Array<{ adapter: string; path: string; host?: string; captured_at?: string; age_days?: number; cookies?: number; headers?: number }>;
  memory: {
    path?: string;
    field_keys: string[];
    recent_events: Array<{ ts: string; kind: string; payload: string }>;
    total_events: number;
  };
  chrome: { found: boolean; path?: string; puppeteer_core: boolean };
  /** Smoke status — populated only when --check is passed (skips heavy network calls otherwise). */
  smoke?: { read: string; apply: string };
}

function buildStatusReport(): StatusReport {
  const homeDir = process.env.JOBPRO_HOME ?? join(homedir(), ".jobpro");
  const profilePath = process.env.JOB_PRO_PROFILE_PATH ?? join(homeDir, "profile.json");
  const sessionDir = process.env.JOB_PRO_SESSION_DIR ?? homeDir;

  // Profile state.
  const filled: string[] = [];
  const missing: string[] = [];
  let customKeys = 0;
  let profileExists = false;
  if (existsSync(profilePath)) {
    profileExists = true;
    try {
      const p = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>;
      for (const key of ["first_name", "last_name", "email", "phone", "resume_path"]) {
        const v = p[key];
        if (typeof v === "string" && v.length > 0) filled.push(key);
        else missing.push(key);
      }
      customKeys = p.custom && typeof p.custom === "object" ? Object.keys(p.custom as object).length : 0;
    } catch {
      missing.push("(profile JSON is malformed)");
    }
  } else {
    missing.push("first_name", "last_name", "email", "phone", "resume_path");
  }

  // Captured sessions in ~/.jobpro/*.session.json
  const sessions: StatusReport["sessions"] = [];
  if (existsSync(sessionDir)) {
    try {
      for (const f of readdirSync(sessionDir)) {
        if (!f.endsWith(".session.json")) continue;
        const adapter = f.slice(0, -".session.json".length);
        const full = join(sessionDir, f);
        const stat = statSync(full);
        const age = (Date.now() - stat.mtimeMs) / (24 * 3600 * 1000);
        let host: string | undefined;
        let cookieCount = 0;
        let headerCount = 0;
        let capturedAt: string | undefined;
        try {
          const j = JSON.parse(readFileSync(full, "utf8")) as { host?: string; cookies?: unknown[]; headers?: Record<string, unknown>; exported_at?: string };
          host = j.host;
          cookieCount = Array.isArray(j.cookies) ? j.cookies.length : 0;
          headerCount = j.headers ? Object.keys(j.headers).length : 0;
          capturedAt = j.exported_at;
        } catch {
          /* malformed — still surface the file */
        }
        sessions.push({
          adapter,
          path: full,
          host,
          captured_at: capturedAt,
          age_days: Math.round(age * 10) / 10,
          cookies: cookieCount,
          headers: headerCount,
        });
      }
    } catch {
      /* ignore */
    }
  }

  // Memory snapshot.
  const memSummary: StatusReport["memory"] = {
    field_keys: [],
    recent_events: [],
    total_events: 0,
  };
  try {
    const memList = memoryList() as { ok?: boolean; path?: string; fields?: Record<string, string>; events?: Array<{ ts: string; kind: string; payload: string }> };
    if (memList?.path) memSummary.path = memList.path;
    if (memList?.fields) memSummary.field_keys = Object.keys(memList.fields);
    if (Array.isArray(memList?.events)) {
      memSummary.total_events = memList.events.length;
      memSummary.recent_events = memList.events.slice(-5).reverse();
    }
  } catch {
    /* ignore */
  }

  // Chrome / puppeteer-core availability.
  const CHROME_CANDIDATES = [
    process.env.JOB_PRO_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  // puppeteer-core is a runtime dep, but a user could have done --omit=optional
  // or be running from a fresh checkout. Probe via createRequire because
  // we're an ESM module without a CJS `require`.
  let hasPuppeteer = false;
  try {
    const { createRequire } = require_module();
    const req = createRequire(import.meta.url);
    req.resolve("puppeteer-core");
    hasPuppeteer = true;
  } catch {
    hasPuppeteer = false;
  }

  return {
    profile: {
      path: profilePath,
      exists: profileExists,
      filled_standard: filled,
      missing_standard: missing,
      custom_keys: customKeys,
    },
    sessions,
    memory: memSummary,
    chrome: { found: !!chromePath, path: chromePath, puppeteer_core: hasPuppeteer },
  };
}

function printStatus(compact: boolean): void {
  const r = buildStatusReport();
  if (compact) {
    console.log(JSON.stringify(r));
    return;
  }
  console.log(`job-pro status (${VERSION})`);
  console.log();
  // Profile
  const filledColor = (r.profile.missing_standard.length === 0 && r.profile.exists) ? "✓" : "✗";
  console.log(`Profile  ${filledColor}  ${r.profile.path}`);
  if (!r.profile.exists) {
    console.log(`         not found — run \`job-pro profile init\``);
  } else {
    console.log(`         filled:  ${r.profile.filled_standard.join(", ") || "(none)"}`);
    if (r.profile.missing_standard.length > 0) {
      console.log(`         missing: ${r.profile.missing_standard.join(", ")}`);
    }
    if (r.profile.custom_keys > 0) {
      console.log(`         custom:  ${r.profile.custom_keys} keys`);
    }
  }
  console.log();
  // Sessions
  if (r.sessions.length === 0) {
    console.log(`Sessions ✗  no session.json files captured`);
    console.log(`         install extension/ in Chrome to capture sessions for non-anon adapters.`);
  } else {
    console.log(`Sessions ✓  ${r.sessions.length} captured`);
    for (const s of r.sessions) {
      const stale = (s.age_days ?? 0) > 30 ? " (STALE — sessions usually expire ~30 days)" : "";
      console.log(
        `         ${s.adapter.padEnd(18)} ${s.cookies ?? 0}c+${s.headers ?? 0}h  age=${s.age_days}d${stale}`
      );
    }
  }
  console.log();
  // Memory
  console.log(`Memory   ${r.memory.total_events > 0 ? "✓" : "·"}  ${r.memory.path ?? "(none)"}`);
  console.log(`         fields=${r.memory.field_keys.length}  events=${r.memory.total_events}`);
  for (const e of r.memory.recent_events.slice(0, 5)) {
    console.log(`         ${e.ts}  ${e.kind.padEnd(12)} ${(e.payload ?? "").slice(0, 60)}`);
  }
  console.log();
  // Chrome
  const ch = r.chrome.found && r.chrome.puppeteer_core ? "✓" : "✗";
  console.log(`Chrome   ${ch}  ${r.chrome.path ?? "(not found)"}`);
  console.log(`         puppeteer-core: ${r.chrome.puppeteer_core ? "installed" : "missing"}`);
  if (!r.chrome.found || !r.chrome.puppeteer_core) {
    console.log(`         needed for: lilith adapter, --proxy-server geo-bypass (hikvision).`);
  }
}

async function runProfileInitInteractive(template: ResumeProfile): Promise<ResumeProfile> {
  if (!process.stdin.isTTY) {
    die(
      "profile init --interactive needs a TTY (got a piped stdin). " +
        "Either run from a real terminal, or drop --interactive and edit " +
        "the JSON file directly."
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      let answered = false;
      const onClose = () => {
        if (!answered) reject(new Error("stdin closed before answer"));
      };
      rl.once("close", onClose);
      rl.question(prompt, (a) => {
        answered = true;
        rl.off("close", onClose);
        resolve(a);
      });
    });
  const filled: ResumeProfile = { ...template };
  console.log(`\nProfile setup — fill in 5 fields (Ctrl-C to abort).\n`);
  try {
    filled.first_name = await prompt("First name: ", ask, (v) => v.trim().length > 0 || "(required)");
    filled.last_name = await prompt("Last name: ", ask, (v) => v.trim().length > 0 || "(required)");
    filled.email = await prompt(
      "Email: ",
      ask,
      (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? true : "(must look like name@domain.tld)")
    );
    filled.phone = await prompt(
      "Phone (with country code, e.g. +86 13800138000): ",
      ask,
      (v) => (/^[+]?[\d\s\-()]{7,}$/.test(v.trim()) ? true : "(digits + optional spaces/dashes; min 7)")
    );
    filled.resume_path = await prompt(
      "Resume file path (absolute, PDF/DOCX): ",
      ask,
      (v) => {
        const p = v.trim();
        if (!p) return "(required — pass an absolute path to your résumé)";
        if (!existsSync(p)) return `(file not found: ${p})`;
        return true;
      }
    );
  } finally {
    rl.close();
  }
  return filled;
}

async function prompt(
  q: string,
  ask: (prompt: string) => Promise<string>,
  validate: (v: string) => true | string
): Promise<string> {
  while (true) {
    const v = (await ask(q)).trim();
    const res = validate(v);
    if (res === true) return v;
    console.log(`  ${res}`);
  }
}

function printCompanyList(compact: boolean): void {
  // Validate the directory still matches the ADAPTERS map. If a company
  // appears in only one place, treat it as a bug.
  const adapterKeys = new Set(Object.keys(ADAPTERS));
  const dirKeys = new Set(COMPANIES.map((c) => c.key));
  const missingInDir = [...adapterKeys].filter((k) => !dirKeys.has(k));
  const missingInAdapters = [...dirKeys].filter((k) => !adapterKeys.has(k));
  if (missingInDir.length || missingInAdapters.length) {
    console.error(
      "INTERNAL: COMPANIES directory diverged from ADAPTERS map.\n" +
        (missingInDir.length ? `  missing from directory: ${missingInDir.join(", ")}\n` : "") +
        (missingInAdapters.length ? `  missing from adapters: ${missingInAdapters.join(", ")}\n` : "")
    );
  }

  if (compact) {
    // Machine-readable: emit a JSON array of { key, family, source, label,
    // submit_kind } — submit_kind derived from the family map + overrides.
    console.log(
      JSON.stringify(
        COMPANIES.map((c) => ({
          ...c,
          submit_kind: submitKindFor(c.key, c.family),
          endpoint_verified: ENDPOINT_VERIFIED.has(c.key),
        }))
      )
    );
    return;
  }

  // Human-readable: group by family, fixed-width left column.
  const byFamily = new Map<CompanyFamily, CompanyDirEntry[]>();
  for (const c of COMPANIES) {
    if (!byFamily.has(c.family)) byFamily.set(c.family, []);
    byFamily.get(c.family)!.push(c);
  }
  const order: CompanyFamily[] = [
    "Bespoke",
    "Feishu",
    "Beisen Wecruit",
    "Beisen iTalent",
    "Moka",
    "Greenhouse / Lever (intl arm)",
    "Liepin (third-party)",
  ];
  const keyWidth = Math.max(...COMPANIES.map((c) => c.key.length));
  const srcWidth = Math.max(...COMPANIES.map((c) => c.source.length));
  const kindWidth = Math.max(...COMPANIES.map((c) => submitKindFor(c.key, c.family).length));
  console.log(`job-pro — 50 companies, all live. ATS-family breakdown:`);
  for (const family of order) {
    const entries = byFamily.get(family);
    if (!entries) continue;
    const kindForFamily = SUBMIT_KIND_BY_FAMILY[family];
    console.log(`\n${family} (${entries.length}) — submit_kind=${kindForFamily}`);
    for (const c of entries) {
      const kind = submitKindFor(c.key, c.family);
      const kindCol = kind === kindForFamily ? "".padEnd(kindWidth) : kind.padEnd(kindWidth);
      const verifiedTag = ENDPOINT_VERIFIED.has(c.key) ? " ✓" : "  ";
      console.log(`  ${c.key.padEnd(keyWidth)} ${verifiedTag} ${kindCol}  ${c.source.padEnd(srcWidth)}  ${c.label}`);
    }
  }
  console.log(`\nTotal: ${COMPANIES.length}. Run \`job-pro <key> search "…"\` against any of them.`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "list" || cmd === "companies") {
    const compact = args.includes("--compact");
    printCompanyList(compact);
    return;
  }
  if (cmd === "status") {
    const compact = args.includes("--compact");
    printStatus(compact);
    return;
  }
  if (cmd === "recon") {
    // Probe every adapter's submit_endpoint anonymously and classify the
    // response. Catches upstream URL drift (the path went 404 because
    // upstream renamed it) and is the same probe routine I used by hand
    // to populate endpoint_verified for the 15 verified adapters.
    const compact = args.includes("--compact");
    const summary = args.includes("--summary");
    const { args: aCompanies, value: companiesStr } = popFlagValue(args, "--companies");
    void aCompanies;
    const scope: string[] = companiesStr
      ? companiesStr.split(",").map((s) => s.trim()).filter(Boolean)
      : Object.keys(ADAPTERS);

    type ReconResult = {
      company: string;
      submit_kind?: string;
      submit_endpoint?: string;
      status?: number;
      classification: "verified-real" | "speculative-404" | "html-fallthrough" | "external" | "no-endpoint" | "probe-error";
      detail: string;
      /** Schema-declared verification (already a known-good route). */
      already_verified?: boolean;
    };
    function classify(status: number, body: string, contentType: string): ReconResult["classification"] {
      const isHTML = contentType.includes("html") || body.trim().startsWith("<");
      // 5xx + any body = handler threw on us, route exists. IIS / Spring
      // generic 500 templates are HTML but still real-route signals.
      if (status >= 500) return "verified-real";
      // 405 + any body = method-not-allowed = the routing table has this
      // URL; just the method/body is wrong. Real route. Nginx's HTML 405
      // page is one common form, hence the explicit handling here.
      if (status === 405) return "verified-real";
      if (status === 404) return isHTML ? "html-fallthrough" : "speculative-404";
      if (isHTML) return "html-fallthrough";
      // 401/403/200-with-error-body/4xx-with-business-error = real route
      return "verified-real";
    }

    function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
      return Promise.race([
        p,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
      ]);
    }

    const results = await Promise.all(
      scope.map(async (company): Promise<ReconResult> => {
        // lilith uses CDP (puppeteer launches Chrome) — its withTimeout
        // returns but the browser handle keeps the event loop alive, so
        // the process never exits. Skip it explicitly; users who want to
        // recon lilith can scope --companies=lilith and accept the hang.
        if (company === "lilith") {
          // lilith is in ENDPOINT_VERIFIED but we skip the probe (would
          // hang puppeteer). Surface the already_verified status so the
          // icon shows ⚠ ("schema verified, probe skipped") not "?".
          return { company, classification: "probe-error", detail: "skipped — CDP adapter (puppeteer); pass --companies=lilith explicitly to probe", already_verified: true };
        }
        const adapter = (ADAPTERS as Record<string, CompanyAdapter>)[company];
        if (!adapter) return { company, classification: "probe-error", detail: "unknown adapter" };
        if (typeof adapter.fetchApplicationSchema !== "function") {
          return { company, classification: "probe-error", detail: "no fetchApplicationSchema" };
        }
        // Use a placeholder post_id so we don't have to search.
        // Per-step timeout protects against slow / hung adapters.
        let schema: ApplyFormSchema | null = null;
        try {
          const r = await withTimeout(
            adapter.fetchApplicationSchema("recon-probe") as Promise<{ ok?: boolean; schema?: ApplyFormSchema }>,
            10000
          );
          if (r?.ok && r.schema) schema = r.schema;
        } catch {}
        if (!schema) {
          try {
            const list = await withTimeout(
              adapter.searchPositions({ pageSize: 1 }) as Promise<{ ok?: boolean; positions?: Array<{ post_id?: string }> }>,
              10000
            );
            const pid = list?.positions?.[0]?.post_id;
            if (pid) {
              const r = await withTimeout(
                adapter.fetchApplicationSchema(pid) as Promise<{ ok?: boolean; schema?: ApplyFormSchema }>,
                10000
              );
              if (r?.ok && r.schema) schema = r.schema;
            }
          } catch {}
        }
        if (!schema) return { company, classification: "probe-error", detail: "schema unavailable" };
        if (schema.submit_kind === "external") {
          return { company, submit_kind: schema.submit_kind, classification: "external", detail: "structurally external (Liepin / WeChat)" };
        }
        const url = schema.submit_endpoint ?? "";
        if (!url) return { company, submit_kind: schema.submit_kind, classification: "no-endpoint", detail: "no submit_endpoint in schema" };
        try {
          const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          const body = await r.text();
          const ct = r.headers.get("content-type") ?? "";
          return {
            company,
            submit_kind: schema.submit_kind,
            submit_endpoint: url,
            status: r.status,
            classification: classify(r.status, body, ct),
            detail: body.slice(0, 80).replace(/\s+/g, " "),
            already_verified: schema.endpoint_verified === true,
          };
        } catch (err) {
          return { company, submit_kind: schema.submit_kind, submit_endpoint: url, classification: "probe-error", detail: err instanceof Error ? err.message : String(err), already_verified: schema.endpoint_verified === true };
        }
      })
    );

    if (compact) {
      console.log(JSON.stringify({ probed: results.length, results }));
      return;
    }
    const tally = new Map<string, number>();
    for (const r of results) tally.set(r.classification, (tally.get(r.classification) ?? 0) + 1);
    const width = Math.max(...results.map((r) => r.company.length));
    const ICON: Record<ReconResult["classification"], string> = {
      "verified-real": "✓",
      "speculative-404": "✗",
      "html-fallthrough": "✗",
      "external": "⛔",
      "no-endpoint": "·",
      "probe-error": "?",
    };
    console.log(`\njob-pro recon — endpoint probe across ${results.length} adapters`);
    if (!summary) {
      console.log(`  (anon POST with {} body; schema-verified adapters tagged 🟢)\n`);
      for (const r of results) {
        const tag = r.status ? `${r.status}` : "—";
        const vTag = r.already_verified ? " 🟢" : "";
        // If the schema asserts endpoint_verified: true but the anon probe
        // sees 404/HTML, the framework's response is misleading — schema's
        // probe round was deeper. Surface a ⚠ icon instead of ✗ to signal
        // "schema says verified, probe disagrees".
        const probeOK = r.classification === "verified-real" || r.classification === "external";
        const icon = r.already_verified && !probeOK ? "⚠" : ICON[r.classification];
        console.log(`  ${icon} ${r.company.padEnd(width)}  ${tag.padEnd(4)} ${r.classification.padEnd(17)}${vTag}  ${r.detail}`);
      }
    }
    console.log(`\n  Tally:`);
    for (const [k, v] of [...tally.entries()].sort()) {
      console.log(`    ${k.padEnd(20)}  ${v}`);
    }
    // Some adapters (cdp/lilith via puppeteer) keep the event loop alive
    // after their probe resolves. Explicit exit guarantees the CLI returns.
    process.exit(0);
  }
  if (cmd === "selftest") {
    // Three end-to-end checks against the easiest adapter (xpeng, anon-submit):
    // 1. searchPositions returns >0 hits
    // 2. fetchApplicationSchema for the first hit returns ok:true with questions
    // 3. submitApplication(staged, {kind:"debug", url:httpbin}) returns 200
    // Total ~3-5s. No profile / no session needed. Useful right after install
    // to confirm the CLI can actually round-trip end-to-end.
    const compact = args.includes("--compact");
    const xpengAdapter = (ADAPTERS as Record<string, CompanyAdapter>).xpeng;
    type CheckResult = { name: string; ok: boolean; detail: string; ms: number };
    const checks: CheckResult[] = [];
    async function run<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
      const t0 = Date.now();
      try {
        const r = await fn();
        checks.push({ name, ok: true, detail: "", ms: Date.now() - t0 });
        return r;
      } catch (err) {
        checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 });
        return null;
      }
    }

    // Step 1
    const list = await run("search xpeng", async () => {
      const r = (await xpengAdapter.searchPositions({ pageSize: 1 })) as { ok?: boolean; positions?: Array<{ post_id?: string; title?: string }>; total?: number };
      if (!r.ok || !r.positions?.[0]?.post_id) throw new Error("no positions returned");
      return r;
    });
    let postId: string | null = null;
    let title = "";
    if (list && list.positions?.[0]) {
      postId = String(list.positions[0].post_id ?? "");
      title = String(list.positions[0].title ?? "").trim();
    }

    // Step 2
    let schema: ApplyFormSchema | null = null;
    if (postId && typeof xpengAdapter.fetchApplicationSchema === "function") {
      schema = await run("fetch schema", async () => {
        const r = (await xpengAdapter.fetchApplicationSchema!(postId!)) as { ok?: boolean; schema?: ApplyFormSchema; message?: string };
        if (!r.ok || !r.schema) throw new Error(r.message ?? "schema fetch failed");
        return r.schema;
      });
    } else if (!postId) {
      checks.push({ name: "fetch schema", ok: false, detail: "skipped — no post_id from search", ms: 0 });
    }

    // Step 3
    if (schema) {
      const tmp = mkdtempSync(join(tmpdir(), "jobpro-selftest-"));
      const resumePath = join(tmp, "resume.pdf");
      writeFileSync(resumePath, "%PDF\n");
      const profile: ResumeProfile = {
        first_name: "Self", last_name: "Test", email: "selftest@example.com",
        phone: "+86 13800138000", resume_path: resumePath, cover_letter_text: "",
        custom: {},
      };
      // Auto-fill required: first allowed value for selects, "N/A" for text.
      for (const q of schema.questions) {
        if (!q.required) continue;
        const f = q.fields[0];
        if (!f) continue;
        if (["input_text", "textarea"].includes(f.type)) profile.custom![f.name] = "N/A (selftest)";
        else if (f.type.includes("select")) {
          const first = f.values?.[0];
          if (first && typeof first.value !== "undefined") profile.custom![f.name] = String(first.value);
        }
      }
      const staged = stageApplication(schema, profile);
      if (!staged.ready) {
        checks.push({ name: "debug-submit echo", ok: false, detail: `staged not ready: ${staged.unanswered_required.slice(0, 3).join(", ")}`, ms: 0 });
      } else {
        await run("debug-submit echo", async () => {
          const r = (await submitApplication(staged, { kind: "debug", url: "https://httpbin.org/post" })) as { ok?: boolean; status?: number; message?: string };
          if (r.ok !== true || r.status !== 200) throw new Error(`echo failed: ok=${r.ok} status=${r.status} msg=${r.message}`);
          return r;
        });
      }
      rmSync(tmp, { recursive: true, force: true });
    }

    const fails = checks.filter((c) => !c.ok).length;
    if (compact) {
      console.log(JSON.stringify({ ok: fails === 0, checks }));
    } else {
      console.log(`\njob-pro selftest — using xpeng (anon Greenhouse board)\n`);
      for (const c of checks) {
        const icon = c.ok ? "✓" : "✗";
        const detail = c.detail ? `  ${c.detail}` : "";
        console.log(`  ${icon} ${c.name.padEnd(20)} ${c.ms}ms${detail}`);
      }
      console.log(`\n  ${checks.length - fails} pass / ${fails} fail / ${checks.length} total${title ? ` — sampled "${title}"` : ""}`);
      if (fails === 0) console.log(`\n  Setup looks good. Run \`job-pro find "<keyword>"\` to scan all 50 companies.`);
    }
    if (fails > 0) process.exit(1);
    return;
  }
  if (cmd === "extension") {
    // Locate the extension/ directory. The package ships it as a sibling of
    // dist/, so __dirname is cli/dist and the extension lives at ../extension.
    // For a `npx job-pro` run, that lands in the npm cache; for a global
    // install, in the prefix. For local dev, the repo's top-level extension/.
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, "..", "extension"),
      join(here, "..", "..", "extension"),
    ];
    const extPath = candidates.find((p) => existsSync(join(p, "manifest.json"))) ?? null;
    const sub = args[1];
    if (sub === "path") {
      if (!extPath) die("extension/ not found — please reinstall job-pro@latest");
      console.log(extPath);
      return;
    }
    // Default: print install walkthrough.
    if (!extPath) die("extension/ not found — please reinstall job-pro@latest");
    console.log(`
job-pro session-capture extension
=================================

Path:  ${extPath}

Install (Chrome / Edge / Brave):
  1. Open chrome://extensions
  2. Enable "Developer mode" (top-right toggle)
  3. Click "Load unpacked"
  4. Pick the path above
  5. Browse a careers site (e.g. jobs.bytedance.com), log in, then click
     the extension's popup → "Export session" to drop
     ~/Downloads/jobpro/<adapter>.session.json
  6. Move it under ~/.jobpro/<adapter>.session.json — \`job-pro <co> apply\`
     will pick it up automatically.

Or copy the path to clipboard (macOS):
  echo "${extPath}" | pbcopy
`);
    return;
  }
  if (cmd === "find") {
    const compact = args.includes("--compact");
    const textMode = args.includes("--text");
    const applyReadyOnly = args.includes("--apply-ready");
    const keyword = args[1];
    if (!keyword || keyword.startsWith("--")) {
      die(`usage: job-pro find <keyword> [--limit N] [--companies a,b,c] [--timeout ms] [--apply-ready] [--compact | --text]`);
    }
    // Apply-readiness derives from the canonical SUBMIT_KIND_BY_FAMILY map
    // (single source of truth shared with `list`). multipart-anon is fire-
    // and-go; external is structurally blocked; everything else needs a
    // captured session.
    const applyStatusFor = (adapterKey: string): "anon" | "session" | "missing-session" | "external" => {
      const dirEntry = COMPANIES.find((c) => c.key === adapterKey);
      if (!dirEntry) return "missing-session";
      const kind = submitKindFor(adapterKey, dirEntry.family);
      if (kind === "external") return "external";
      if (kind === "multipart-anon") return "anon";
      return loadSession(adapterKey) ? "session" : "missing-session";
    };
    const { args: aLimit, value: limitStr } = popFlagValue(args, "--limit");
    const { args: aCompanies, value: companiesStr } = popFlagValue(aLimit, "--companies");
    const { args: aTimeout, value: timeoutStr } = popFlagValue(aCompanies, "--timeout");
    void aTimeout;
    const limit = limitStr ? Math.max(1, parseInt(limitStr, 10)) : 3;
    const timeout = timeoutStr ? Math.max(1000, parseInt(timeoutStr, 10)) : 8000;
    const scope: string[] = companiesStr
      ? companiesStr.split(",").map((s) => s.trim()).filter(Boolean)
      : Object.keys(ADAPTERS);
    const unknown = scope.filter((c) => !(c in ADAPTERS));
    if (unknown.length > 0) die(`unknown company in --companies: ${unknown.join(", ")}`);

    const startedAt = Date.now();
    const settled = await Promise.all(
      scope.map(async (company) => {
        const adapter = (ADAPTERS as Record<string, CompanyAdapter>)[company];
        const t0 = Date.now();
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          const timeoutP = new Promise<{ timedOut: true }>((resolve) => {
            timer = setTimeout(() => resolve({ timedOut: true }), timeout);
          });
          const searchP = adapter
            .searchPositions({ keyword, pageSize: limit })
            .then((r) => ({ ok: true as const, value: r }));
          const raced = await Promise.race([timeoutP, searchP]);
          const elapsed = Date.now() - t0;
          if ("timedOut" in raced) {
            return { company, ok: false, count: 0, positions: [], message: `timeout after ${timeout}ms`, elapsed_ms: elapsed };
          }
          const r = raced.value as { ok?: boolean; positions?: unknown[]; message?: string };
          if (r?.ok === false) {
            return { company, ok: false, count: 0, positions: [], message: r.message ?? "search failed", elapsed_ms: elapsed };
          }
          const positions = Array.isArray(r?.positions) ? r.positions.slice(0, limit) : [];
          return { company, ok: true, count: positions.length, positions, apply_status: applyStatusFor(company), elapsed_ms: elapsed };
        } catch (err) {
          const elapsed = Date.now() - t0;
          const message = err instanceof Error ? err.message : String(err);
          return { company, ok: false, count: 0, positions: [], message, elapsed_ms: elapsed };
        } finally {
          if (timer) clearTimeout(timer);
        }
      })
    );

    const totalMs = Date.now() - startedAt;
    const allHits = settled.filter((r) => r.count > 0);
    const withHits = applyReadyOnly
      ? allHits.filter((r) => r.apply_status === "anon" || r.apply_status === "session")
      : allHits;
    const total = withHits.reduce((s, r) => s + r.count, 0);
    const failed = settled.filter((r) => !r.ok).map((r) => ({ company: r.company, message: r.message }));
    if (textMode) {
      const STATUS_ICON: Record<string, string> = {
        anon: "✅",
        session: "🟢",
        "missing-session": "🟡",
        external: "⛔",
      };
      const filterNote = applyReadyOnly ? " [apply-ready only]" : "";
      console.log(`\nfind "${keyword}" — ${total} hit(s) across ${withHits.length}/${scope.length} companies (${totalMs}ms)${filterNote}\n`);
      for (const r of withHits) {
        const icon = STATUS_ICON[r.apply_status ?? ""] ?? "?";
        console.log(`${icon} ${r.company} (${r.count}) — ${r.apply_status}`);
        for (const p of r.positions as Array<{ post_id?: string; title?: string; work_cities?: string; apply_url?: string }>) {
          const title = (p.title ?? "").trim().replace(/\s+/g, " ");
          const loc = (p.work_cities ?? "").trim();
          console.log(`  ${p.post_id ?? "?"}  ${title}${loc ? ` — ${loc}` : ""}`);
          if (p.apply_url) console.log(`    ${p.apply_url}`);
        }
        console.log("");
      }
      if (applyReadyOnly) {
        const hiddenBuckets = allHits.filter(
          (r) => r.apply_status === "missing-session" || r.apply_status === "external"
        );
        if (hiddenBuckets.length > 0) {
          const missing = hiddenBuckets
            .filter((r) => r.apply_status === "missing-session")
            .map((r) => `${r.company}(${r.count})`);
          const external = hiddenBuckets
            .filter((r) => r.apply_status === "external")
            .map((r) => `${r.company}(${r.count})`);
          console.log(`Hidden by --apply-ready:`);
          if (missing.length) console.log(`  🟡 missing-session (run \`job-pro extension\`): ${missing.join(" ")}`);
          if (external.length) console.log(`  ⛔ external (IM-mediated):              ${external.join(" ")}`);
          console.log("");
        }
      }
      if (failed.length > 0) {
        console.log(`Failed (${failed.length}):`);
        for (const f of failed) console.log(`  ${f.company}: ${f.message}`);
      }
      return;
    }
    emit(
      {
        ok: true,
        keyword,
        total,
        company_count: withHits.length,
        scanned_companies: scope.length,
        elapsed_ms: totalMs,
        results: withHits,
        failed,
      },
      compact
    );
    return;
  }

  if (cmd === "profile") {
    const sub = args[1];
    if (sub === "init") {
      const { path, template } = profileTemplate();
      if (existsSync(path) && !args.includes("--force")) {
        console.error(`profile already exists at ${path}; pass --force to overwrite.`);
        process.exit(1);
      }
      mkdirSync(dirname(path), { recursive: true });
      const interactive = args.includes("--interactive");
      const filled = interactive ? await runProfileInitInteractive(template) : template;
      writeFileSync(path, JSON.stringify(filled, null, 2) + "\n", "utf8");
      if (interactive) {
        console.log(`\nWrote ${path}. Run \`job-pro status\` to confirm, then \`job-pro <co> apply <id>\` to start.`);
      } else {
        console.log(`Wrote ${path}. Fill in first_name / last_name / email / phone / resume_path before running \`job-pro <co> apply\`. (Tip: pass --interactive to fill it in the terminal now.)`);
      }
      return;
    }
    if (sub === "show") {
      const r = loadProfile();
      if (!r.ok) {
        console.error(r.message);
        process.exit(1);
      }
      console.log(JSON.stringify(r.profile, null, 2));
      return;
    }
    if (sub === "lint") {
      const compact = args.includes("--compact");
      const r = loadProfileRaw();
      if (!r.ok) {
        console.error(r.message);
        process.exit(1);
      }
      const p = r.profile;
      type Finding = { level: "PASS" | "WARN" | "FAIL"; check: string; message: string };
      const findings: Finding[] = [];
      // first_name / last_name
      for (const k of ["first_name", "last_name"] as const) {
        const v = (p[k] ?? "").trim();
        if (!v) findings.push({ level: "FAIL", check: k, message: "missing" });
        else findings.push({ level: "PASS", check: k, message: v });
      }
      // email
      const email = (p.email ?? "").trim();
      if (!email) findings.push({ level: "FAIL", check: "email", message: "missing" });
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        findings.push({ level: "FAIL", check: "email", message: `"${email}" doesn't look like a valid address` });
      else findings.push({ level: "PASS", check: "email", message: email });
      // phone
      const phone = (p.phone ?? "").trim();
      if (!phone) findings.push({ level: "FAIL", check: "phone", message: "missing" });
      else {
        const digitCount = phone.replace(/\D/g, "").length;
        if (digitCount < 7) findings.push({ level: "FAIL", check: "phone", message: `"${phone}" has ${digitCount} digit(s); need 7+` });
        else if (!phone.startsWith("+"))
          findings.push({ level: "WARN", check: "phone", message: `"${phone}" missing country code (recommended for non-anon adapters; e.g. +86 / +1)` });
        else findings.push({ level: "PASS", check: "phone", message: phone });
      }
      // resume_path
      const rp = (p.resume_path ?? "").trim();
      if (!rp) findings.push({ level: "FAIL", check: "resume_path", message: "missing" });
      else if (!existsSync(rp)) findings.push({ level: "FAIL", check: "resume_path", message: `file not found: ${rp}` });
      else {
        const lower = rp.toLowerCase();
        if (!/\.(pdf|docx?|md|txt|rtf)$/i.test(lower))
          findings.push({ level: "WARN", check: "resume_path", message: `unusual extension: ${rp} (most ATS expect .pdf or .docx)` });
        else findings.push({ level: "PASS", check: "resume_path", message: rp });
      }
      // custom
      const customCount = Object.keys(p.custom ?? {}).length;
      if (customCount > 0) {
        const emptyValues = Object.entries(p.custom ?? {})
          .filter(([, v]) => typeof v !== "string" || v.trim() === "")
          .map(([k]) => k);
        if (emptyValues.length > 0)
          findings.push({ level: "WARN", check: "custom", message: `${emptyValues.length} empty value(s): ${emptyValues.slice(0, 5).join(", ")}` });
        else findings.push({ level: "PASS", check: "custom", message: `${customCount} answer(s)` });
      }
      const fails = findings.filter((f) => f.level === "FAIL").length;
      const warns = findings.filter((f) => f.level === "WARN").length;
      if (compact) {
        console.log(JSON.stringify({ ok: fails === 0, fails, warns, findings }));
      } else {
        const ICON: Record<string, string> = { PASS: "✓", WARN: "!", FAIL: "✗" };
        for (const f of findings) console.log(`  ${ICON[f.level]} ${f.check.padEnd(13)} ${f.message}`);
        console.log(`\n  ${fails} fail / ${warns} warn / ${findings.length - fails - warns} pass`);
      }
      if (fails > 0) process.exit(1);
      return;
    }
    die(`usage: job-pro profile <init [--interactive] [--force] | show | lint>`);
  }

  const adapter = (ADAPTERS as Record<string, CompanyAdapter>)[cmd];
  if (adapter) {
    await runCompany(adapter, cmd, args.slice(1));
    return;
  }

  die(
    `unknown company: ${cmd}. Try \`job-pro list\` for the full list, ` +
      `or \`job-pro help\` for usage.`
  );
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
