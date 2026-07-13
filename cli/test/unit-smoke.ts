// Pure unit smoke — no network. Exercises the read-side profile loader
// (cli/src/profile.ts) that `match` / `resume-check` / `status` depend on,
// plus deterministic factory-level regressions that do not need upstream:
//
//   * loadProfileRaw missing-file → ok:false with the path surfaced
//   * loadProfileRaw valid-JSON round-trip (resume_path / degree survive)
//   * loadProfileRaw malformed-JSON → ok:false (no throw)
//   * profilePath honors $JOB_PRO_PROFILE_PATH
//   * Feishu multi-portal apply URLs follow the channel used for each result
//
// Designed to run in CI alongside `tsc` — no upstream calls, no Chrome.
// Fast (sub-second) and deterministic.
//
// Run with: pnpm test:unit

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Case {
  name: string;
  ok: boolean;
  detail?: string;
}

const cases: Case[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  cases.push({ name, ok, detail });
}

async function main(): Promise<void> {
  // Set JOB_PRO_PROFILE_PATH to a tmp file BEFORE importing profile.ts (which
  // reads the env var at module-load to bind PROFILE_PATH).
  const tmp = mkdtempSync(join(tmpdir(), "jobpro-unit-smoke-"));
  const profilePathOverride = join(tmp, "profile.json");
  process.env.JOB_PRO_PROFILE_PATH = profilePathOverride;
  try {
    const { loadProfileRaw, profilePath } = await import("../src/profile.js");

    // 1. profilePath honors the env override.
    record(
      "profilePath honors $JOB_PRO_PROFILE_PATH",
      profilePath() === profilePathOverride,
      `got=${profilePath()}`
    );

    // 2. Missing file → ok:false, path still surfaced.
    const missing = loadProfileRaw();
    record("loadProfileRaw missing file → ok:false", missing.ok === false);
    record(
      "loadProfileRaw missing file surfaces the path",
      missing.path === profilePathOverride,
      `got=${missing.path}`
    );

    // 3. Valid JSON round-trip — the keys the read side actually consumes.
    const orig = {
      first_name: "Smoke",
      last_name: "Test",
      email: "smoke@example.com",
      phone: "+86 13800138000",
      resume_path: "/tmp/x.pdf",
      degree: "master",
      custom: { legacy_key: "kept-but-unused" },
    };
    writeFileSync(profilePathOverride, JSON.stringify(orig, null, 2) + "\n", "utf8");
    const loaded = loadProfileRaw();
    record("loadProfileRaw valid file → ok:true", loaded.ok === true, loaded.ok ? "" : `message=${loaded.message}`);
    if (loaded.ok) {
      const p = loaded.profile;
      record("round-trip resume_path", p.resume_path === orig.resume_path, `got=${p.resume_path}`);
      record("round-trip degree", p.degree === "master", `got=${p.degree}`);
      record("round-trip email", p.email === orig.email, `got=${p.email}`);
      record(
        "round-trip preserves legacy custom keys",
        p.custom?.legacy_key === "kept-but-unused",
        `got=${p.custom?.legacy_key}`
      );
    }

    // 4. Malformed JSON → ok:false with a parse message (must not throw).
    writeFileSync(profilePathOverride, "not json {", "utf8");
    const bad = loadProfileRaw();
    record("loadProfileRaw malformed JSON → ok:false", bad.ok === false);
    record(
      "loadProfileRaw malformed JSON mentions parse failure",
      bad.ok === false && /could not parse/.test(bad.message),
      bad.ok === false ? bad.message : ""
    );

    // 5. Feishu multi-portal URL routing. MiniMax exposes campus on 379481
    // and social on index; the wrong portal renders a false "position down"
    // page even though the search API still returns the live job.
    const originalFetch = globalThis.fetch;
    try {
      let detailMode = false;
      globalThis.fetch = async (_input, init) => {
        const channel = String((init?.headers as Record<string, string>)?.["portal-channel"] ?? "");
        const rows =
          detailMode && channel === "379481"
            ? []
            : [{
                id: "7598036042735110446",
                title: "Forward Deployed Engineer（前沿部署工程师）",
                city_list: [{ name: "北京" }],
                recruit_type: { name: "全职" },
              }];
        return new Response(JSON.stringify({
          code: 0,
          message: "ok",
          data: { job_post_list: rows, count: rows.length },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      };

      const { createAdapter } = await import("../src/feishu.js");
      const feishu = createAdapter({
        host: "example.jobs.feishu.cn",
        channel: "379481",
        socialChannel: "index",
        label: "fixture",
        applyUrlPrefix: "https://example.jobs.feishu.cn/379481/position",
        applyUrlPrefixByChannel: {
          index: "https://example.jobs.feishu.cn/index/position",
        },
      });

      const social = await feishu.searchPositions({ scope: "social" });
      record(
        "Feishu social search uses social portal URL",
        social.ok && social.positions[0]?.apply_url ===
          "https://example.jobs.feishu.cn/index/position/7598036042735110446/detail",
        social.ok ? social.positions[0]?.apply_url : social.message
      );

      const campus = await feishu.searchPositions({ scope: "campus" });
      record(
        "Feishu campus search keeps default portal URL",
        campus.ok && campus.positions[0]?.apply_url ===
          "https://example.jobs.feishu.cn/379481/position/7598036042735110446/detail",
        campus.ok ? campus.positions[0]?.apply_url : campus.message
      );

      detailMode = true;
      const detail = await feishu.fetchPositionDetail("7598036042735110446");
      record(
        "Feishu detail uses the channel where the post was found",
        detail.ok && detail.apply_url ===
          "https://example.jobs.feishu.cn/index/position/7598036042735110446/detail",
        detail.ok ? detail.apply_url : detail.message
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const fails = cases.filter((c) => !c.ok);
  const width = Math.max(...cases.map((c) => c.name.length));
  for (const c of cases) {
    const icon = c.ok ? "✓" : "✗";
    const detail = c.detail ? `  ${c.detail}` : "";
    console.log(`  ${icon} ${c.name.padEnd(width)}${detail}`);
  }
  console.log(`\n  ${cases.length - fails.length} pass, ${fails.length} fail / ${cases.length} (unit, no network)`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
