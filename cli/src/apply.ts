// Phase 2 — auto-apply infrastructure.
//
// This module is intentionally read-only (dry-run) right now. The user
// runs `job-pro <co> apply <postId>` and gets a fully-staged POST payload
// printed to stdout. Actually firing the submission ("--really-submit")
// is guarded: each adapter family must opt in by exporting an
// `executeApplication` function. Out of the 50 adapters, only a handful
// (Greenhouse boards / Lever boards) have well-documented public
// submission APIs; the rest need session capture (Phase 2.1, separate
// release).
//
// Profile shape — loaded from `~/.jobpro/profile.json` or via flags.
// Fields beyond first_name / last_name / email / phone / resume are
// passed through to whatever per-company custom question matches their
// `name` (e.g. `linkedin_url`, `nationality`).

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE_PATH = process.env.JOB_PRO_PROFILE_PATH ?? join(homedir(), ".jobpro", "profile.json");

export interface ResumeProfile {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  /** Absolute path to a PDF or DOCX resume on disk. */
  resume_path?: string;
  cover_letter_text?: string;
  /** Free-form passthroughs — keys are matched against per-question `name` fields. */
  custom?: Record<string, string>;
}

const TEMPLATE: ResumeProfile = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  resume_path: "",
  cover_letter_text: "",
  custom: {
    // Common Greenhouse / Lever questions:
    // question_<n>: "answer"
    // linkedin_url: "https://www.linkedin.com/in/your-handle",
    // nationality: "China",
  },
};

export function loadProfile(): { ok: true; profile: ResumeProfile } | { ok: false; message: string } {
  if (!existsSync(PROFILE_PATH)) {
    return {
      ok: false,
      message:
        `profile not found at ${PROFILE_PATH}. Run \`job-pro profile init\` to create a template, ` +
        `or set $JOB_PRO_PROFILE_PATH to override.`,
    };
  }
  let raw: string;
  try {
    raw = readFileSync(PROFILE_PATH, "utf8");
  } catch (err) {
    return { ok: false, message: `could not read ${PROFILE_PATH}: ${err instanceof Error ? err.message : err}` };
  }
  let parsed: ResumeProfile;
  try {
    parsed = JSON.parse(raw) as ResumeProfile;
  } catch (err) {
    return { ok: false, message: `${PROFILE_PATH} is not valid JSON: ${err instanceof Error ? err.message : err}` };
  }
  for (const required of ["first_name", "last_name", "email", "phone"] as const) {
    if (!parsed[required]) {
      return { ok: false, message: `${PROFILE_PATH}: missing required field "${required}"` };
    }
  }
  return { ok: true, profile: parsed };
}

export function profileTemplate(): { path: string; template: ResumeProfile } {
  return { path: PROFILE_PATH, template: TEMPLATE };
}

// ---------- shared schema types ----------
// Modeled on Greenhouse's question shape; Lever / other ATS schemas get
// normalised into this same shape so the dry-run renderer is generic.

// Field types observed across Greenhouse + Lever. Greenhouse uses
// `multi_value_single_select` / `multi_value_multi_select` for dropdowns,
// Lever has plain `multiple-choice`. We accept any string and treat the
// common five as canonical for staging logic; unknown types fall through
// as "input_text" semantically (caller can override via profile.custom).
export type FieldType =
  | "input_text"
  | "input_file"
  | "textarea"
  | "single_select"
  | "multi_select"
  | "multi_value_single_select"
  | "multi_value_multi_select"
  | (string & {});

export interface ApplyField {
  /** Form field name (e.g. "first_name", "question_36528765002"). */
  name: string;
  /** Input type — drives how we stage the value. */
  type: FieldType;
  /** Allowed values for *_select fields. */
  values?: Array<{ value: string; label: string }>;
}

export interface ApplyQuestion {
  label: string;
  description?: string | null;
  required: boolean;
  fields: ApplyField[];
}

export interface ApplyFormSchema {
  /** Always present so dry-run output identifies which company. */
  source: string;
  post_id: string;
  job_title: string;
  apply_url: string;
  /** Where the POST will go once `--really-submit` is implemented. */
  submit_endpoint?: string;
  /** Submission HTTP method (Greenhouse: POST multipart/form-data). */
  submit_method?: "POST";
  questions: ApplyQuestion[];
}

// ---------- staging ----------

