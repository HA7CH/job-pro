// Read-only profile support (~/.jobpro/profile.json).
//
// The 1.x auto-apply surface owned profile creation and editing (`profile
// init/show/lint` lived in the dispatcher; the loader lived in apply.ts).
// 1.2.0 removed that surface, but two read-side behaviours still depend on
// the file when it exists:
//
//   * `match` / `resume-check` fall back to `profile.resume_path` when the
//     caller omits `--resume` and passes no inline text.
//   * `match` reads `profile.degree` to annotate degree-requirement fit.
//   * `status` reports whether the profile / its resume_path are usable.
//
// The CLI never writes this file anymore — users manage it by hand (or it
// survives from a pre-1.2.0 install).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROFILE_PATH = process.env.JOB_PRO_PROFILE_PATH ?? join(homedir(), ".jobpro", "profile.json");

export type DegreeLevel = "bachelor" | "master" | "phd";

export interface ResumeProfile {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  /** Absolute path to a PDF or DOCX resume on disk. */
  resume_path?: string;
  cover_letter_text?: string;
  /**
   * Highest completed (or in-progress) degree. Used by `match` to flag jobs
   * that require a higher level than the candidate holds (青云计划-博士 etc.).
   */
  degree?: DegreeLevel;
  /** e.g. 2023 — year the highest degree was/will be conferred. Optional context. */
  graduation_year?: number;
  /** Free-form passthroughs kept for pre-1.2.0 profiles; unused by the read side. */
  custom?: Record<string, string>;
}

/**
 * Read profile.json as-is, returning whatever is there. No field validation —
 * callers only pick the keys they need (resume_path / degree).
 */
export function loadProfileRaw(): { ok: true; profile: ResumeProfile; path: string } | { ok: false; message: string; path: string } {
  if (!existsSync(PROFILE_PATH)) {
    return { ok: false, path: PROFILE_PATH, message: `profile not found at ${PROFILE_PATH}` };
  }
  try {
    const raw = readFileSync(PROFILE_PATH, "utf8");
    return { ok: true, path: PROFILE_PATH, profile: JSON.parse(raw) as ResumeProfile };
  } catch (err) {
    return { ok: false, path: PROFILE_PATH, message: `could not parse ${PROFILE_PATH}: ${err instanceof Error ? err.message : err}` };
  }
}

/** Where the profile lives (env-overridable) — surfaced by `status`. */
export function profilePath(): string {
  return PROFILE_PATH;
}
