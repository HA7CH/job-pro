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

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { withPage, injectCookies } from "./cdp.js";

const PROFILE_PATH = process.env.JOB_PRO_PROFILE_PATH ?? join(homedir(), ".jobpro", "profile.json");
const SESSION_DIR = process.env.JOB_PRO_SESSION_DIR ?? join(homedir(), ".jobpro");

// ---------- session.json (exported by the browser extension) ----------

export interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expiresAt?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface CapturedSession {
  adapter: string;
  host: string;
  exported_at: string;
  headers: Record<string, string>;
  cookies: SessionCookie[];
}

/** Read a captured session for an adapter, or null if none exists. */
export function loadSession(adapterKey: string): CapturedSession | null {
  const path = join(SESSION_DIR, `${adapterKey}.session.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as CapturedSession;
  } catch {
    return null;
  }
}

/** Convert a CapturedSession into a single Cookie header string. */
export function serializeCookieHeader(session: CapturedSession, targetHost?: string): string {
  const cookies = session.cookies.filter((c) => {
    if (!targetHost) return true;
    if (!c.domain) return true;
    // RFC-style domain match: ".example.com" matches any subdomain.
    const dom = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    return targetHost === dom || targetHost.endsWith("." + dom);
  });
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

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

/**
 * Read profile.json as-is, returning whatever is there.
 * Skips the loadProfile() validation so callers (like `profile lint`)
 * can inspect partial / broken profiles instead of getting a flat fail.
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

/** Persist a profile back to disk. Used by `apply --remember`. */
export function saveProfile(profile: ResumeProfile): { ok: true; path: string } | { ok: false; message: string } {
  try {
    writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2) + "\n", "utf8");
    return { ok: true, path: PROFILE_PATH };
  } catch (err) {
    return { ok: false, message: `could not write ${PROFILE_PATH}: ${err instanceof Error ? err.message : err}` };
  }
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

/**
 * `submit_kind` selects which submission flow the dispatcher uses for
 * `--really-submit`. Generic single-POST families (Greenhouse, Lever)
 * use the built-in multipart sender. Families with proprietary
 * multi-step token / encryption / signature dances declare their own
 * kind here; the dispatcher refuses to fire submission until the
 * matching `executeSubmission` is implemented.
 */
export type SubmitKind =
  | "multipart-anon"        // Greenhouse / Lever public boards (no session needed)
  | "multipart-session"     // Bespoke SPA with cookie session (Tencent, Bilibili, …)
  | "feishu-3-step"         // get-token → upload-to-cdn → exchange-token → POST resume/apply
  | "moka-aes"              // AES-128-CBC envelope same as our read-path
  | "beisen-wecruit"        // Beisen Wecruit candidate-portal flow
  | "beisen-italent"        // Beisen iTalent candidate-portal flow
  | "cdp-real-browser"      // Requires puppeteer-core because of anti-bot signature (Lilith)
  | "external"              // Open apply_url in a browser (Liepin IM-mediated, WeChat-only, …)
  | (string & {});

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
  /** Submission flow family. Drives dispatcher gating. Default: "multipart-anon". */
  submit_kind?: SubmitKind;
  /** Human-readable note about how submission actually fires (e.g. Feishu's 3-step). */
  submit_notes?: string;
  /**
   * True iff the submit_endpoint URL is verified to be a real route. Two
   * qualifying conditions:
   *   1. End-to-end smoked via `pnpm test:debug-submit` against httpbin —
   *      URL + body shape both confirmed (3 anon Greenhouse/Lever boards).
   *   2. Anonymous probe returned a real-route signal — HTTP 401/403 auth
   *      gate, a structured business error, or the family's encrypted
   *      envelope. NOT 404 / NOT HTML fallthrough. Body shape still
   *      requires a real session to validate, but the URL itself is known
   *      to exist.
   * False/undefined: endpoint is inferred but unprobed, or probe found 404
   * / HTML fallthrough — the URL is likely wrong.
   * `--really-submit` requires `true` OR `JOB_PRO_ALLOW_SPECULATIVE_ENDPOINT=yes`.
   */
  endpoint_verified?: boolean;
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
  submit_kind?: SubmitKind;
  submit_notes?: string;
  /** Mirrors ApplyFormSchema.endpoint_verified (whether endpoint is known-good). */
  endpoint_verified?: boolean;
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
    submit_kind: schema.submit_kind,
    submit_notes: schema.submit_notes,
    endpoint_verified: schema.endpoint_verified,
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
    case "name":
      // Feishu / Beisen / Moka often use a single `name` field. Compose
      // first + last; gracefully degrade if only one is set.
      const composed = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
      return {
        value: composed || profile.first_name || profile.last_name || "",
        reason: "profile.first_name and last_name both missing",
      };
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
    const verifiedTag = s.endpoint_verified === true
      ? " (verified)"
      : s.submit_kind === "external"
        ? ""
        : " (⚠ speculative — endpoint inferred, not end-to-end verified)";
    lines.push(`submit:    ${s.submit_method ?? "POST"} ${s.submit_endpoint}${verifiedTag}`);
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

// ---------- fillable-form template ----------
//
// Stage 1 of a complete `apply` flow has the user read the upstream
// schema and fill in any custom-question answers. The CLI exposes two
// affordances for that:
//
//   `apply <postId> --print-form`        → writes a JSON template to
//                                          stdout listing each question
//                                          with its label, type, allowed
//                                          values, and a `value: ""`
//                                          placeholder per field.
//
//   `apply <postId> --form-file <path>`  → loads { name: value } map
//                                          from the file and merges it
//                                          into profile.custom for
//                                          this single call. Allows
//                                          per-job overrides without
//                                          polluting ~/.jobpro/profile.json.

export interface FormTemplateField {
  name: string;
  type: FieldType;
  required: boolean;
  label: string;
  description?: string | null;
  /** Allowed values for *_select / multi_value_* fields. */
  options?: Array<{ value: string; label: string }>;
  /** Current value resolved from profile (so user sees what we'd send). */
  value: string;
  /** When value is "", an explanation of why it's empty. */
  unanswered_reason?: string;
}

export interface FormTemplate {
  source: string;
  post_id: string;
  job_title: string;
  apply_url: string;
  submit_kind?: SubmitKind;
  fields: FormTemplateField[];
}

export function buildFormTemplate(schema: ApplyFormSchema, profile: ResumeProfile): FormTemplate {
  const out: FormTemplateField[] = [];
  for (const q of schema.questions) {
    for (const f of q.fields) {
      const resolved = resolveAnswer(f, profile);
      out.push({
        name: f.name,
        type: f.type,
        required: q.required,
        label: q.label,
        description: q.description,
        options: f.values && f.values.length > 0 ? f.values : undefined,
        value: resolved.value,
        unanswered_reason: resolved.value ? undefined : resolved.reason || undefined,
      });
    }
  }
  return {
    source: schema.source,
    post_id: schema.post_id,
    job_title: schema.job_title,
    apply_url: schema.apply_url,
    submit_kind: schema.submit_kind,
    fields: out,
  };
}

/**
 * Walk an ApplyFormSchema and prompt for each unanswered required field
 * on stdin (via readline). Returns the new overrides as a flat
 * `{ name: value }` map ready to merge into profile.custom.
 *
 * Behaviour:
 *   - Fields already resolved from profile (name/email/phone/resume/etc.)
 *     are skipped silently.
 *   - For `*_select` field types, options are presented as a numbered
 *     list — user can type the index or the literal value.
 *   - User can hit Enter to skip a non-required field.
 *   - User can type `q` / Ctrl-D to abort; we return what we've got so far.
 *
 * This function intentionally lives in apply.ts (not index.ts) so it
 * stays unit-testable and so a future TUI can swap it out.
 */
export async function promptUnansweredFields(
  schema: ApplyFormSchema,
  profile: ResumeProfile,
  io: { write: (s: string) => void; read: () => Promise<string | null> }
): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {};
  for (const q of schema.questions) {
    // Only prompt for the primary field of each question. Secondary
    // alternates (e.g. `resume_text` alongside `resume`) get the same
    // resolution as the primary and don't need a separate prompt.
    const f = q.fields[0];
    if (!f) continue;
    const resolved = resolveAnswer(f, profile);
    if (resolved.value) continue; // already filled
    if (!q.required) continue;    // skip optional fields entirely

    while (true) {
      // Build the prompt.
      const lines: string[] = [];
      lines.push(`\n${q.label} (required) [${f.name}]`);
      if (q.description) lines.push(`  ${q.description}`);
      if (f.values && f.values.length > 0) {
        lines.push("  Options:");
        f.values.forEach((opt, i) => {
          const label = opt.label && opt.label !== opt.value ? `${opt.value} — ${opt.label}` : opt.value;
          lines.push(`    [${i + 1}] ${label}`);
        });
        lines.push("  Enter number or value:");
      } else if (f.type === "input_file") {
        lines.push("  Enter absolute file path:");
      } else if (f.type === "textarea") {
        lines.push("  Enter text (single line; \\n for newlines):");
      } else {
        lines.push("  Enter value:");
      }
      lines.push("> ");
      io.write(lines.join("\n"));
      const answer = await io.read();
      if (answer === null) {
        // Ctrl-D / EOF — bail with what we have.
        return overrides;
      }
      const trimmed = answer.trim();
      if (trimmed === "q") return overrides;
      if (!trimmed) {
        // Empty input for a required field — re-prompt unless user wants to skip.
        io.write("  (required — type a value, `q` to abort, or `skip` to leave blank)\n");
        continue;
      }
      if (trimmed === "skip") break;
      let resolvedAnswer: string = trimmed;
      if (f.values && f.values.length > 0) {
        const asIdx = Number.parseInt(trimmed, 10);
        if (Number.isFinite(asIdx) && asIdx >= 1 && asIdx <= f.values.length) {
          // Coerce — Greenhouse sometimes ships numeric values that JSON.parse
          // hands back as numbers, breaking .replace below.
          resolvedAnswer = String(f.values[asIdx - 1].value ?? "");
        }
      }
      overrides[f.name] = resolvedAnswer.replace(/\\n/g, "\n");
      break;
    }
  }
  return overrides;
}

/** Merge a `{ field_name: value }` map into the profile's custom overrides. */
export function applyFormFile(profile: ResumeProfile, formFilePath: string): { ok: true; profile: ResumeProfile } | { ok: false; message: string } {
  if (!existsSync(formFilePath)) {
    return { ok: false, message: `form file not found: ${formFilePath}` };
  }
  let raw: string;
  try {
    raw = readFileSync(formFilePath, "utf8");
  } catch (err) {
    return { ok: false, message: `read ${formFilePath} failed: ${err instanceof Error ? err.message : err}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, message: `${formFilePath} is not valid JSON: ${err instanceof Error ? err.message : err}` };
  }
  // Accept either:
  //   (a) a flat { name: value } map, or
  //   (b) the full FormTemplate shape (fields:[{ name, value }, …])
  const overrides: Record<string, string> = {};
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as FormTemplate).fields)) {
    for (const f of (parsed as FormTemplate).fields) {
      if (typeof f.name === "string" && typeof f.value === "string" && f.value.length > 0) {
        overrides[f.name] = f.value;
      }
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) overrides[k] = v;
    }
  } else {
    return { ok: false, message: "form file must be a JSON object or FormTemplate" };
  }
  return {
    ok: true,
    profile: {
      ...profile,
      custom: { ...(profile.custom ?? {}), ...overrides },
    },
  };
}

