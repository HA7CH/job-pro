"use client";

import { useEffect, useState } from "react";
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
    autoApply: "live",
  },
  {
    name: "ByteDance",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/bytedance.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Alibaba",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/alibaba.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Meituan",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/meituan.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Xiaohongshu",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/xiaohongshu.ts",
    listings: "live",
    autoApply: "live",
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
    autoApply: "live",
  },
  {
    name: "Kuaishou",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/kuaishou.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Xiaomi",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/xiaomi.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Baidu",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/baidu.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "NetEase",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/netease.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Didi",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/didi.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Bilibili",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/bilibili.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "PDD",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/pdd.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "NIO",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/nio.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "MiniMax",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/minimax.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Huawei",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/huawei.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Weibo",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/weibo.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "miHoYo",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/mihoyo.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Ping An",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/pingan.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "SenseTime",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/sensetime.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Trip.com",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/trip.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Unitree",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/unitree.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "BYD",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/byd.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Ant Group",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/antgroup.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Li Auto",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/liauto.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Moonshot",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/moonshot.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Zhipu",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/zhipu.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "iQIYI",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/iqiyi.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Hikvision",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/hikvision.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Megvii",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/megvii.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Lilith Games",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/lilith.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Agibot",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/agibot.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "DeepSeek",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/deepseek.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "01.AI",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/zerooneai.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Galaxy Universal",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/galaxyuniversal.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "StepFun",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/stepfun.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "CICC",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/cicc.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Baichuan",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/baichuan.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "XPeng",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/xpeng.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "WeRide",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/weride.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "HoYoverse",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/hoyoverse.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "iFlytek",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/iflytek.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "OPPO",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/oppo.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "vivo",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/vivo.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "SF Express",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/sf.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Cainiao",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/cainiao.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Geely",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/geely.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "WeBank",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/webank.ts",
    listings: "live",
    autoApply: "building",
  },
  {
    name: "Horizon Robotics",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/horizonrobotics.ts",
    listings: "live",
    autoApply: "live",
  },
  {
    name: "Cambricon",
    href: "https://github.com/HA7CH/job-pro/blob/main/cli/src/cambricon.ts",
    listings: "live",
    autoApply: "live",
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
  const [wechatOpen, setWechatOpen] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — older browsers
    }
  }

  useEffect(() => {
    if (!wechatOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setWechatOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wechatOpen]);

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

      <p className="companion">
        <span className="companion-text">
          Pairs with{" "}
          <a href="https://cv.ha7ch.com" target="_blank" rel="noopener noreferrer">
            cv.ha7ch.com
          </a>
          {" "}— draft the resume you paste above.
        </span>
        <button
          type="button"
          onClick={() => setWechatOpen(true)}
          aria-label="WeChat group (bug reports & chat)"
          className="companion-wechat"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213c0 .163.13.295.29.295a.32.32 0 0 0 .166-.054l1.903-1.114a.864.864 0 0 1 .717-.098a10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.81-.05c-.857-2.578.157-4.972 1.932-6.446c1.703-1.415 3.882-1.98 5.853-1.838c-.576-3.583-4.196-6.348-8.594-6.348M5.785 5.991c.642 0 1.162.529 1.162 1.18c0 .65-.52 1.178-1.162 1.178s-1.162-.528-1.162-1.179c0-.65.52-1.179 1.162-1.179m5.813 0c.642 0 1.162.529 1.162 1.18c0 .65-.52 1.178-1.162 1.178s-1.162-.528-1.162-1.179c0-.65.52-1.179 1.162-1.179m5.34 2.867c-1.797-.052-3.746.512-5.28 1.786c-1.72 1.428-2.687 3.72-1.78 6.22c.942 2.453 3.666 4.229 6.884 4.229c.826 0 1.622-.12 2.361-.336a.72.72 0 0 1 .598.082l1.584.926a.27.27 0 0 0 .14.047c.134 0 .24-.111.24-.247c0-.06-.023-.12-.038-.177c-.004-.005-.156-.586-.32-1.214a.5.5 0 0 1-.023-.156a.5.5 0 0 1 .192-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983a.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982m5.107 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983a.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982" />
          </svg>
        </button>
      </p>

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

      <section className="phase2-card" aria-labelledby="phase2-title">
        <h2 id="phase2-title" className="phase2-title">Phase 2 — submit, not just search</h2>
        <p className="phase2-lede">
          50 / 50 companies expose an application schema. <strong>45 / 50 have
          end-to-end-verified apply endpoints</strong> (3 Greenhouse/Lever
          fire anonymously; 42 need a captured browser session). 5 are
          intentionally external — Liepin recruiter chat / WeChat mini-program,
          structurally non-API.
        </p>
        <pre className="phase2-snippet">{`# one-time setup
job-pro profile init --interactive      # prompts 5 essential fields
job-pro profile lint                    # validate format (email/phone/resume)

# scan the whole market
job-pro find "intern" --apply-ready --text   # only show buckets you can fire today

# inspect + stage a job
job-pro xpeng apply <id> --schema                  # peek at the form
job-pro xpeng apply <id> --interactive --remember  # fill in terminal; persist answers

# actually submit (4-layer safety gate: env attest + staged.ready
# + endpoint_verified + session.json <30d)
JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes \\
  job-pro xpeng apply <id> --really-submit`}</pre>
        <p className="phase2-detail">
          For non-Greenhouse adapters (Feishu / Moka / Beisen / bespoke),
          run <code>job-pro extension</code> for the bundled MV3 add-on
          path + a 6-step Chrome install walkthrough, then drop{" "}
          <code>~/Downloads/jobpro/&lt;adapter&gt;.session.json</code>{" "}
          under <code>~/.jobpro/</code>.
          See{" "}
          <a href="https://github.com/HA7CH/job-pro/blob/main/docs/auto-apply.md" target="_blank" rel="noopener noreferrer">
            docs/auto-apply.md
          </a>{" "}
          for the 50-row submission-flow matrix.
        </p>
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

      {wechatOpen && (
        <div
          className="wechat-overlay"
          onClick={() => setWechatOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="WeChat group QR code"
        >
          <div
            className="wechat-card"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="wechat-title">Job Pro 交流群 · bug 反馈</p>
            <img
              src="/wechat-group.jpg"
              alt="WeChat group QR code for Job Pro"
              className="wechat-qr"
            />
            <p className="wechat-hint">
              微信扫码加群。二维码过期后{" "}
              <a
                href="https://github.com/HA7CH/job-pro/issues/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                开个 issue
              </a>{" "}
              提醒更新。
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
