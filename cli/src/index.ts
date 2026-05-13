#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  fetchDictionaries,
  searchPositions,
  fetchPositionDetail,
  fetchAllPositions,
  listNotices,
  getNotice,
  findNoticesByQuestion,
  matchResume,
  checkResume,
} from "./tencent.js";
import {
  memoryList,
  memoryGet,
  memorySet,
  memoryEvent,
  memoryClear,
} from "./memory.js";

const VERSION = "0.1.0";

const HELP = `
job-pro — query Chinese big-tech campus recruiting from your terminal
            (job.ha7ch.com)

USAGE
  job-pro <company> <verb> [options]
  job-pro --version
  job-pro help

COMPANIES (v0.1)
  tencent          join.qq.com  (Tencent / 腾讯)

VERBS (for tencent)
  search <kw>                       search openings (kw is free text, <=30 chars)
  detail <post_id>                  show full JD for one job
  all [<kw>]                        paginate every job (filter by kw if given)
  dicts                             dump filter dictionaries (BG, city, family…)
  notices                           list official announcements
  notice <id>                       show one announcement's full content
  flow <question>                   answer a question using best-matching notices
  match <resume-text-or-->          rank jobs by overlap with resume text
                                    pass "-" to read resume from stdin
  resume-check <resume-text-or-->   structural sanity check on a resume
  memory list | get <k> | set k=v | event <kind> [payload] | clear

OUTPUT
  Add --compact for one-line JSON (good for piping to jq / claude).

EXAMPLES
  job-pro tencent search "后台开发" --page-size 5
  job-pro tencent detail 1200791473415778304
  job-pro tencent notices
  job-pro tencent flow "腾讯2026实习什么时候开始投递" --question-time 2026-05-13
  cat my-resume.md | job-pro tencent match -
  job-pro tencent memory set "stack=Go,Python" "target_city=深圳"
  job-pro tencent memory event applied "腾讯后台 1200791473415778304"

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

function emit(result: unknown, compact: boolean): never {
  const text = compact
    ? JSON.stringify(result)
    : JSON.stringify(result, null, 2);
  console.log(text);
  const ok =
    typeof result === "object" && result !== null && "ok" in (result as Record<string, unknown>)
      ? Boolean((result as Record<string, unknown>).ok)
      : true;
  process.exit(ok ? 0 : 1);
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

async function runTencent(rawArgs: string[]): Promise<void> {
  const [verb, ...rest] = rawArgs;
  if (!verb) die("expected a verb. Try `job-pro help`.");

  const { args, compact } = popCompactFlag(rest);

  if (verb === "search") {
    let { args: a, value: page } = popFlagValue(args, "--page");
    let { args: a2, value: pageSize } = popFlagValue(a, "--page-size");
    const keyword = a2.join(" ").trim();
    return emit(
      await searchPositions({
        keyword,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
      compact
    );
  }

  if (verb === "detail") {
    const postId = args[0];
    if (!postId) die("usage: job-pro tencent detail <post_id>");
    return emit(await fetchPositionDetail(postId), compact);
  }

  if (verb === "all") {
    let { args: a, value: maxPages } = popFlagValue(args, "--max-pages");
    let { args: a2, value: pageSize } = popFlagValue(a, "--page-size");
    const keyword = a2.join(" ").trim();
    return emit(
      await fetchAllPositions({
        keyword,
        maxPages: maxPages ? Number(maxPages) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
      compact
    );
  }

  if (verb === "dicts") {
    return emit(await fetchDictionaries(), compact);
  }

  if (verb === "notices") {
    return emit(await listNotices(), compact);
  }

  if (verb === "notice") {
    const id = args[0];
    if (!id) die("usage: job-pro tencent notice <id>");
    return emit(await getNotice(id), compact);
  }

  if (verb === "flow") {
    const { args: a, value: questionTime } = popFlagValue(args, "--question-time");
    const { args: a2, value: topK } = popFlagValue(a, "--top-k");
    const question = a2.join(" ").trim();
    if (!question) die("usage: job-pro tencent flow <question> [--question-time YYYY-MM-DD] [--top-k N]");
    return emit(
      await findNoticesByQuestion(question, {
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
      await matchResume(text, {
        topN: topN ? Number(topN) : undefined,
        candidates: candidates ? Number(candidates) : undefined,
      }),
      compact
    );
  }

  if (verb === "resume-check") {
    const text = readResumeArg(args[0]);
    return emit(checkResume(text), compact);
  }

  if (verb === "memory") {
    const [sub, ...subArgs] = args;
    if (!sub) die("usage: job-pro tencent memory <list|get|set|event|clear>");
    if (sub === "list") return emit(memoryList(), compact);
    if (sub === "get") {
      const key = subArgs[0];
      if (!key) die("usage: job-pro tencent memory get <key>");
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

  if (cmd === "tencent") {
    await runTencent(args.slice(1));
    return;
  }

  die(`unknown company: ${cmd}. Supported in v0.1: tencent. Try \`job-pro help\`.`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
