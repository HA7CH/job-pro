#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as tencent from "./tencent.js";
import * as bytedance from "./bytedance.js";
import * as alibaba from "./alibaba.js";
import * as meituan from "./meituan.js";
import * as xiaohongshu from "./xiaohongshu.js";
import {
  memoryList,
  memoryGet,
  memorySet,
  memoryEvent,
  memoryClear,
} from "./memory.js";

const VERSION = "0.2.0";

const HELP = `
job-pro — query Chinese big-tech campus recruiting from your terminal
            (job.ha7ch.com)

USAGE
  job-pro <company> <verb> [options]
  job-pro --version
  job-pro help

COMPANIES
  tencent          join.qq.com                 (Tencent / 腾讯)
  bytedance        jobs.bytedance.com          (ByteDance / 字节跳动)
  alibaba          campus-talent.alibaba.com   (Alibaba / 阿里巴巴)
  meituan          zhaopin.meituan.com         (Meituan / 美团)
  xiaohongshu      job.xiaohongshu.com         (Xiaohongshu / 小红书)

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
// `import * as <name>` and a line in `ADAPTERS`.
type CompanyAdapter = typeof tencent;
const ADAPTERS: Record<string, CompanyAdapter> = {
  tencent,
  bytedance: bytedance as unknown as CompanyAdapter,
  alibaba: alibaba as unknown as CompanyAdapter,
  meituan: meituan as unknown as CompanyAdapter,
  xiaohongshu: xiaohongshu as unknown as CompanyAdapter,
};

async function runCompany(
  adapter: CompanyAdapter,
  company: string,
  rawArgs: string[]
): Promise<void> {
  const [verb, ...rest] = rawArgs;
  if (!verb) die(`expected a verb. Try \`job-pro help\`.`);

  const { args, compact } = popCompactFlag(rest);

  if (verb === "search") {
    const { args: a, value: page } = popFlagValue(args, "--page");
    const { args: a2, value: pageSize } = popFlagValue(a, "--page-size");
    const keyword = a2.join(" ").trim();
    return emit(
      await adapter.searchPositions({
        keyword,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
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
    const { args: a, value: maxPages } = popFlagValue(args, "--max-pages");
    const { args: a2, value: pageSize } = popFlagValue(a, "--page-size");
    const keyword = a2.join(" ").trim();
    return emit(
      await adapter.fetchAllPositions({
        keyword,
        maxPages: maxPages ? Number(maxPages) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
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

  const adapter = ADAPTERS[cmd];
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
