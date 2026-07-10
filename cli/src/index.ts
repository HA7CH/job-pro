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
import type { CompanyAdapter, PositionScope } from "./adapter.js";
import { loadProfileRaw, profilePath } from "./profile.js";
import {
  memoryList,
  memoryGet,
  memorySet,
  memoryEvent,
  memoryClear,
} from "./memory.js";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Read version from package.json at module load so it can never drift
// from the publish. Tries the bundled package.json (cli/package.json
// next to dist/) first, then falls back to a hardcoded sentinel.
const VERSION = ((): string => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // cli/dist/index.js → cli/package.json is two levels up
    const candidates = [
      join(here, "..", "package.json"),
      join(here, "..", "..", "package.json"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { version?: string; name?: string };
        if ((pkg.name === "@ha7ch/job-pro" || pkg.name === "job-pro") && typeof pkg.version === "string") return pkg.version;
      }
    }
  } catch { /* fall through */ }
  return "unknown";
})();

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
  job-pro status [--compact]          survey profile / memory
  job-pro selftest [--compact]        end-to-end check: search → detail → match
  job-pro find <keyword>              search ALL 50 companies in parallel
                                      [--limit N] [--companies a,b,c]
                                      [--timeout ms]
                                      [--compact | --text]
  job-pro --version
  job-pro help

50 companies, all live. Run \`job-pro list\` for the full table grouped
by ATS family (Bespoke / Feishu / Beisen Wecruit / Beisen iTalent / Moka
/ Greenhouse-Lever / Liepin). Coverage summary at job.ha7ch.com.

VERBS (same surface for every company)
  search <kw>                       search openings (free text)
  --scope <social|campus|intern|all>  restrict to a single recruit channel
                                      (default: each adapter's historical pick).
                                      Works on \`search\`, \`all\`, \`match\`,
                                      and the cross-company \`find\` verb.
  detail <post_id>                  show full JD for one job
  all [<kw>]                        paginate every job (filter by kw if given)
  dicts                             dump filter dictionaries (where supported)
  notices                           list official announcements (where supported)
  notice <id>                       show one announcement's content (tencent only)
  flow <question>                   answer using best-matching notices (tencent only)
  match [resume-text-or-]           rank jobs by overlap with resume text
                                    --resume <path>            read .docx / .pdf / .json / .txt
                                    pass "-" to read resume from stdin
                                    omit args to use profile.resume_path
  resume-check [resume-text-or-]    structural sanity check on a resume
                                    --resume <path>            same format support as match
  memory list | get <k> | set k=v | event <kind> [payload] | clear

OUTPUT
  Add --compact for one-line JSON (good for piping to jq / claude).

EXAMPLES
  job-pro tencent search "后台开发" --page-size 5
  job-pro bytedance search "前端" --page-size 5
  job-pro bytedance search "后台开发" --scope social --page-size 5
  job-pro alibaba search "AI" --page-size 5
  job-pro tencent detail 1200791473415778304
  job-pro bytedance detail 7638940721068099893
  job-pro alibaba detail 199903220038
  job-pro tencent notices
  job-pro tencent flow "腾讯2026实习什么时候开始投递" --question-time 2026-05-13
  cat my-resume.md | job-pro tencent match -
  job-pro tencent match --resume ~/cv.docx --top-n 10
  job-pro tencent match --resume ~/resume.json --top-n 10
  job-pro tencent memory set "stack=Go,Python" "target_city=深圳"
  job-pro bytedance memory event applied "ByteDance 前端 7638940721068099893"

COMPANION
  cv.ha7ch.com — spin up a tailored resume for each company in seconds,
  then feed it straight into \`match\` / \`resume-check\`.

DOCS
  https://job.ha7ch.com
  https://github.com/HA7CH/job-pro
`.trim();

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

/**
 * Validate and narrow a raw `--scope` value (1.1.0+).
 *
 * `undefined` (caller omitted the flag) flows through unchanged — adapters
 * fall back to their historical default. Any other string must be one of
 * the four canonical scopes; anything else dies early with a useful list.
 */
const POSITION_SCOPES = ["social", "campus", "intern", "all"] as const;
function validateScope(raw: unknown): PositionScope | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    die(`unknown scope: ${JSON.stringify(raw)}. Accepted: social, campus, intern, all.`);
  }
  if (!(POSITION_SCOPES as readonly string[]).includes(raw)) {
    die(`unknown scope: ${raw}. Accepted: social, campus, intern, all.`);
  }
  return raw as PositionScope;
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