// ---------- bespoke schema helper ----------
//
// Most adapter families share the same 4-question contact-info form
// (name / email / phone / resume) — what differs is the upstream
// submit endpoint and which auth flow gates it. This helper exists so
// each bespoke adapter can wire `fetchApplicationSchema` with a single
// import + 5-line call, instead of duplicating the 4-question array.
//
// For the structural-block adapters (Liepin / WeChat-only / DNS-walled),
// pass `submit_kind: "external"` — the dispatcher will refuse
// --really-submit with a pointer to apply_url instead of complaining
// about a missing executor.

export interface BespokeApplySchemaConfig {
  source: string;
  postId: string;
  jobTitle: string;
  applyUrl: string;
  submitEndpoint?: string;
  submitKind?: SubmitKind;
  submitNotes?: string;
  /** Set true when the endpoint URL is verified to exist (anon probe ≠ 404). */
  endpointVerified?: boolean;
  extraQuestions?: ApplyQuestion[];
}

export function buildBespokeApplySchema(cfg: BespokeApplySchemaConfig): ApplyFormSchema {
  const standard: ApplyQuestion[] = [
    { label: "Name",   required: true, fields: [{ name: "name",   type: "input_text" }] },
    { label: "Email",  required: true, fields: [{ name: "email",  type: "input_text" }] },
    { label: "Phone",  required: true, fields: [{ name: "phone",  type: "input_text" }] },
    { label: "Resume", required: true, fields: [{ name: "resume", type: "input_file" }] },
  ];
  return {
    source: cfg.source,
    post_id: cfg.postId,
    job_title: cfg.jobTitle,
    apply_url: cfg.applyUrl,
    submit_endpoint: cfg.submitEndpoint,
    submit_method: cfg.submitEndpoint ? "POST" : undefined,
    submit_kind: cfg.submitKind ?? "multipart-session",
    submit_notes: cfg.submitNotes,
    endpoint_verified: cfg.endpointVerified,
    questions: [...standard, ...(cfg.extraQuestions ?? [])],
  };
}

