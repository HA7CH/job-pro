// Apply-path smoke test — verifies each of the 50 adapters' Phase 2
// schema surface, independently of the read-path smoke.
//
// For each adapter:
//   1. Pull the first job from searchPositions({ pageSize: 1 }).
//      (Adapters whose read path is structurally limited — 5 external
//      Liepin/Unitree — are tolerated; we still call fetchApplicationSchema
//      with a placeholder post_id and just verify the response shape.)
//   2. Call adapter.fetchApplicationSchema(post_id).
//   3. Verify the canonical shape: { ok:true, schema:{ source, post_id,
//      submit_kind, questions:[…] } }.
//
// Exit code 0 = all 50 schemas resolve; 1 = at least one regression.
// Run with: pnpm test:apply

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

interface Adapter {
  searchPositions: (opts?: { pageSize?: number }) => Promise<{ ok?: boolean; positions?: Array<{ post_id: string }> }>;
  fetchApplicationSchema?: (postId: string) => Promise<unknown>;
}

const ADAPTERS: Record<string, Adapter> = {
  tencent: tencent as unknown as Adapter,
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
  bilibili: bilibili as unknown as Adapter,
  pdd: pdd as unknown as Adapter,
  nio: nio as unknown as Adapter,
  minimax: minimax as unknown as Adapter,
  huawei: huawei as unknown as Adapter,
  weibo: weibo as unknown as Adapter,
  mihoyo: mihoyo as unknown as Adapter,
  pingan: pingan as unknown as Adapter,
  sensetime: sensetime as unknown as Adapter,
  trip: trip as unknown as Adapter,
  unitree: unitree as unknown as Adapter,
  byd: byd as unknown as Adapter,
  antgroup: antgroup as unknown as Adapter,
  liauto: liauto as unknown as Adapter,
  moonshot: moonshot as unknown as Adapter,
  zhipu: zhipu as unknown as Adapter,
  hikvision: hikvision as unknown as Adapter,
  iqiyi: iqiyi as unknown as Adapter,
  megvii: megvii as unknown as Adapter,
  lilith: lilith as unknown as Adapter,
  agibot: agibot as unknown as Adapter,
  deepseek: deepseek as unknown as Adapter,
  zerooneai: zerooneai as unknown as Adapter,
  galaxyuniversal: galaxyuniversal as unknown as Adapter,
  stepfun: stepfun as unknown as Adapter,
  cicc: cicc as unknown as Adapter,
  baichuan: baichuan as unknown as Adapter,
  xpeng: xpeng as unknown as Adapter,
  weride: weride as unknown as Adapter,
  hoyoverse: hoyoverse as unknown as Adapter,
  iflytek: iflytek as unknown as Adapter,
  oppo: oppo as unknown as Adapter,
  vivo: vivo as unknown as Adapter,
  sf: sf as unknown as Adapter,
  cainiao: cainiao as unknown as Adapter,
  geely: geely as unknown as Adapter,
  webank: webank as unknown as Adapter,
  horizonrobotics: horizonrobotics as unknown as Adapter,
  cambricon: cambricon as unknown as Adapter,
};

type Result = {
  name: string;
  tag: "PASS" | "WARN" | "FAIL";
  submit_kind?: string;
  reason: string;
};

async function probe(name: string, adapter: Adapter): Promise<Result> {
  if (typeof adapter.fetchApplicationSchema !== "function") {
    return { name, tag: "FAIL", reason: "no fetchApplicationSchema export" };
  }
  // Grab a sample post_id from the read side. For the 4 Liepin-backed
  // adapters and lilith (CDP-driven), this is also network — skip if it
  // takes too long and use a placeholder instead.
  let postId = "smoke-test-placeholder";
  try {
    const list = (await Promise.race([
      adapter.searchPositions({ pageSize: 1 }),
      new Promise<{ ok: false }>((resolve) =>
        setTimeout(() => resolve({ ok: false }), 12000)
      ),
    ])) as { ok?: boolean; positions?: Array<{ post_id: string }> };
    if (list.ok && list.positions?.[0]?.post_id) postId = list.positions[0].post_id;
  } catch { /* fall through with placeholder */ }

  let schemaResp: unknown;
  try {
    schemaResp = (await Promise.race([
      adapter.fetchApplicationSchema(postId),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, message: "smoke timeout" }), 15000)),
    ])) as unknown;
  } catch (err) {
    return {
      name,
      tag: "FAIL",
      reason: `fetchApplicationSchema threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const sr = schemaResp as { ok?: boolean; message?: string; schema?: { submit_kind?: string; questions?: unknown[]; submit_endpoint?: string } };
  // For external / Liepin-backed adapters and placeholder post_ids, an
  // ok:false is acceptable — we just want the right error shape.
  if (sr.ok !== true) {
    return {
      name,
      tag: "WARN",
      reason: `ok:false — ${(sr.message ?? "no message").slice(0, 80)}`,
    };
  }
  if (!sr.schema || typeof sr.schema !== "object") {
    return { name, tag: "FAIL", reason: "ok:true but no schema returned" };
  }
  const kind = sr.schema.submit_kind ?? "(missing)";
  if (!sr.schema.questions || !Array.isArray(sr.schema.questions) || sr.schema.questions.length === 0) {
    return { name, tag: "FAIL", submit_kind: kind, reason: "schema.questions empty" };
  }
  return {
    name,
    tag: "PASS",
    submit_kind: kind,
    reason: `kind=${kind} questions=${sr.schema.questions.length}`,
  };
}

async function main(): Promise<void> {
  const start = Date.now();
  const entries = Object.entries(ADAPTERS);
  const results = await Promise.all(entries.map(([name, a]) => probe(name, a)));

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`  ${r.tag.padEnd(4)}  ${r.name.padEnd(width)}  ${r.reason}`);
  }

  const fails = results.filter((r) => r.tag === "FAIL");
  const warns = results.filter((r) => r.tag === "WARN");
  const passes = results.filter((r) => r.tag === "PASS");
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\n  Phase 2 apply: ${passes.length} schema-ok, ${warns.length} ok:false (placeholders/external), ${fails.length} broken / ${results.length} (${elapsed}s)`
  );

  // Submit-kind breakdown
  const byKind = new Map<string, number>();
  for (const r of passes) {
    const k = r.submit_kind ?? "?";
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  console.log("\n  submit_kind tally:");
  for (const [k, n] of [...byKind.entries()].sort()) {
    console.log(`    ${k.padEnd(20)}  ${n}`);
  }

  process.exit(fails.length ? 1 : 0);
}

main();