export interface StagedField {
  name: string;
  type: FieldType;
  value: string;
  required: boolean;
  /** If we couldn't auto-fill, the reason. */
  unanswered_reason?: string;
}

export interface StagedApplication {
  source: string;
  post_id: string;
  job_title: string;
  apply_url: string;
  submit_endpoint?: string;
  submit_method?: "POST";
  staged: StagedField[];
  unanswered_required: StagedField[];
  /** Set to true when every required field is filled. */
  ready: boolean;
}

/** Fill in known answers from the profile; flag any unanswered required fields. */
export function stageApplication(schema: ApplyFormSchema, profile: ResumeProfile): StagedApplication {
  const staged: StagedField[] = [];
  const unanswered_required: StagedField[] = [];

  for (const q of schema.questions) {
    // The "primary" field is the first one; secondary fields are alternate
    // formats (e.g. resume has both `resume` file + `resume_text` textarea).
    const primary = q.fields[0];
    if (!primary) continue;
    const filled = resolveAnswer(primary, profile);
    const reason = filled.value || !q.required ? undefined : filled.reason;
    const sf: StagedField = {
      name: primary.name,
      type: primary.type,
      value: filled.value,
      required: q.required,
      unanswered_reason: reason,
    };
    staged.push(sf);
    if (q.required && !filled.value) unanswered_required.push(sf);
  }

  return {
    source: schema.source,
    post_id: schema.post_id,
    job_title: schema.job_title,
    apply_url: schema.apply_url,
    submit_endpoint: schema.submit_endpoint,
    submit_method: schema.submit_method,
    staged,
    unanswered_required,
    ready: unanswered_required.length === 0,
  };
}

interface ResolvedAnswer {
  value: string;
  reason: string;
}

function resolveAnswer(field: ApplyField, profile: ResumeProfile): ResolvedAnswer {
  // Hard-coded standard mappings — these names are the canonical
  // Greenhouse field names and are reused by Lever's submission form.
  switch (field.name) {
    case "first_name":
      return { value: profile.first_name ?? "", reason: "profile.first_name missing" };
    case "last_name":
      return { value: profile.last_name ?? "", reason: "profile.last_name missing" };
    case "email":
      return { value: profile.email ?? "", reason: "profile.email missing" };
    case "phone":
      return { value: profile.phone ?? "", reason: "profile.phone missing" };
    case "resume":
      return {
        value: profile.resume_path ?? "",
        reason: "profile.resume_path missing — set to an absolute PDF/DOCX path",
      };
    case "resume_text":
      // Optional companion field — leave empty if user supplies a file.
      return { value: "", reason: "" };
    case "cover_letter":
      return { value: "", reason: "" };
    case "cover_letter_text":
      return { value: profile.cover_letter_text ?? "", reason: "" };
    default:
      // Custom passthroughs — match by question name (e.g. "question_36528765002").
      const v = profile.custom?.[field.name];
      if (typeof v === "string" && v.length > 0) return { value: v, reason: "" };
      return {
        value: "",
        reason: `unknown field "${field.name}" — add to profile.custom.${field.name} to auto-fill`,
      };
  }
}

// ---------- pretty-print for dry-run ----------

export function formatStaged(s: StagedApplication): string {
  const lines: string[] = [];
  lines.push(`source:    ${s.source}`);
  lines.push(`job:       ${s.post_id} — ${s.job_title}`);
  lines.push(`apply_url: ${s.apply_url}`);
  if (s.submit_endpoint) {
    lines.push(`submit:    ${s.submit_method ?? "POST"} ${s.submit_endpoint}`);
  }
  lines.push("");
  lines.push(`ready: ${s.ready ? "✓ all required fields filled" : `✗ ${s.unanswered_required.length} required field(s) unfilled`}`);
  lines.push("");
  lines.push("Staged payload:");
  const widthName = Math.max(...s.staged.map((f) => f.name.length));
  const widthType = Math.max(...s.staged.map((f) => f.type.length));
  for (const f of s.staged) {
    const flag = f.required ? "•" : " ";
    const value = f.value
      ? f.type === "input_file"
        ? `<file: ${f.value}>`
        : truncate(f.value, 60)
      : f.unanswered_reason
        ? `<unanswered: ${f.unanswered_reason}>`
        : "<empty>";
    lines.push(`  ${flag} ${f.name.padEnd(widthName)}  ${f.type.padEnd(widthType)}  ${value}`);
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