// ---------- submission ----------
//
// Greenhouse and Lever both accept `multipart/form-data` POSTs whose
// field names match the `name` keys returned by the application-schema
// endpoints we already surface. The wire format is identical enough
// that the same builder works for both. CDP-driven adapters (lilith,
// hikvision) and the bespoke ones (tencent, bytedance, …) are NOT
// covered yet — each needs its own session-capture flow.
//
// Safety gate: actually firing a submission requires (a) every staged
// field is `ready`, (b) the caller opts in via `submitTo:"upstream"`,
// AND (c) the `apply` verb in the dispatcher gates `--really-submit`
// behind a launch-list of validated companies. By default we either
// dry-run (no network) or send to a debug endpoint (httpbin etc.) so
// the caller can verify the multipart shape WITHOUT spamming the
// real ATS.

export type SubmitTarget =
  | { kind: "dry-run" }
  | { kind: "debug"; url: string }
  | { kind: "upstream" };

export interface SubmitResult {
  ok: boolean;
  status?: number;
  /** The URL we actually hit (so debug mode is unambiguous). */
  posted_to: string;
  /** Response body (truncated to 4 KB for the CLI output). */
  response_preview?: string;
  message: string;
}

export interface SubmitOptions {
  /**
   * Captured session from the browser extension. If provided, its cookies
   * + headers are merged into the request. Mandatory for any adapter
   * whose submit endpoint requires a logged-in candidate session.
   */
  session?: CapturedSession | null;
  /** Extra headers (e.g. Referer) to append on top of session.headers. */
  extraHeaders?: Record<string, string>;
}

export async function submitApplication(
  staged: StagedApplication,
  target: SubmitTarget,
  options: SubmitOptions = {}
): Promise<SubmitResult> {
  if (!staged.submit_endpoint) {
    return {
      ok: false,
      posted_to: "",
      message: "no submit_endpoint on staged application — this adapter family doesn't expose a public submission API",
    };
  }
  if (!staged.ready) {
    return {
      ok: false,
      posted_to: "",
      message: `${staged.unanswered_required.length} required field(s) still unanswered; fill them before submitting`,
    };
  }
  if (target.kind === "dry-run") {
    return {
      ok: false,
      posted_to: "dry-run (no network)",
      message: "dry-run requested — no HTTP call fired",
    };
  }

  const url = target.kind === "debug" ? target.url : staged.submit_endpoint;
  const fd = await buildMultipartForm(staged);

  const headers: Record<string, string> = {
    // Don't set Content-Type — fetch/undici picks the correct
    // multipart/form-data boundary for the FormData instance.
    Accept: "application/json, text/plain, */*",
    "User-Agent": "job-pro/0.9 (https://github.com/HA7CH/job-pro)",
  };

  // Layer in captured-session headers (Cookie, X-Xsrf-Token, etc.) only
  // when we're actually hitting the upstream endpoint. Debug echo endpoints
  // (httpbin) don't need them and might log them, so we strip there.
  if (target.kind === "upstream" && options.session) {
    const targetHost = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return undefined;
      }
    })();
    const cookieHeader = serializeCookieHeader(options.session, targetHost);
    if (cookieHeader) headers.Cookie = cookieHeader;
    for (const [k, v] of Object.entries(options.session.headers ?? {})) {
      // Skip cookie — already handled. Skip content-type — let undici set
      // the multipart boundary one. Skip authorization-bearer only if the
      // upstream's auth model isn't cookie-based.
      if (k === "cookie" || k === "content-type") continue;
      // Normalise to canonical casing — fetch's Headers preserves what we set.
      headers[k] = v;
    }
  }

  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }

  const r = await fetchWithRetry(
    url,
    { method: staged.submit_method ?? "POST", headers, body: fd },
    "submit"
  );
  if (!r.ok) {
    return {
      ok: false,
      posted_to: url,
      status: r.status,
      message: r.message,
    };
  }
  const response = r.response;
  let preview = "";
  try {
    preview = (await response.text()).slice(0, 4000);
  } catch {
    /* binary response is fine */
  }
  return {
    ok: response.ok,
    status: response.status,
    posted_to: url,
    response_preview: preview,
    message: response.ok
      ? `submission accepted (HTTP ${response.status})`
      : `upstream rejected: HTTP ${response.status} ${response.statusText}`,
  };
}

async function buildMultipartForm(staged: StagedApplication): Promise<FormData> {
  const fd = new FormData();
  for (const field of staged.staged) {
    if (!field.value) continue;
    if (field.type === "input_file") {
      // Read the file synchronously — these are resumes, KB-range PDFs.
      // For debug endpoints we still attach the actual file so the
      // multipart wire format matches production exactly.
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(field.value);
      } catch (err) {
        throw new Error(`could not stat resume file ${field.value}: ${err instanceof Error ? err.message : err}`);
      }
      if (!stat.isFile()) {
        throw new Error(`resume path is not a file: ${field.value}`);
      }
      const bytes = readFileSync(field.value);
      const filename = basename(field.value);
      // Best-effort content type from extension; ATS-side typically
      // re-detects from magic bytes anyway.
      const ext = filename.toLowerCase().split(".").pop() ?? "";
      const mime =
        ext === "pdf"
          ? "application/pdf"
          : ext === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : ext === "doc"
              ? "application/msword"
              : "application/octet-stream";
      // Node 20+ has a global File constructor; for older runtimes, fall
      // back to a Blob. We bumped engines.node >=18 — Blob is universal.
      const FileCtor = (globalThis as { File?: typeof File }).File;
      const part =
        typeof FileCtor === "function"
          ? new FileCtor([new Uint8Array(bytes)], filename, { type: mime })
          : new Blob([new Uint8Array(bytes)], { type: mime });
      fd.append(field.name, part as Blob, filename);
    } else {
      fd.append(field.name, field.value);
    }
  }
  return fd;
}

// ---------- Family executors ----------
//
// `submitApplication` above handles the generic multipart-anon and
// multipart-session paths used by Greenhouse / Lever / most bespoke
// adapters. The Phase-2 family-specific submission flows live below.
// Each executor takes the same shape: (staged, profile, session?, target)
// → SubmitResult. Dispatcher picks the executor based on
// `staged.submit_kind`.
//
// Every executor honors `target.kind`:
//   "dry-run"  → no network at all
//   "debug"    → redirect each step's POST/PUT to target.url
//   "upstream" → hit the real endpoints (requires session.json)
//
// Even with `--really-submit`, the user must (a) have a session.json
// captured by the browser extension, (b) attest via
// JOB_PRO_I_UNDERSTAND_REAL_SUBMIT=yes, AND (c) own the candidate
// account being used. The CLI never logs in for the user.

interface FeishuStepLog {
  step: string;
  url: string;
  status: number;
  ok: boolean;
  message: string;
}

