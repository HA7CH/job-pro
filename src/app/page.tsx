"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Status = "live" | "building" | "none";

type Company = {
  name: string;
  href: string;
  listings: Status;
  autoApply: Status;
};

const COMPANIES: Company[] = [
  {
    name: "Tencent",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/tencent.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "ByteDance",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/bytedance.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Alibaba",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/alibaba.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Meituan",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/meituan.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Xiaohongshu",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/xiaohongshu.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Google",
    href: "https://github.com/HA7CH/job-pro/issues/new?title=Add+Google+adapter",
    listings: "building",
    autoApply: "building",
  },
  {
    name: "JD",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/jd.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Kuaishou",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/kuaishou.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Xiaomi",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/xiaomi.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Baidu",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/baidu.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "NetEase",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/netease.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Didi",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/didi.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Bilibili",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/bilibili.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "PDD",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/pdd.ts",
    listings: "building",
    autoApply: "building",
  },
  {
    name: "NIO",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/nio.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "MiniMax",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/minimax.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Huawei",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/huawei.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Weibo",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/weibo.ts",
    listings: "building",
    autoApply: "building",
  },
  {
    name: "miHoYo",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/mihoyo.ts",
    listings: "building",
    autoApply: "building",
  },
  {
    name: "Ping An",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/pingan.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Meta",
    href: "https://github.com/HA7CH/job-pro/issues/new?title=Add+Meta+adapter",
    listings: "building",
    autoApply: "building",
  },
  {
    name: "Apple",
    href: "https://github.com/HA7CH/job-pro/issues/new?title=Add+Apple+adapter",
    listings: "building",
    autoApply: "building",
  },
];

const PROMPT = `Run \`npx job-pro@latest help\` to discover the CLI, then use it to find
Chinese big-tech campus jobs that fit my background.

My resume: <paste path or text>

Match roles to my resume, draft tailored bullets, and prep me for interviews.
Always reply to me in Chinese.`;

/**
 * Material Symbols Rounded (filled). Path data sourced from
 * `api.iconify.design/material-symbols:<name>.svg` — inlined to skip the
 * network hop at runtime.
 */
function StatusIcon({ kind }: { kind: Status }) {
  if (kind === "live") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="status-icon"
        aria-hidden
        focusable="false"
      >
        <path
          fill="currentColor"
          d="m10.6 13.8l-2.15-2.15q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7L9.9 15.9q.3.3.7.3t.7-.3l5.65-5.65q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"
        />
      </svg>
    );
  }
  if (kind === "building") {
    return (
      <span className="status-emoji" role="img" aria-label="Building">
        🚧
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className="status-icon"
      aria-hidden
      focusable="false"
    >
      <path
        fill="currentColor"
        d="m12 13.4l2.9 2.9q.275.275.7.275t.7-.275t.275-.7t-.275-.7L13.4 12l2.9-2.9q.275-.275.275-.7t-.275-.7t-.7-.275t-.7.275L12 10.6L9.1 7.7q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7l2.9 2.9l-2.9 2.9q-.275.275-.275.7t.275.7t.7.275t.7-.275zm0 8.6q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"
      />
    </svg>
  );
}

function statusClass(kind: Status): string {
  return `status-cell status-${kind}`;
}

export default function Home() {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — older browsers
    }
  }

  return (
    <main className="page">
      <h1 className="font-serif text-4xl md:text-5xl tracking-tight leading-[1.1]">
        Apply jobs w/ <span className="whitespace-nowrap">your Claude Code</span>
      </h1>
      <p className="lede">
        <span className="lede-prefix">$</span> npx job-pro help
      </p>

      <section className="prompt-card" aria-labelledby="prompt-title">
        <div className="prompt-head">
          <span id="prompt-title" className="prompt-head-label">
            Copy into Claude Code, Codex, or Cursor
          </span>
          <button
            type="button"
            className="prompt-copy"
            onClick={copyPrompt}
            aria-label={copied ? "Copied" : "Copy prompt"}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <pre className="prompt-body">{PROMPT}</pre>
      </section>

      <section className="company-table" aria-labelledby="table-title">
        <h2 id="table-title" className="sr-only">Roadmap</h2>
        <div className="company-row company-row--header" aria-hidden>
          <span className="col-label">Company</span>
          <span className="col-label">Info</span>
          <span className="col-label">Auto-apply</span>
        </div>
        {COMPANIES.map((c) => (
          <a
            key={c.name}
            className="company-row"
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="company-name">{c.name}</span>
            <span className={statusClass(c.listings)} aria-label={`Info: ${c.listings}`}>
              <StatusIcon kind={c.listings} />
            </span>
            <span className={statusClass(c.autoApply)} aria-label={`Auto-apply: ${c.autoApply}`}>
              <StatusIcon kind={c.autoApply} />
            </span>
          </a>
        ))}
      </section>

      <p className="link-row">
        <a
          href="https://github.com/HA7CH/job-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="link-icon"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        </a>
        <a
          href="https://www.npmjs.com/package/job-pro"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="npm"
          className="link-icon"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C23.99.786 23.204 0 22.227 0H1.763zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113V5.323z" />
          </svg>
        </a>
        <span aria-hidden> · </span>
        <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer">
          cv.ha7ch.com
        </a>
        <a
          href="https://ha7ch.com"
          target="_blank"
          rel="noopener noreferrer"
          className="link-right"
        >
          ha7ch.com
        </a>
      </p>
    </main>
  );
}
