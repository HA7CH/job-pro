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

import { readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

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

  let response: Response;
  try {
    response = await fetch(url, {
      method: staged.submit_method ?? "POST",
      headers,
      body: fd,
    });
  } catch (err) {
    return {
      ok: false,
      posted_to: url,
      message: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