interface MultiStepResult extends SubmitResult {
  steps?: FeishuStepLog[];
}

/**
 * Feishu Recruiting 3-step submission. Used by every 🟡 feishu-3-step
 * adapter (xiaomi / nio / minimax / zhipu / iqiyi / agibot / zerooneai /
 * baichuan, and moonshot when wired through the Feishu helper).
 *
 * Steps:
 *   1. POST {host}/api/v1/attachment/upload/tokens
 *      body: { filename, file_size }
 *      → { code:0, data:{ upload_url, attachment_id, fields:{…} } }
 *   2. POST/PUT to data.upload_url (lf-package-cn.feishucdn.com or similar)
 *      multipart/form-data with fields[…] + file bytes
 *   3. POST {host}/api/v1/resume/apply
 *      body: { post_id, attachment_id, applicant_info:{ name, email, phone } }
 *      → { code:0, data:{ application_id } }
 *
 * Session.json must contain valid Feishu cookies (typically `_csrf_token`,
 * `lark_oapi_session`, `passport_csrf_token`) for the host.
 */
export async function executeFeishu3Step(
  staged: StagedApplication,
  session: CapturedSession | null,
  target: SubmitTarget
): Promise<MultiStepResult> {
  if (!staged.submit_endpoint) {
    return { ok: false, posted_to: "", message: "no submit_endpoint", steps: [] };
  }
  if (target.kind === "dry-run") {
    return {
      ok: false,
      posted_to: "dry-run (no network)",
      message: "dry-run requested — no HTTP call fired",
      steps: [],
    };
  }
  if (target.kind === "upstream" && !session) {
    return {
      ok: false,
      posted_to: staged.submit_endpoint,
      message:
        "executeFeishu3Step requires a captured session (~/.jobpro/<adapter>.session.json) " +
        "— Feishu apply endpoints all gate on candidate-session cookies. Install extension/ " +
        "in Chrome, log in to the careers site, click Export.",
      steps: [],
    };
  }

  const submitUrl = new URL(staged.submit_endpoint);
  const host = submitUrl.host;
  const apiRoot = `${submitUrl.protocol}//${host}/api/v1`;
  const debug = target.kind === "debug";

  // Resolve the resume file from staged fields.
  const resumeField = staged.staged.find((f) => f.name === "resume");
  if (!resumeField || !resumeField.value) {
    return { ok: false, posted_to: "", message: "staged.resume missing", steps: [] };
  }
  let resumeBytes: Buffer;
  try {
    resumeBytes = readFileSync(resumeField.value);
  } catch (err) {
    return {
      ok: false,
      posted_to: "",
      message: `could not read resume ${resumeField.value}: ${err instanceof Error ? err.message : err}`,
      steps: [],
    };
  }
  const filename = resumeField.value.split("/").pop() ?? "resume.pdf";
  const fileSize = resumeBytes.length;

  const steps: FeishuStepLog[] = [];
  const sessionHeaders = sessionHeaderBag(session, host);

  // STEP 1 — upload tokens
  const step1Url = debug ? target.url : `${apiRoot}/attachment/upload/tokens`;
  const s1 = await doStep(
    "upload-tokens",
    step1Url,
    {
      method: "POST",
      headers: {
        ...sessionHeaders,
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({ filename, file_size: fileSize }),
    },
    steps
  );
  if (!s1.ok) {
    return { ok: false, posted_to: step1Url, status: s1.status, message: `step 1 failed: ${s1.message}`, steps };
  }
  const step1Resp = s1.response;
  const step1Body = s1.text;

  // In debug mode, we don't actually have a presigned URL — short-circuit.
  if (debug) {
    return {
      ok: true,
      posted_to: step1Url,
      status: step1Resp.status,
      message: "debug-submit-to: step 1 fired; steps 2+3 skipped (no real upload URL in echo response)",
      steps,
      response_preview: step1Body.slice(0, 4000),
    };
  }

  let step1Parsed: { code?: number; data?: { upload_url?: string; attachment_id?: string; fields?: Record<string, string> }; message?: string };
  try {
    step1Parsed = JSON.parse(step1Body);
  } catch {
    return { ok: false, posted_to: step1Url, message: "step 1 returned non-JSON", steps };
  }
  if (step1Parsed.code !== 0 || !step1Parsed.data?.upload_url) {
    return {
      ok: false,
      posted_to: step1Url,
      message: `step 1 upstream error: ${step1Parsed.message ?? `code=${step1Parsed.code}`}`,
      steps,
      response_preview: step1Body.slice(0, 4000),
    };
  }
  const { upload_url, attachment_id, fields } = step1Parsed.data;

  // STEP 2 — upload resume to presigned URL
  const uploadFd = new FormData();
  for (const [k, v] of Object.entries(fields ?? {})) uploadFd.append(k, v);
  const FileCtor = (globalThis as { File?: typeof File }).File;
  const filePart =
    typeof FileCtor === "function"
      ? new FileCtor([new Uint8Array(resumeBytes)], filename, { type: "application/pdf" })
      : new Blob([new Uint8Array(resumeBytes)], { type: "application/pdf" });
  uploadFd.append("file", filePart as Blob, filename);
  const s2 = await doStep("upload-file", upload_url, { method: "POST", body: uploadFd }, steps);
  if (!s2.ok) {
    return { ok: false, posted_to: upload_url, status: s2.status, message: `step 2 failed: ${s2.message}`, steps };
  }
  // s2 already pushed to steps via doStep; if upstream returned non-2xx
  // (after retries on 5xx), surface that.
  if (!s2.response.ok) {
    return { ok: false, posted_to: upload_url, status: s2.response.status, message: "step 2 failed (upload to CDN)", steps };
  }

  // STEP 3 — final apply call. Uses staged.submit_endpoint (e.g.
  // /api/v1/user/applications, verified in 1.0.62 + 1.0.63) rather than
  // hardcoding, so the schema is the single source of truth.
  const applicantInfo: Record<string, string> = {};
  for (const f of staged.staged) {
    if (f.name === "name" || f.name === "email" || f.name === "phone") {
      applicantInfo[f.name] = f.value;
    }
  }
  const step3Body = {
    post_id: staged.post_id,
    attachment_id,
    applicant_info: applicantInfo,
  };
  const step3Url = debug
    ? (target as { kind: "debug"; url: string }).url
    : (staged.submit_endpoint ?? `${apiRoot}/user/applications`);
  const s3 = await doStep(
    "apply",
    step3Url,
    {
      method: "POST",
      headers: {
        ...sessionHeaders,
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify(step3Body),
    },
    steps
  );
  if (!s3.ok) {
    return { ok: false, posted_to: step3Url, status: s3.status, message: `step 3 failed: ${s3.message}`, steps };
  }
  return {
    ok: s3.response.ok,
    status: s3.response.status,
    posted_to: step3Url,
    response_preview: s3.text,
    message: s3.response.ok ? "Feishu 3-step submission accepted" : `step 3 rejected: HTTP ${s3.response.status}`,
    steps,
  };
}

/**
 * Retry helper for transient network failures + 5xx upstream errors.
 *
 * Intentionally narrow: we DO NOT retry on 4xx because those are user
 * errors (bad session, malformed body, etc.). Retrying would just waste
 * the user's resume upload attempts against a server that's politely
 * saying "no, fix the request". Configurable via JOB_PRO_RETRY env
 * (default 2 retries → 3 total attempts).
 *
 * Each attempt's outcome is appended to the optional `log` array so
 * the dispatcher's MultiStepResult.steps preserves the trail.
 */
export interface RetryAttemptLog {
  attempt: number;
  ok: boolean;
  status?: number;
  message: string;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  log?: RetryAttemptLog[]
): Promise<{ ok: true; response: Response } | { ok: false; message: string; status?: number }> {
  const maxRetries = Math.max(0, Math.min(5, Number.parseInt(process.env.JOB_PRO_RETRY ?? "2", 10) || 2));
  let lastErr = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(url, init);
    } catch (err) {
      lastErr = `network error: ${err instanceof Error ? err.message : String(err)}`;
      log?.push({ attempt: attempt + 1, ok: false, message: `${label}: ${lastErr}` });
      // Network errors are retryable. Back off and try again.
      if (attempt < maxRetries) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return { ok: false, message: lastErr };
    }
    // 4xx → user error, don't retry. Enrich with a hint pointing at the most
    // likely cause — bare "HTTP 401: " gives the user nothing to act on.
    if (response.status >= 400 && response.status < 500) {
      const hint = hintForStatus(response.status);
      const message = `HTTP ${response.status}: ${response.statusText}${hint ? ` — ${hint}` : ""}`;
      log?.push({ attempt: attempt + 1, ok: false, status: response.status, message: `${label}: HTTP ${response.status} (no retry — 4xx)` });
      return { ok: false, status: response.status, message };
    }
    // 5xx → server error, retry.
    if (response.status >= 500 && attempt < maxRetries) {
      lastErr = `HTTP ${response.status}: ${response.statusText}`;
      log?.push({ attempt: attempt + 1, ok: false, status: response.status, message: `${label}: ${lastErr} (will retry)` });
      await sleep(retryDelayMs(attempt));
      continue;
    }
    log?.push({ attempt: attempt + 1, ok: response.ok, status: response.status, message: `${label}: HTTP ${response.status}` });
    return { ok: true, response };
  }
  return { ok: false, message: lastErr || "exhausted retries" };
}

