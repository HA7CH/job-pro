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

const VERSION = "0.8.1";

const HELP = `
job-pro — query Chinese big-tech campus recruiting from your terminal
            (job.ha7ch.com)

USAGE
  job-pro <company> <verb> [options]
  job-pro --version
  job-pro help

COMPANIES (50 — all live; see job.ha7ch.com for the full matrix)

  Bespoke per-company API
    tencent          join.qq.com                 (Tencent / 腾讯)
    bytedance        jobs.bytedance.com          (ByteDance / 字节跳动)
    alibaba          campus-talent.alibaba.com   (Alibaba / 阿里巴巴)
    meituan          zhaopin.meituan.com         (Meituan / 美团)
    xiaohongshu      job.xiaohongshu.com         (Xiaohongshu / 小红书)
    jd               campus.jd.com               (JD / 京东)
    kuaishou         campus.kuaishou.cn          (Kuaishou / 快手)
    baidu            talent.baidu.com            (Baidu / 百度)
    netease          hr.163.com                  (NetEase / 网易)
    didi             talent.didiglobal.com       (Didi / 滴滴)
    bilibili         jobs.bilibili.com           (Bilibili / 哔哩哔哩)
    pdd              careers.pinduoduo.com       (PDD / 拼多多)
    huawei           career.huawei.com           (Huawei / 华为)
    weibo            career.sina.com.cn          (Weibo / 微博)
    mihoyo           ats.openout.mihoyo.com      (miHoYo / 米哈游)
    pingan           campus.pingan.com           (Ping An / 平安)
    trip             careers.ctrip.com           (Trip.com / 携程)
    unitree          www.unitree.com             (Unitree / 宇树科技)
    byd              job.byd.com                 (BYD / 比亚迪)
    antgroup         hrcareersweb.antgroup.com   (Ant Group / 蚂蚁集团)
    liauto           www.lixiang.com             (Li Auto / 理想汽车)
    zerooneai        01ai.jobs.feishu.cn         (01.AI / 零一万物)
    baichuan         cq6qe6bvfr6.jobs.feishu.cn  (Baichuan / 百川智能)
    sf               campus.sf-express.com       (SF Express / 顺丰)
    oppo             careers.oppo.com            (OPPO)

  Feishu Recruiting (ATSX)
    xiaomi           xiaomi.jobs.f.mioffice.cn   (Xiaomi / 小米)
    nio              nio.jobs.feishu.cn          (NIO / 蔚来)
    minimax          vrfi1sk8a0.jobs.feishu.cn   (MiniMax)
    moonshot         moonshot.jobs.feishu.cn     (Moonshot / 月之暗面)
    zhipu            zhipu-ai.jobs.feishu.cn     (Zhipu / 智谱AI)
    iqiyi            careers.iqiyi.com           (iQIYI / 爱奇艺)
    agibot           agirobot.jobs.feishu.cn     (Agibot / 智元机器人)
    lilith           lilithgames.jobs.feishu.cn  (Lilith Games / 莉莉丝 — needs local Chrome)

  Beisen Wecruit
    sensetime        hr.sensetime.com            (SenseTime / 商汤)
    horizonrobotics  wecruit.hotjob.cn           (Horizon Robotics / 地平线)

  Beisen iTalent (zhiye)
    vivo             vivo.zhiye.com              (vivo)
    iflytek          iflytek.zhiye.com           (iFlytek / 科大讯飞)

  Moka (app.mokahr.com)
    megvii           app.mokahr.com/megviihr     (Megvii / 旷视)
    deepseek         app.mokahr.com/high-flyer   (DeepSeek / 深度求索)
    galaxyuniversal  app.mokahr.com/yinhetongyong (Galaxy Universal / 银河通用)
    stepfun          app.mokahr.com/step         (StepFun / 阶跃星辰)
    cambricon        app.mokahr.com/cambricon    (Cambricon / 寒武纪)
    geely            app.mokahr.com/geely        (Geely / 吉利)

  Greenhouse / Lever (international arm only)
    xpeng            boards.greenhouse.io/xpengmotors  (XPeng / 小鹏汽车 — US AI)
    weride           jobs.lever.co/weride        (WeRide / 文远知行 — US / 广州)
    hoyoverse        boards.greenhouse.io/hoyoverse    (HoYoverse / 米哈游国际)

  Third-party (Liepin aggregator — no canonical public feed exists)
    hikvision        api-c.liepin.com            (Hikvision / 海康威视)
    cicc             api-c.liepin.com            (CICC / 中金)
    cainiao          api-c.liepin.com            (Cainiao / 菜鸟)
    webank           api-c.liepin.com            (WeBank / 微众银行)

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

  const adapter = (ADAPTERS as Record<string, CompanyAdapter>)[cmd];
  if (adapter) {
    await runCompany(adapter, cmd, args.slice(1));
    return;
  }

  die(
    `unknown company: ${cmd}. Supported: ${Object.keys(ADAPTERS).join(
      ", "
    )}. Try \`job-pro help\`.`
  );
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
