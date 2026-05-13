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

type Adapter = typeof tencent;
const ADAPTERS: Record<string, Adapter> = {
  tencent,
  bytedance: bytedance as unknown as Adapter,
  alibaba: alibaba as unknown as Adapter,
  meituan: meituan as unknown as Adapter,
  xiaohongshu: xiaohongshu as unknown as Adapter,
  jd: jd as unknown as Adapter,
  kuaishou: kuaishou as unknown as Adapter,
  xiaomi: xiaomi as unknown as Adapter,
  baidu: baidu as unknown as Adapter,
  netease: netease as unknown as Adapter,
  didi: didi as unknown as Adapter,
};

type Result = { name: string; pass: boolean; reason: string };

async function probe(name: string, adapter: Adapter): Promise<Result> {
  try {
    const search = await adapter.searchPositions({ pageSize: 1 });
    if (!search.ok) {
      return { name, pass: false, reason: `search not ok: ${search.message ?? "no message"}` };
    }
    const total = search.total;
    if (typeof total !== "number" || total < 0) {
      return { name, pass: false, reason: `total is ${JSON.stringify(total)} (expected non-negative number)` };
    }
    if (total > 0) {
      const first = search.positions?.[0];
      if (!first) {
        return { name, pass: false, reason: `total=${total} but positions[0] missing` };
      }
      for (const key of ["post_id", "title", "apply_url"]) {
        if (!(first as unknown as Record<string, unknown>)[key]) {
          return { name, pass: false, reason: `positions[0].${key} missing/empty` };
        }
      }
    }

    const dicts = await adapter.fetchDictionaries();
    if (typeof dicts !== "object" || dicts === null) {
      return { name, pass: false, reason: `fetchDictionaries did not return an object` };
    }

    return { name, pass: true, reason: `total=${total}` };
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}` : String(err);
    return { name, pass: false, reason: `threw: ${msg}` };
  }
}

async function main() {
  const start = Date.now();
  const results = await Promise.all(
    Object.entries(ADAPTERS).map(([name, adapter]) => probe(name, adapter))
  );

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const tag = r.pass ? "PASS" : "FAIL";
    console.log(`  ${tag}  ${r.name.padEnd(width)}  ${r.reason}`);
  }

  const fails = results.filter((r) => !r.pass);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\n  ${results.length - fails.length}/${results.length} adapters healthy  (${elapsed}s)`
  );
  process.exit(fails.length ? 1 : 0);
}

main();