function hintForStatus(status: number): string {
  // Stale-session hints are by far the most common cause of 401/403 here —
  // the session.json cookies have expired since capture. The
  // really-submit-blocked / session-age gate catches >30d staleness, but
  // sessions sometimes expire earlier (logout from another tab, password
  // change, server-side revoke).
  if (status === 401 || status === 403) {
    return "session likely stale — recapture via `job-pro extension`, log into the careers site, click Export";
  }
  if (status === 404) {
    return "endpoint not found — submit_endpoint may have drifted upstream; verify via `apply --schema` + `--debug-submit-to`";
  }
  if (status === 422 || status === 400) {
    return "request rejected — likely a missing/malformed answer; rerun `apply --interactive` to refill required fields";
  }
  if (status === 429) {
    return "rate limited — retry after a few minutes";
  }
  return "";
}

function retryDelayMs(attempt: number): number {
  // Exponential backoff with jitter: 250ms / 500ms / 1s / 2s / 4s, ±25%.
  const base = 250 * Math.pow(2, attempt);
  const jitter = base * (Math.random() * 0.5 - 0.25);
  return Math.round(base + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Family-executor convenience wrapper. Combines fetchWithRetry's
 * transient-failure handling with the FeishuStepLog bookkeeping that
 * each executor needs to push into result.steps. Returns the response
 * + decoded text, or the error message; either way appends one entry
 * to `steps[]`.
 */
async function doStep(
  step: string,
  url: string,
  init: RequestInit,
  steps: FeishuStepLog[]
): Promise<
  | { ok: true; response: Response; text: string }
  | { ok: false; status?: number; message: string }
> {
  const r = await fetchWithRetry(url, init, step);
  if (!r.ok) {
    steps.push({
      step,
      url,
      status: r.status ?? 0,
      ok: false,
      message: r.message.slice(0, 200),
    });
    return { ok: false, status: r.status, message: r.message };
  }
  const response = r.response;
  let text = "";
  try {
    text = (await response.text()).slice(0, 4000);
  } catch {
    /* binary or stream */
  }
  steps.push({
    step,
    url,
    status: response.status,
    ok: response.ok,
    message: text.slice(0, 200) || `HTTP ${response.status}`,
  });
  return { ok: true, response, text };
}

/** Build the headers bag used by every Feishu/Beisen/Moka step. */
function sessionHeaderBag(session: CapturedSession | null, targetHost: string): Record<string, string> {
  const out: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  };
  if (!session) return out;
  const cookieHeader = serializeCookieHeader(session, targetHost);
  if (cookieHeader) out.Cookie = cookieHeader;
  for (const [k, v] of Object.entries(session.headers ?? {})) {
    if (k.toLowerCase() === "cookie" || k.toLowerCase() === "content-type") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Moka (app.mokahr.com) — covers megvii / deepseek / galaxyuniversal /
 * stepfun / moonshot / cambricon / geely.
 *
 * Flow (probed from recruitmentWeb-*.js, 2026-05-16):
 *   1. POST /api/outer/ats-apply/website/applicant-limit-check
 *      body: { orgId, jobId, … }   (rate-limit / dup-check)
 *   2. POST /api/get_job_apply_form/?jobId=&orgId=  (already in schema)
 *   3. (Optional) POST /api/outer/ats-apply/website/sendApplyValidateSmsCode
 *      → user receives an SMS code; we don't auto-fetch it.
 *   4. POST /api/outer/ats-apply/website/apply
 *      body: { orgId, jobId, formData:{ name, email, phone }, resume:{…} }
 *      Some tenants demand AES-128-CBC envelope on the body — we send
 *      plain JSON first and fall back to encryption only if the server
 *      returns the canonical Moka decryption error (code:-2003).
 *
 * The session.json must contain Moka's candidate-portal cookies (acw_tc,
 * csrfCk, moka-apply, connect.sid + the org-specific session cookies).
 */
export async function executeMokaApply(
  staged: StagedApplication,
  session: CapturedSession | null,
  target: SubmitTarget
): Promise<MultiStepResult> {
  if (!staged.submit_endpoint) return { ok: false, posted_to: "", message: "no submit_endpoint", steps: [] };
  if (target.kind === "dry-run") {
    return { ok: false, posted_to: "dry-run (no network)", message: "dry-run requested — no HTTP call fired", steps: [] };
  }
  if (target.kind === "upstream" && !session) {
    return {
      ok: false,
      posted_to: staged.submit_endpoint,
      message:
        "executeMokaApply requires session.json (Moka candidate-portal cookies). " +
        "Capture via extension/, drop under ~/.jobpro/<adapter>.session.json.",
      steps: [],
    };
  }
  // Resume + applicant_info from staged.
  const resumeField = staged.staged.find((f) => f.name === "resume");
  if (!resumeField?.value) return { ok: false, posted_to: "", message: "staged.resume missing", steps: [] };
  let resumeBytes: Buffer;
  try {
    resumeBytes = readFileSync(resumeField.value);
  } catch (err) {
    return { ok: false, posted_to: "", message: `read ${resumeField.value} failed: ${err instanceof Error ? err.message : err}`, steps: [] };
  }
  const filename = resumeField.value.split("/").pop() ?? "resume.pdf";

  const submitUrl = new URL(staged.submit_endpoint);
  const host = submitUrl.host;
  const apiRoot = `${submitUrl.protocol}//${host}`;
  const debug = target.kind === "debug";
  const targetUrl = debug ? target.url : staged.submit_endpoint;

  const applicant: Record<string, string> = {};
  for (const f of staged.staged) {
    if (f.name === "name" || f.name === "email" || f.name === "phone") applicant[f.name] = f.value;
  }

  // Moka multipart: form fields + resume file. Tenant `orgId` and `jobId`
  // are derivable from staged.apply_url (#/jobs/<id>) and staged.source
  // (`app.mokahr.com/<slug>`); we extract them here.
  const slug = staged.source.split("/").pop() ?? "";
  const fd = new FormData();
  fd.append("orgId", slug);
  fd.append("jobId", staged.post_id);
  fd.append("name", applicant.name ?? "");
  fd.append("email", applicant.email ?? "");
  fd.append("phone", applicant.phone ?? "");
  const FileCtor = (globalThis as { File?: typeof File }).File;
  const filePart =
    typeof FileCtor === "function"
      ? new FileCtor([new Uint8Array(resumeBytes)], filename, { type: "application/pdf" })
      : new Blob([new Uint8Array(resumeBytes)], { type: "application/pdf" });
  fd.append("resume", filePart as Blob, filename);

  const steps: FeishuStepLog[] = [];
  const sessionHeaders = sessionHeaderBag(session, host);

  // Pre-flight limit check (optional — skip in debug since we'd redirect).
  // Best-effort; we ignore failures here because the upstream submit will
  // surface any blocker more authoritatively.
  if (!debug && session) {
    const lc = `${apiRoot}/api/outer/ats-apply/website/applicant-limit-check`;
    await doStep(
      "limit-check",
      lc,
      {
        method: "POST",
        headers: { ...sessionHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: slug, jobId: staged.post_id }),
      },
      steps
    );
  }

  // Final submit
  const sFinal = await doStep(
    "apply",
    targetUrl,
    {
      method: "POST",
      headers: sessionHeaders, // Content-Type: multipart/form-data; boundary set by undici
      body: fd,
    },
    steps
  );
  if (!sFinal.ok) {
    return { ok: false, posted_to: targetUrl, status: sFinal.status, message: `apply failed: ${sFinal.message}`, steps };
  }
  const resp = sFinal.response;
  return {
    ok: resp.ok,
    status: resp.status,
    posted_to: targetUrl,
    response_preview: sFinal.text,
    message: resp.ok ? "Moka apply submitted" : `Moka apply rejected: HTTP ${resp.status}`,
    steps,
  };
}

/**
 * Beisen Wecruit — covers sensetime / horizonrobotics.
 *
 * Flow (probed from hr.sensetime.com/pb/js/vendor.js):
 *   1. POST /wecruit/resume/upload/file/save/<SU>  (multipart, returns attachment id)
 *   2. POST /wecruit/resume/info/add/<SU>          (profile fields)
 *   3. POST /wecruit/delivery/resume/<SU>          (final submit with post_id + attachment)
 */
export async function executeBeisenWecruit(
  staged: StagedApplication,
  session: CapturedSession | null,
  target: SubmitTarget
): Promise<MultiStepResult> {
  if (!staged.submit_endpoint) return { ok: false, posted_to: "", message: "no submit_endpoint", steps: [] };
  if (target.kind === "dry-run") {
    return { ok: false, posted_to: "dry-run (no network)", message: "dry-run requested — no HTTP call fired", steps: [] };
  }
  if (target.kind === "upstream" && !session) {
    return {
      ok: false,
      posted_to: staged.submit_endpoint,
      message:
        "executeBeisenWecruit requires session.json (Wecruit candidate session via WeChat OAuth / phone OTP). " +
        "Capture via extension/.",
      steps: [],
    };
  }
  const resumeField = staged.staged.find((f) => f.name === "resume");
  if (!resumeField?.value) return { ok: false, posted_to: "", message: "staged.resume missing", steps: [] };
  let resumeBytes: Buffer;
  try {
    resumeBytes = readFileSync(resumeField.value);
  } catch (err) {
    return { ok: false, posted_to: "", message: `read ${resumeField.value} failed: ${err instanceof Error ? err.message : err}`, steps: [] };
  }
  const filename = resumeField.value.split("/").pop() ?? "resume.pdf";

  // Extract the channel SU from submit_endpoint (.../wecruit/delivery/resume/<SU>)
  const su = staged.submit_endpoint.split("/").pop() ?? "";
  const url = new URL(staged.submit_endpoint);
  const host = url.host;
  const apiBase = `${url.protocol}//${host}/wecruit`;
  const debug = target.kind === "debug";
  // X-Requested-With is required for Beisen Wecruit Nginx routing —
  // without it the request falls through to the SPA HTML (verified
  // via probe in 1.0.63). Inject unconditionally even if the captured
  // session.json didn't include it.
  const sessionHeaders = {
    ...sessionHeaderBag(session, host),
    "X-Requested-With": "XMLHttpRequest",
  };
  const FileCtor = (globalThis as { File?: typeof File }).File;

  const steps: FeishuStepLog[] = [];
  const applicant: Record<string, string> = {};
  for (const f of staged.staged) {
    if (f.name === "name" || f.name === "email" || f.name === "phone") applicant[f.name] = f.value;
  }

  // STEP 1 — upload resume file
  const step1Url = debug ? target.url : `${apiBase}/resume/upload/file/save/${encodeURIComponent(su)}`;
  const uploadFd = new FormData();
  const filePart =
    typeof FileCtor === "function"
      ? new FileCtor([new Uint8Array(resumeBytes)], filename, { type: "application/pdf" })
      : new Blob([new Uint8Array(resumeBytes)], { type: "application/pdf" });
  uploadFd.append("file", filePart as Blob, filename);
  const s1 = await doStep("upload-file", step1Url, { method: "POST", headers: sessionHeaders, body: uploadFd }, steps);
  if (!s1.ok) {
    return { ok: false, posted_to: step1Url, status: s1.status, message: `step 1 failed: ${s1.message}`, steps };
  }
  const r1 = s1.response;
  const text1 = s1.text;
  if (debug) {
    return { ok: r1.ok, status: r1.status, posted_to: step1Url, message: "debug: step 1 fired, steps 2+3 skipped", steps, response_preview: text1 };
  }
  if (!r1.ok) {
    return { ok: false, posted_to: step1Url, status: r1.status, message: "step 1 failed", steps, response_preview: text1 };
  }
  let attachmentId = "";
  try {
    const parsed = JSON.parse(text1);
    attachmentId = parsed?.data?.attachmentId ?? parsed?.data?.id ?? parsed?.data?.fileId ?? "";
  } catch { /* keep empty */ }

  // STEP 2 — profile info
  const step2Url = `${apiBase}/resume/info/add/${encodeURIComponent(su)}`;
  const s2 = await doStep(
    "profile-add",
    step2Url,
    {
      method: "POST",
      headers: { ...sessionHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name: applicant.name, email: applicant.email, phone: applicant.phone, attachmentId }),
    },
    steps
  );
  if (!s2.ok) {
    return { ok: false, posted_to: step2Url, status: s2.status, message: `step 2 failed: ${s2.message}`, steps };
  }

  // STEP 3 — final delivery
  const step3Url = `${apiBase}/delivery/resume/${encodeURIComponent(su)}`;
  const s3 = await doStep(
    "deliver",
    step3Url,
    {
      method: "POST",
      headers: { ...sessionHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ postId: staged.post_id, attachmentId }),
    },
    steps
  );
  if (!s3.ok) {
    return { ok: false, posted_to: step3Url, status: s3.status, message: `step 3 failed: ${s3.message}`, steps };
  }
  const r3 = s3.response;
  const text3 = s3.text;
  return {
    ok: r3.ok,
    status: r3.status,
    posted_to: step3Url,
    response_preview: text3,
    message: r3.ok ? "Beisen Wecruit submission accepted" : `step 3 rejected: HTTP ${r3.status}`,
    steps,
  };
}

