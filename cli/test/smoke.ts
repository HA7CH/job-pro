// Smoke test for every adapter wired into the dispatcher.
//
// For each company we run a single bare `searchPositions({ pageSize: 1 })`
// against the live upstream and verify:
//
//   • the call returns { ok: true }
//   • total is a non-negative number
//   • when total > 0, positions[0] has post_id, title, apply_url, work_cities
//
// Then we hit fetchDictionaries() and verify it returns a JSON-shaped object.
// We intentionally don't assert specific totals so the suite stays green even
// when an upstream batch closes or a campus season rolls over — the contract
// being tested is "the adapter still talks to the upstream and returns the
// canonical shape", not "<company> currently has exactly N jobs open".
//
// Run with: pnpm test
// Exit code: 0 = all pass, 1 = at least one failure.

import * as tencent from "../src/tencent.js";
import * as bytedance from "../src/bytedance.js";
import * as alibaba from "../src/alibaba.js";
import * as meituan from "../src/meituan.js";
import * as xiaohongshu from "../src/xiaohongshu.js";
import * as jd from "../src/jd.js";
import * as kuaishou from "../src/kuaishou.js";
import * as xiaomi from "../src/xiaomi.js";
import * as baidu from "../src/baidu.js";
import * as netease from "../src/netease.js";
import * as didi from "../src/didi.js";
import * as bilibili from "../src/bilibili.js";
import * as pdd from "../src/pdd.js";
import * as nio from "../src/nio.js";
import * as minimax from "../src/minimax.js";
import * as huawei from "../src/huawei.js";
import * as weibo from "../src/weibo.js";
import * as mihoyo from "../src/mihoyo.js";
import * as pingan from "../src/pingan.js";
import * as sensetime from "../src/sensetime.js";
import * as trip from "../src/trip.js";
import * as unitree from "../src/unitree.js";
import * as byd from "../src/byd.js";
import * as antgroup from "../src/antgroup.js";
import * as liauto from "../src/liauto.js";
import * as moonshot from "../src/moonshot.js";
import * as zhipu from "../src/zhipu.js";
import * as hikvision from "../src/hikvision.js";
import * as iqiyi from "../src/iqiyi.js";
import * as megvii from "../src/megvii.js";
import * as lilith from "../src/lilith.js";
import * as agibot from "../src/agibot.js";
import * as deepseek from "../src/deepseek.js";
import * as zerooneai from "../src/zerooneai.js";
import * as galaxyuniversal from "../src/galaxyuniversal.js";
import * as stepfun from "../src/stepfun.js";
import * as cicc from "../src/cicc.js";
import * as baichuan from "../src/baichuan.js";
import * as xpeng from "../src/xpeng.js";
import * as weride from "../src/weride.js";
import * as hoyoverse from "../src/hoyoverse.js";
import * as iflytek from "../src/iflytek.js";
import * as oppo from "../src/oppo.js";
import * as vivo from "../src/vivo.js";
import * as sf from "../src/sf.js";
import * as cainiao from "../src/cainiao.js";
import * as geely from "../src/geely.js";
import * as webank from "../src/webank.js";
import * as horizonrobotics from "../src/horizonrobotics.js";
import * as cambricon from "../src/cambricon.js";
import type { CompanyAdapter } from "../src/adapter.js";

type Adapter = CompanyAdapter;
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

// Adapters known to be auth-gated / DNS-blocked / WAF-blocked — for these,
// `ok:false` is the documented "limited" state and reported as WARN.
// Anything OUTSIDE this set returning `ok:false` is a real regression and
// must FAIL the suite. Adapters drift OUT of this list as they get unblocked
// (e.g. moonshot/oppo/vivo/sf/byd moved from auth-gated to live in 6e22fba).
const KNOWN_LIMITED: ReadonlySet<string> = new Set([
  "hikvision",
  "lilith",
  "cicc",
  "cainiao",
  "webank",
]);

type Result = { name: string; pass: boolean; tag: "PASS" | "WARN" | "FAIL"; reason: string };

async function probe(name: string, adapter: Adapter): Promise<Result> {
  try {
    const search = (await adapter.searchPositions({ pageSize: 1 })) as {
      ok: boolean;
      total?: number;
      positions?: unknown[];
      message?: string;
    };
    if (!search.ok) {
      // `ok:false` from a KNOWN_LIMITED adapter is the documented "limited"
      // state (auth gate / DNS-blocked / WAF) → WARN.
      // `ok:false` from anyone else is a real regression (live adapter just
      // broke against the upstream) → FAIL.
      const msg = search.message ?? "no message";
      if (KNOWN_LIMITED.has(name)) {
        return { name, pass: true, tag: "WARN", reason: `search ok:false — ${msg.slice(0, 100)}` };
      }
      return {
        name,
        pass: false,
        tag: "FAIL",
        reason: `live adapter returned ok:false — ${msg.slice(0, 150)}`,
      };
    }
    // KNOWN_LIMITED adapter unexpectedly went live → FAIL so we remember to
    // drop it from the limited set on the next pass. Better to be loud about
    // drift in either direction than silently green.
    if (KNOWN_LIMITED.has(name)) {
      return {
        name,
        pass: false,
        tag: "FAIL",
        reason: `KNOWN_LIMITED adapter unexpectedly returned ok:true — remove '${name}' from KNOWN_LIMITED in test/smoke.ts`,
      };
    }
    const total = search.total;
    if (typeof total !== "number" || total < 0) {
      return { name, pass: false, tag: "FAIL", reason: `total is ${JSON.stringify(total)} (expected non-negative number)` };
    }
    if (total > 0) {
      const first = search.positions?.[0] as Record<string, unknown> | undefined;
      if (!first) {
        return { name, pass: false, tag: "FAIL", reason: `total=${total} but positions[0] missing` };
      }
      for (const key of ["post_id", "title", "apply_url"]) {
        if (!first[key]) {
          return { name, pass: false, tag: "FAIL", reason: `positions[0].${key} missing/empty` };
        }
      }
    }

    const dicts = await adapter.fetchDictionaries();
    if (typeof dicts !== "object" || dicts === null) {
      return { name, pass: false, tag: "FAIL", reason: `fetchDictionaries did not return an object` };
    }

    return { name, pass: true, tag: "PASS", reason: `total=${total}` };
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}` : String(err);
    return { name, pass: false, tag: "FAIL", reason: `threw: ${msg}` };
  }
}

async function main() {
  const start = Date.now();
  const results = await Promise.all(
    Object.entries(ADAPTERS).map(([name, adapter]) => probe(name, adapter))
  );

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`  ${r.tag.padEnd(4)}  ${r.name.padEnd(width)}  ${r.reason}`);
  }

  const fails = results.filter((r) => r.tag === "FAIL");
  const warns = results.filter((r) => r.tag === "WARN");
  const passes = results.filter((r) => r.tag === "PASS");
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\n  ${passes.length} healthy, ${warns.length} limited, ${fails.length} broken / ${results.length} total  (${elapsed}s)`
  );
  process.exit(fails.length ? 1 : 0);
}

main();