async function readResumeArg(
  arg: string | undefined,
  opts: { resumePathFlag?: string; allowProfileFallback?: boolean } = {}
): Promise<string> {
  // 1. --resume <path> flag (highest priority)
  if (opts.resumePathFlag) {
    return await readResumeByPath(opts.resumePathFlag);
  }
  // 2. positional "-" → stdin
  if (arg === "-") {
    try {
      return readFileSync(0, "utf8");
    } catch {
      die("could not read resume text from stdin");
    }
  }
  // 3. positional path that exists → parse by extension
  if (arg) {
    try {
      statSync(arg);
      return await readResumeByPath(arg);
    } catch {
      return arg; // not a file → treat as literal resume text
    }
  }
  // 4. fallback: profile.resume_path
  if (opts.allowProfileFallback) {
    const prof = loadProfileRaw();
    if (prof.ok && prof.profile?.resume_path) {
      return await readResumeByPath(prof.profile.resume_path);
    }
  }
  die(
    "expected resume input. Pass --resume <path-to-cv.docx|pdf|json|txt> " +
      "or pipe text via '-', or set profile.resume_path."
  );
}

async function readResumeByPath(path: string): Promise<string> {
  try {
    const { readResumeFromPath } = await import("./resume.js");
    const parsed = await readResumeFromPath(path);
    if (!parsed.text || parsed.text.trim().length < 20) {
      die(
        `parsed ${parsed.source} resume at ${path} is empty or too short ` +
          `(${parsed.text?.length ?? 0} chars). Confirm the file is a valid resume.`
      );
    }
    return parsed.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    die(`failed to read resume from ${path}: ${msg}`);
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

  // 1.1.0 — validate `--scope` against the adapter's declared supportedScopes
  // BEFORE per-verb dispatch, so an unsupported scope dies fast with a
  // useful "company X does not support --scope Y. Supported: ..." message
  // instead of getting silently translated into an empty result by the
  // adapter. The actual scope value still flows through `popAllOpts` inside
  // each verb branch (search/all/match) into the adapter's options bag.
  //
  // Pre-scan rather than mutate `args` so verb handlers still see the flag
  // and route it through their existing `popAllOpts(args)` path. Validation
  // is verb-agnostic — `apply` / `detail` / `dicts` / etc. accept the flag
  // and silently ignore it (cosmetic per §1.3), so the check is just an
  // early gate against "this adapter has no such channel at all".
  const scopeIdx = args.indexOf("--scope");
  if (scopeIdx !== -1) {
    const rawScope = args[scopeIdx + 1];
    const scope = validateScope(rawScope);
    if (scope !== undefined) {
      const supported =
        (adapter.supportedScopes as readonly string[] | undefined) ??
        (POSITION_SCOPES as readonly string[]);
      if (!supported.includes(scope)) {
        die(
          `${company} does not support --scope ${scope}. Supported: ${supported.join(", ")}.`
        );
      }
    }
  }

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
    const { args: a3, value: resumePath } = popFlagValue(a2, "--resume");
    const text = await readResumeArg(a3[0], {
      resumePathFlag: resumePath,
      allowProfileFallback: true,
    });
    // Pull degree from profile (no flag override yet — keeps things simple).
    // Anything not in {bachelor, master, phd} is silently dropped, so a typo
    // never breaks the call.
    const profRaw = loadProfileRaw();
    const rawDegree = profRaw.ok ? profRaw.profile?.degree : undefined;
    const userDegree =
      rawDegree === "bachelor" || rawDegree === "master" || rawDegree === "phd"
        ? rawDegree
        : undefined;
    return emit(
      await adapter.matchResume(text, {
        topN: topN ? Number(topN) : undefined,
        candidates: candidates ? Number(candidates) : undefined,
        userDegree,
      }),
      compact
    );
  }

  if (verb === "resume-check") {
    const { args: a, value: resumePath } = popFlagValue(args, "--resume");
    const text = await readResumeArg(a[0], {
      resumePathFlag: resumePath,
      allowProfileFallback: true,
    });
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

interface StatusReport {
  profile: {
    path: string;
    exists: boolean;
    resume_path?: string;
    resume_path_ok: boolean;
  };
  memory: {
    path?: string;
    field_keys: string[];
    recent_events: Array<{ ts: string; kind: string; payload: string }>;
    total_events: number;
  };
}

function buildStatusReport(): StatusReport {
  // Profile state — read-only. The CLI never writes profile.json anymore;
  // it only matters because `match` / `resume-check` fall back to
  // `profile.resume_path` when the caller omits --resume, so status reports
  // whether that fallback would actually work.
  const prof = loadProfileRaw();
  const resumePath = prof.ok ? prof.profile?.resume_path : undefined;
  const profile: StatusReport["profile"] = {
    path: profilePath(),
    exists: existsSync(profilePath()),
    resume_path: resumePath,
    resume_path_ok:
      typeof resumePath === "string" && resumePath.length > 0 && existsSync(resumePath),
  };

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

  return { profile, memory: memSummary };
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
  const profIcon = r.profile.exists && r.profile.resume_path_ok ? "✓" : "·";
  console.log(`Profile  ${profIcon}  ${r.profile.path}`);
  if (!r.profile.exists) {
    console.log(`         not found — optional. \`match\`/\`resume-check\` then need --resume <path> or inline text.`);
  } else if (r.profile.resume_path_ok) {
    console.log(`         resume_path: ${r.profile.resume_path} — \`match\`/\`resume-check\` fall back to it when --resume is omitted.`);
  } else {
    console.log(`         resume_path: ${r.profile.resume_path || "(not set)"} — unusable; pass --resume <path> or fix the file path.`);
  }
  console.log();
  // Memory
  console.log(`Memory   ${r.memory.total_events > 0 ? "✓" : "·"}  ${r.memory.path ?? "(none)"}`);
  console.log(`         fields=${r.memory.field_keys.length}  events=${r.memory.total_events}`);
  for (const e of r.memory.recent_events.slice(0, 5)) {
    console.log(`         ${e.ts}  ${e.kind.padEnd(12)} ${(e.payload ?? "").slice(0, 60)}`);
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
  if (cmd === "status") {
    const compact = args.includes("--compact");
    printStatus(compact);
    return;
  }
  if (cmd === "selftest") {
    // Three read-side checks against the easiest adapter (xpeng, Greenhouse):
    // 1. searchPositions returns >0 hits
    // 2. fetchPositionDetail for the first hit returns ok:true + a title
    // 3. matchResume ranks an inline sample resume (signal extraction and
    //    scoring are local; it reuses the same public search API)
    // Total ~3-5s. No profile needed. Useful right after install to confirm
    // the CLI can talk to a live upstream.
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

    // Step 1 — live search returns at least one position.
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

    // Step 2 — detail for the sampled post returns ok + a non-empty title.
    if (postId) {
      await run("fetch detail", async () => {
        const r = (await xpengAdapter.fetchPositionDetail(postId!)) as { ok?: boolean; title?: string; message?: string };
        if (r.ok !== true) throw new Error(r.message ?? "detail fetch failed");
        if (!String(r.title ?? "").trim()) throw new Error("detail returned an empty title");
        return r;
      });
    } else {
      checks.push({ name: "fetch detail", ok: false, detail: "skipped — no post_id from search", ms: 0 });
    }

    // Step 3 — match an inline sample resume (no file / profile involved).
    const SAMPLE_RESUME =
      "Software engineer with 3 years of experience building autonomous-driving " +
      "perception and planning systems in C++ and Python. Deployed deep-learning " +
      "models (PyTorch, TensorRT) to embedded GPUs; built data pipelines with Kafka " +
      "and Spark; comfortable with Linux, Docker, Kubernetes, and CI/CD.";
    await run("match resume", async () => {
      const r = (await xpengAdapter.matchResume(SAMPLE_RESUME, { topN: 3 })) as { ok?: boolean; message?: string };
      if (r.ok !== true) throw new Error(r.message ?? "matchResume returned ok:false");
      return r;
    });

    const fails = checks.filter((c) => !c.ok).length;
    if (compact) {
      console.log(JSON.stringify({ ok: fails === 0, checks }));
    } else {
      console.log(`\njob-pro selftest — using xpeng (Greenhouse board)\n`);
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
  if (cmd === "find") {
    const compact = args.includes("--compact");
    const textMode = args.includes("--text");
    const keyword = args[1];
    if (!keyword || keyword.startsWith("--")) {
      die(`usage: job-pro find <keyword> [--limit N] [--companies a,b,c] [--timeout ms] [--scope social|campus|intern|all] [--compact | --text]`);
    }
    const { args: aLimit, value: limitStr } = popFlagValue(args, "--limit");
    const { args: aCompanies, value: companiesStr } = popFlagValue(aLimit, "--companies");
    const { args: aTimeout, value: timeoutStr } = popFlagValue(aCompanies, "--timeout");
    const { args: aScope, value: scopeStr } = popFlagValue(aTimeout, "--scope");
    void aScope;
    const limit = limitStr ? Math.max(1, parseInt(limitStr, 10)) : 3;
    const timeout = timeoutStr ? Math.max(1000, parseInt(timeoutStr, 10)) : 8000;
    // 1.1.0 — `--scope` on `find` is a SOFT filter (§1.5): companies whose
    // `supportedScopes` includes the requested scope are searched with the
    // scope passed through; companies that don't support it are silently
    // skipped from the result body (NOT counted in `failed`). The JSON
    // output gains `scope_used` + `companies_skipped_by_scope[]` so callers
    // can see what got dropped.
    const requestedScope = validateScope(scopeStr);
    const companyScope: string[] = companiesStr
      ? companiesStr.split(",").map((s) => s.trim()).filter(Boolean)
      : Object.keys(ADAPTERS);
    const unknown = companyScope.filter((c) => !(c in ADAPTERS));
    if (unknown.length > 0) die(`unknown company in --companies: ${unknown.join(", ")}`);

    // Partition by supportedScopes when `--scope` was given.
    const scopeSkipped: string[] = [];
    const eligible: string[] = [];
    for (const c of companyScope) {
      if (requestedScope === undefined) {
        eligible.push(c);
        continue;
      }
      const adapter = (ADAPTERS as Record<string, CompanyAdapter>)[c];
      const supported =
        (adapter.supportedScopes as readonly string[] | undefined) ??
        (POSITION_SCOPES as readonly string[]);
      if (supported.includes(requestedScope)) eligible.push(c);
      else scopeSkipped.push(c);
    }

    const startedAt = Date.now();
    const settled = await Promise.all(
      eligible.map(async (company) => {
        const adapter = (ADAPTERS as Record<string, CompanyAdapter>)[company];
        const t0 = Date.now();
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          const timeoutP = new Promise<{ timedOut: true }>((resolve) => {
            timer = setTimeout(() => resolve({ timedOut: true }), timeout);
          });
          const searchP = adapter
            .searchPositions({ keyword, pageSize: limit, scope: requestedScope })
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
          return { company, ok: true, count: positions.length, positions, elapsed_ms: elapsed };
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
    const withHits = settled.filter((r) => r.count > 0);
    const total = withHits.reduce((s, r) => s + r.count, 0);
    const failed = settled.filter((r) => !r.ok).map((r) => ({ company: r.company, message: r.message }));
    if (textMode) {
      const filterNote = requestedScope !== undefined ? ` [scope=${requestedScope}]` : "";
      const scopeNote =
        requestedScope !== undefined && scopeSkipped.length > 0
          ? ` (scope-filtered: ${scopeSkipped.length} skipped)`
          : "";
      console.log(`\nfind "${keyword}" — ${total} hit(s) across ${withHits.length}/${eligible.length} companies (${totalMs}ms)${filterNote}${scopeNote}\n`);
      for (const r of withHits) {
        console.log(`${r.company} (${r.count})`);
        for (const p of r.positions as Array<{ post_id?: string; title?: string; work_cities?: string; apply_url?: string }>) {
          const title = (p.title ?? "").trim().replace(/\s+/g, " ");
          const loc = (p.work_cities ?? "").trim();
          console.log(`  ${p.post_id ?? "?"}  ${title}${loc ? ` — ${loc}` : ""}`);
          if (p.apply_url) console.log(`    ${p.apply_url}`);
        }
        console.log("");
      }
      if (failed.length > 0) {
        console.log(`Failed (${failed.length}):`);
        for (const f of failed) console.log(`  ${f.company}: ${f.message}`);
      }
      // §1.5: when --text + --scope is set, print a footer listing the
      // companies that were silently skipped because their `supportedScopes`
      // declaration excluded the requested scope.
      if (requestedScope !== undefined && scopeSkipped.length > 0) {
        console.log(
          `Skipped by --scope ${requestedScope} (${scopeSkipped.length}): ${scopeSkipped.join(" ")}`
        );
      }
      return;
    }
    emit(
      {
        ok: true,
        keyword,
        total,
        company_count: withHits.length,
        scanned_companies: eligible.length,
        scope_used: requestedScope,
        companies_skipped_by_scope: scopeSkipped,
        elapsed_ms: totalMs,
        results: withHits,
        failed,
      },
      compact
    );
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