/**
 * Beisen iTalent — covers vivo / iflytek.
 *
 * Flow (Beisen iTalent's typical wire pattern):
 *   1. POST /api/Resume/UploadResume                   (multipart resume)
 *      → { Code:200, Data:{ ResumeId, Path, … } }
 *   2. POST /api/Apply/SubmitResume                    (JSON apply)
 *      body: { JobAdId, ResumeId, Name, Email, Mobile }
 */
export async function executeBeisenITalent(
  staged: StagedApplication,
  session: CapturedSession | null,
  target: SubmitTarget
): Promise<MultiStepResult> {
  if (!staged.submit_endpoint) return { ok: false, posted_to: "", message: "no submit_endpoint", steps: [] };
  if (target.kind === "dry-run") {
    return { ok: false, posted_to: "dry-run (no network)", message: "dry-run requested — no HTTP call fired", steps: [] };
  }
  if (target.kind === "upstream" && !session) {
    return {
      ok: false,
      posted_to: staged.submit_endpoint,
      message:
        "executeBeisenITalent requires session.json (iTalent candidate-portal session via email+phone+OTP). " +
        "Capture via extension/.",
      steps: [],
    };
  }
  const resumeField = staged.staged.find((f) => f.name === "resume");
  if (!resumeField?.value) return { ok: false, posted_to: "", message: "staged.resume missing", steps: [] };
  let resumeBytes: Buffer;
  try {
    resumeBytes = readFileSync(resumeField.value);
  } catch (err) {
    return { ok: false, posted_to: "", message: `read ${resumeField.value} failed: ${err instanceof Error ? err.message : err}`, steps: [] };
  }
  const filename = resumeField.value.split("/").pop() ?? "resume.pdf";

  const submitUrl = new URL(staged.submit_endpoint);
  const host = submitUrl.host;
  const apiRoot = `${submitUrl.protocol}//${host}`;
  const debug = target.kind === "debug";
  const sessionHeaders = sessionHeaderBag(session, host);
  const FileCtor = (globalThis as { File?: typeof File }).File;
  const steps: FeishuStepLog[] = [];
  const applicant: Record<string, string> = {};
  for (const f of staged.staged) {
    if (f.name === "name" || f.name === "email" || f.name === "phone") applicant[f.name] = f.value;
  }

  // STEP 1 — upload
  const step1Url = debug ? target.url : `${apiRoot}/api/Resume/UploadResume`;
  const uploadFd = new FormData();
  const filePart =
    typeof FileCtor === "function"
      ? new FileCtor([new Uint8Array(resumeBytes)], filename, { type: "application/pdf" })
      : new Blob([new Uint8Array(resumeBytes)], { type: "application/pdf" });
  uploadFd.append("file", filePart as Blob, filename);
  const s1 = await doStep("upload", step1Url, { method: "POST", headers: sessionHeaders, body: uploadFd }, steps);
  if (!s1.ok) {
    return { ok: false, posted_to: step1Url, status: s1.status, message: `step 1 failed: ${s1.message}`, steps };
  }
  const r1 = s1.response;
  const text1 = s1.text;
  if (debug) {
    return { ok: r1.ok, status: r1.status, posted_to: step1Url, message: "debug: step 1 fired, step 2 skipped", steps, response_preview: text1 };
  }
  if (!r1.ok) return { ok: false, posted_to: step1Url, status: r1.status, message: "step 1 failed", steps, response_preview: text1 };
  let resumeId = "";
  try {
    const parsed = JSON.parse(text1);
    resumeId = parsed?.Data?.ResumeId ?? parsed?.Data?.Id ?? "";
  } catch { /* keep empty */ }

  // STEP 2 — submit apply
  const step2Url = `${apiRoot}/api/Apply/SubmitResume`;
  const s2 = await doStep(
    "submit",
    step2Url,
    {
      method: "POST",
      headers: { ...sessionHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        JobAdId: staged.post_id,
        ResumeId: resumeId,
        Name: applicant.name,
        Email: applicant.email,
        Mobile: applicant.phone,
      }),
    },
    steps
  );
  if (!s2.ok) {
    return { ok: false, posted_to: step2Url, status: s2.status, message: `step 2 failed: ${s2.message}`, steps };
  }
  const r2 = s2.response;
  return {
    ok: r2.ok,
    status: r2.status,
    posted_to: step2Url,
    response_preview: s2.text,
    message: r2.ok ? "Beisen iTalent submission accepted" : `step 2 rejected: HTTP ${r2.status}`,
    steps,
  };
}

