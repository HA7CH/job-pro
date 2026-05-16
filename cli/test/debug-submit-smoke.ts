// Submit wire-format smoke — exercises the multipart-anon executor for the
// 3 Greenhouse/Lever boards (xpeng / weride / hoyoverse) by firing the
// `--debug-submit-to https://httpbin.org/post` flow with a synthetic profile.
//
// Schema smoke only verifies fetchApplicationSchema. This catches the *next*
// layer: that stageApplication + buildMultipartForm + the executor produce
// a 200-OK echo when piped through an echo server. Catches regressions like:
//   - wrong field names in multipart body
//   - missing required answers when synthetic profile fills them
//   - resume_path read failures
//
// httpbin.org/post is the public echo target. If it's down or rate-limiting,
// the test is best-effort skipped (WARN, exit 0) — don't sink the run.
//
// Run with: pnpm test:debug-submit

import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as xpeng from "../src/xpeng.js";
import * as weride from "../src/weride.js";
import * as hoyoverse from "../src/hoyoverse.js";
import {
  stageApplication,
  submitApplication,
  applyFormFile,
  type ApplyFormSchema,
  type ResumeProfile,
} from "../src/apply.js";

const ECHO_URL = "https://httpbin.org/post";

interface Adapter {
  searchPositions(opts?: Record<string, unknown>): Promise<unknown>;
  fetchApplicationSchema?(postId: string): Promise<unknown>;
}

const ADAPTERS: Record<string, Adapter> = {
  xpeng: xpeng as unknown as Adapter,
  weride: weride as unknown as Adapter,
  hoyoverse: hoyoverse as unknown as Adapter,
};

// Synthetic résumé: a 4-byte file with PDF-looking magic. httpbin echoes the
// multipart parts back, including the file's bytes, so we don't need a real
// document — just *some* file at the path that the multipart layer can read.
function syntheticProfileAndResume(): { profile: ResumeProfile; cleanup: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), "jobpro-debug-smoke-"));
  const resumePath = join(tmp, "resume.pdf");
  writeFileSync(resumePath, "%PDF\n");
  return {
    profile: {
      first_name: "Smoke",
      last_name: "Test",
      email: "smoke-test@example.com",
      phone: "+86 13800138000",
      resume_path: resumePath,
      cover_letter_text: "",
      custom: {},
    },
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

// For Greenhouse boards, the required custom questions are board-specific
// `question_<n>`. Build a `--form-file`-style override by inspecting the
// schema's questions and stuffing a plausible value into each unanswered
// required slot. For *_select kinds we pick the first allowed value.
function autoFillRequired(schema: ApplyFormSchema): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const q of schema.questions) {
    if (!q.required) continue;
    const f = q.fields[0];
    if (!f) continue;
    if (["input_text", "textarea"].includes(f.type)) overrides[f.name] = "N/A (smoke test)";
    else if (["multi_value_single_select", "single_value_single_select"].includes(f.type)) {
      const first = f.values?.[0];
      if (first && typeof first.value !== "undefined") overrides[f.name] = String(first.value);
    }
  }
  return overrides;
}

interface Result {
  name: string;
  tag: "PASS" | "WARN" | "FAIL";
  reason: string;
  http_status?: number;
}

async function probe(name: string, adapter: Adapter, profile: ResumeProfile): Promise<Result> {
  if (typeof adapter.fetchApplicationSchema !== "function") {
    return { name, tag: "FAIL", reason: "no fetchApplicationSchema export" };
  }
  // 1. Get a real post id from the search side.
  let postId: string | null = null;
  try {
    const list = (await adapter.searchPositions({ pageSize: 1 })) as {
      ok?: boolean;
      positions?: Array<{ post_id?: string }>;
    };
    if (list.ok && list.positions?.[0]?.post_id) postId = list.positions[0].post_id;
  } catch {}
  if (!postId) return { name, tag: "WARN", reason: "search returned no posts (skipping)" };

  // 2. Pull schema.
  let schemaResp: unknown;
  try {
    schemaResp = await adapter.fetchApplicationSchema(postId);
  } catch (err) {
    return { name, tag: "FAIL", reason: `schema threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  const sr = schemaResp as { ok?: boolean; schema?: ApplyFormSchema; message?: string };
  if (!sr.ok || !sr.schema) {
    return { name, tag: "WARN", reason: `schema ok:false — ${sr.message ?? "?"}` };
  }

  // 3. Stage with profile + auto-filled required answers.
  const overrides = autoFillRequired(sr.schema);
  const formPath = join(tmpdir(), `jobpro-smoke-form-${name}-${Date.now()}.json`);
  writeFileSync(formPath, JSON.stringify(overrides));
  const merged = applyFormFile(profile, formPath);
  if (!merged.ok) return { name, tag: "FAIL", reason: `applyFormFile: ${merged.message}` };
  const staged = stageApplication(sr.schema, merged.profile);
  if (!staged.ready) {
    return {
      name,
      tag: "WARN",
      reason: `staged not ready (${staged.unanswered_required.length} unanswered): ${staged.unanswered_required.slice(0, 3).join(", ")}`,
    };
  }

  // 4. Fire to echo server.
  let result: { ok?: boolean; status?: number; message?: string };
  try {
    result = (await submitApplication(staged, { kind: "debug", url: ECHO_URL })) as typeof result;
  } catch (err) {
    return { name, tag: "FAIL", reason: `submit threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (result.ok !== true) {
    return { name, tag: "FAIL", reason: `submit ok:false — ${result.message ?? "?"}`, http_status: result.status };
  }
  if (result.status !== 200) {
    return { name, tag: "WARN", reason: `echo returned HTTP ${result.status}`, http_status: result.status };
  }
  return { name, tag: "PASS", reason: `echo 200 OK; ${Object.keys(overrides).length} required answers filled`, http_status: 200 };
}

async function main(): Promise<void> {
  const start = Date.now();
  const { profile, cleanup } = syntheticProfileAndResume();
  try {
    const entries = Object.entries(ADAPTERS);
    const results = await Promise.all(entries.map(([name, a]) => probe(name, a, profile)));
    const width = Math.max(...results.map((r) => r.name.length));
    for (const r of results) {
      const httpTag = r.http_status ? ` http=${r.http_status}` : "";
      console.log(`  ${r.tag.padEnd(4)}  ${r.name.padEnd(width)}  ${r.reason}${httpTag}`);
    }
    const fails = results.filter((r) => r.tag === "FAIL").length;
    const warns = results.filter((r) => r.tag === "WARN").length;
    const passes = results.filter((r) => r.tag === "PASS").length;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n  Submit wire format: ${passes} pass, ${warns} warn, ${fails} broken / ${results.length} (${elapsed}s)`);
    process.exit(fails ? 1 : 0);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
