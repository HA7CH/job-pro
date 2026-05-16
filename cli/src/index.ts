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
  memoryList,
  memoryGet,
  memorySet,
  memoryEvent,
  memoryClear,
} from "./memory.js";

const VERSION = "0.8.2";

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

const HELP = `
job-pro — query Chinese big-tech campus recruiting from your terminal
            (job.ha7ch.com)

USAGE
  job-pro <company> <verb> [options]
  job-pro list [--compact]            list all 50 companies + source family
  job-pro --version
  job-pro help

50 companies, all live. Run \`job-pro list\` for the full table grouped
by ATS family (Bespoke / Feishu / Beisen Wecruit / Beisen iTalent / Moka
/ Greenhouse-Lever / Liepin). Coverage summary at job.ha7ch.com.

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
    // Machine-readable: emit a JSON array of { key, family, source, label }.
    console.log(JSON.stringify(COMPANIES));
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
  console.log(`job-pro — 50 companies, all live. ATS-family breakdown:`);
  for (const family of order) {
    const entries = byFamily.get(family);
    if (!entries) continue;
    console.log(`\n${family} (${entries.length})`);
    for (const c of entries) {
      console.log(`  ${c.key.padEnd(keyWidth)}  ${c.source.padEnd(srcWidth)}  ${c.label}`);
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