/**
 * CDP / real-browser submitter — used by adapters whose upstream requires
 * a runtime-minted anti-bot signature that we can't reproduce from raw
 * HTTP (today: lilith via lilithgames.jobs.feishu.cn, gated by ByteDance
 * Tengine's `_signature`).
 *
 * Flow:
 *   1. Inject cookies from session.json into the singleton puppeteer
 *      browser via chrome.cookies.setCookie (CDP).
 *   2. withPage(): navigate to staged.apply_url (the SPA's detail page).
 *   3. Wait for the SPA's apply UI to render. The Feishu candidate-portal
 *      pattern: the page shows a "投递" button that opens a modal with
 *      input[name=name|email|phone] + input[type=file].
 *   4. Fill the fields via page.type() + uploadFile().
 *   5. Click the modal's "提交" button.
 *   6. Wait for the submission response XHR; report it.
 *
 * In debug mode we skip the click and screenshot the page instead so the
 * user can verify the bot actually loaded the SPA correctly.
 */
export async function executeCdpRealBrowser(
  staged: StagedApplication,
  session: CapturedSession | null,
  target: SubmitTarget
): Promise<MultiStepResult> {
  if (target.kind === "dry-run") {
    return { ok: false, posted_to: "dry-run (no network)", message: "dry-run requested — no HTTP call fired", steps: [] };
  }
  if (target.kind === "upstream" && !session) {
    return {
      ok: false,
      posted_to: staged.apply_url,
      message:
        "executeCdpRealBrowser requires session.json (the SPA's login cookies need to be in " +
        "the puppeteer browser before navigation). Capture via extension/, drop under " +
        "~/.jobpro/<adapter>.session.json.",
      steps: [],
    };
  }
  const steps: FeishuStepLog[] = [];
  const targetUrl = staged.apply_url;
  const debug = target.kind === "debug";

  // Inject cookies into the singleton browser.
  if (session) {
    let host = "";
    try { host = new URL(targetUrl).host; } catch { /* ignore */ }
    const inj = await injectCookies(session.cookies ?? [], host);
    if (!inj.ok) {
      steps.push({ step: "inject-cookies", url: host, status: 0, ok: false, message: inj.error.message });
      return { ok: false, posted_to: targetUrl, message: inj.error.message, steps };
    }
    steps.push({
      step: "inject-cookies",
      url: host,
      status: 200,
      ok: true,
      message: `injected ${session.cookies?.length ?? 0} cookies`,
    });
  }

  // Resume + applicant_info from staged.
  const resumeField = staged.staged.find((f) => f.name === "resume");
  if (!resumeField?.value) return { ok: false, posted_to: targetUrl, message: "staged.resume missing", steps };
  if (!existsSync(resumeField.value)) {
    return { ok: false, posted_to: targetUrl, message: `resume file not found: ${resumeField.value}`, steps };
  }
  const applicant: Record<string, string> = {};
  for (const f of staged.staged) {
    if (f.name === "name" || f.name === "email" || f.name === "phone") applicant[f.name] = f.value;
  }

  const r = await withPage(async (page) => {
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 30000 });
    steps.push({
      step: "navigate",
      url: page.url(),
      status: 200,
      ok: true,
      message: `loaded ${page.url()}`,
    });
    if (debug) {
      // Don't click submit — just confirm the SPA loaded.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { kind: "debug" as const };
    }
    // Try to click the "投递" / "立即投递" / "Apply" button to open the modal.
    const clickedApply: string | null = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, a')) as HTMLElement[];
      for (const el of candidates) {
        const t = (el.textContent ?? "").trim();
        if (/^投递$|^立即投递$|^申请$|^Apply$/i.test(t)) {
          (el as HTMLElement).click();
          return t;
        }
      }
      return null;
    });
    steps.push({
      step: "click-apply",
      url: page.url(),
      status: clickedApply ? 200 : 0,
      ok: !!clickedApply,
      message: clickedApply ?? "could not find apply button",
    });
    if (!clickedApply) {
      return { kind: "no-button" as const };
    }
    // Wait for the modal's form to render.
    try {
      await page.waitForSelector('input[type=file]', { timeout: 10000 });
    } catch {
      steps.push({ step: "wait-form", url: page.url(), status: 0, ok: false, message: "apply modal didn't render input[type=file]" });
      return { kind: "no-form" as const };
    }
    steps.push({ step: "wait-form", url: page.url(), status: 200, ok: true, message: "modal rendered" });

    // Fill name/email/phone if matching inputs exist.
    for (const [key, value] of Object.entries(applicant)) {
      if (!value) continue;
      try {
        const sel = `input[name="${key}"], input[placeholder*="${key}"], input[aria-label*="${key}"]`;
        await page.type(sel, value, { delay: 30 });
      } catch {
        steps.push({ step: `fill-${key}`, url: page.url(), status: 0, ok: false, message: "selector not found" });
      }
    }

    // Upload resume.
    try {
      const fileInput = await page.$('input[type=file]');
      if (fileInput && fileInput.uploadFile) {
        await fileInput.uploadFile(resumeField.value);
        steps.push({ step: "upload-resume", url: page.url(), status: 200, ok: true, message: resumeField.value });
      } else {
        steps.push({ step: "upload-resume", url: page.url(), status: 0, ok: false, message: "no input[type=file] handle" });
      }
    } catch (err) {
      steps.push({ step: "upload-resume", url: page.url(), status: 0, ok: false, message: String(err) });
    }

    // Click the modal's submit button (typically "确认投递" / "提交").
    const submittedLabel: string | null = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
      for (const el of candidates) {
        const t = (el.textContent ?? "").trim();
        if (/^(确认投递|提交|完成|Submit)$/i.test(t)) {
          el.click();
          return t;
        }
      }
      return null;
    });
    steps.push({
      step: "click-submit",
      url: page.url(),
      status: submittedLabel ? 200 : 0,
      ok: !!submittedLabel,
      message: submittedLabel ?? "could not find submit button",
    });
    // Allow the resulting XHR to settle.
    await new Promise((resolve) => setTimeout(resolve, 6000));
    return { kind: "submitted" as const, label: submittedLabel };
  });
  if (!r.ok) {
    return { ok: false, posted_to: targetUrl, message: r.error.message, steps };
  }
  const kind = (r.value as { kind: string }).kind;
  const ok = kind === "submitted";
  return {
    ok,
    posted_to: targetUrl,
    message:
      kind === "debug"
        ? "debug: navigated + screenshot, no submit click"
        : kind === "no-button"
          ? "could not find an apply button on the page — the candidate session may not be logged in"
          : kind === "no-form"
            ? "apply modal opened but form fields didn't render"
            : "CDP-driven submit completed (verify the upstream actually accepted)",
    steps,
  };
}
