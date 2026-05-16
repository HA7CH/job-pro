// Pure unit smoke — no network. Exercises the persistence + format-validation
// helpers added in 1.0.10 → 1.0.21:
//
//   * saveProfile + loadProfileRaw round-trip
//   * applyFormFile flat-shape merge
//   * applyFormFile FormTemplate-shape merge
//   * (manual reproduction of) profile-lint email/phone regex
//
// Designed to run in CI alongside `tsc` — no upstream calls, no Chrome,
// no httpbin. Fast (sub-second) and deterministic.
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
  // Set JOB_PRO_PROFILE_PATH to a tmp file BEFORE importing apply.ts (which
  // reads the env var at module-load to bind PROFILE_PATH).
  const tmp = mkdtempSync(join(tmpdir(), "jobpro-unit-smoke-"));
  const profilePath = join(tmp, "profile.json");
  process.env.JOB_PRO_PROFILE_PATH = profilePath;
  try {
    const apply = await import("../src/apply.js");
    const { saveProfile, loadProfileRaw, applyFormFile } = apply;
    type Profile = import("../src/apply.js").ResumeProfile;

    // 1. saveProfile -> loadProfileRaw round-trip
    const orig: Profile = {
      first_name: "Smoke",
      last_name: "Test",
      email: "smoke@example.com",
      phone: "+86 13800138000",
      resume_path: "/tmp/x.pdf",
      cover_letter_text: "",
      custom: { question_001: "alpha", question_002: "bravo" },
    };
    const saved = saveProfile(orig);
    record(
      "saveProfile returns ok",
      saved.ok === true,
      saved.ok ? `path=${saved.path}` : `message=${saved.message}`
    );
    const loaded = loadProfileRaw();
    record(
      "loadProfileRaw returns ok after saveProfile",
      loaded.ok === true,
      loaded.ok ? "" : `message=${loaded.message}`
    );
    if (loaded.ok) {
      const p = loaded.profile;
      record("round-trip email", p.email === orig.email, `got=${p.email}`);
      record("round-trip custom.question_001", p.custom?.question_001 === "alpha", `got=${p.custom?.question_001}`);
      record(
        "round-trip preserves custom key count",
        Object.keys(p.custom ?? {}).length === 2,
        `got ${Object.keys(p.custom ?? {}).length}`
      );
    }

    // 2. applyFormFile flat shape: { name: value }
    const flatPath = join(tmp, "flat-form.json");
    writeFileSync(flatPath, JSON.stringify({ question_003: "charlie", question_004: "delta" }));
    const mergedFlat = applyFormFile(orig, flatPath);
    record("applyFormFile flat-shape ok", mergedFlat.ok === true, mergedFlat.ok ? "" : mergedFlat.message);
    if (mergedFlat.ok) {
      record("flat-shape merged 003", mergedFlat.profile.custom?.question_003 === "charlie");
      record("flat-shape merged 004", mergedFlat.profile.custom?.question_004 === "delta");
      record(
        "flat-shape preserves existing 001",
        mergedFlat.profile.custom?.question_001 === "alpha"
      );
    }

    // 3. applyFormFile FormTemplate shape: { fields: [{ name, value }, …] }
    const tplPath = join(tmp, "tpl-form.json");
    writeFileSync(
      tplPath,
      JSON.stringify({
        fields: [
          { name: "question_005", value: "echo" },
          { name: "question_006", value: "" }, // empty values dropped
          { name: "question_007", value: "foxtrot" },
        ],
      })
    );
    const mergedTpl = applyFormFile(orig, tplPath);
    record("applyFormFile tpl-shape ok", mergedTpl.ok === true, mergedTpl.ok ? "" : mergedTpl.message);
    if (mergedTpl.ok) {
      record("tpl-shape merged 005", mergedTpl.profile.custom?.question_005 === "echo");
      record("tpl-shape merged 007", mergedTpl.profile.custom?.question_007 === "foxtrot");
      record(
        "tpl-shape drops empty values",
        mergedTpl.profile.custom?.question_006 === undefined,
        `got=${mergedTpl.profile.custom?.question_006}`
      );
    }

    // 4. applyFormFile rejects missing file
    const missing = applyFormFile(orig, join(tmp, "does-not-exist.json"));
    record("applyFormFile rejects missing file", missing.ok === false);

    // 5. applyFormFile rejects invalid JSON
    const badJson = join(tmp, "bad.json");
    writeFileSync(badJson, "not json {");
    const badParse = applyFormFile(orig, badJson);
    record("applyFormFile rejects invalid JSON", badParse.ok === false);

    // 6. Session-age math (mirrors the inner sessionAgeDays in index.ts).
    function sessionAgeDays(exported_at: string): number | null {
      const ts = Date.parse(exported_at);
      if (!Number.isFinite(ts)) return null;
      return Math.floor((Date.now() - ts) / 86_400_000);
    }
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString();
    const twoMonthsAgo = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    record("sessionAgeDays(yesterday) === 1", sessionAgeDays(yesterday) === 1);
    record("sessionAgeDays(60d ago) === 60", sessionAgeDays(twoMonthsAgo) === 60);
    record("sessionAgeDays(garbage) === null", sessionAgeDays("not a date") === null);

    // 7. Profile lint regexes (mirrors index.ts inline validators).
    const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    record("email regex accepts valid", validEmail("smoke@example.com") === true);
    record("email regex rejects no-at", validEmail("smokeexample.com") === false);
    record("email regex rejects no-tld", validEmail("smoke@example") === false);
    record("email regex rejects whitespace", validEmail("a b@example.com") === false);
    const validPhone = (s: string) => /^[+]?[\d\s\-()]{7,}$/.test(s) && s.replace(/\D/g, "").length >= 7;
    record("phone regex accepts +86", validPhone("+86 13800138000") === true);
    record("phone regex accepts (555) 123-4567", validPhone("(555) 123-4567") === true);
    record("phone regex rejects 5 digits", validPhone("12345") === false);
    record("phone regex rejects empty", validPhone("") === false);
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
