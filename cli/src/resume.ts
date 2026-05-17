// Resume input parsing — dispatches by file extension to extract plain text
// from .docx / .pdf / .json / .txt-or-.md, so `matchResume` and `checkResume`
// don't have to care about format.
//
// Why this lives outside tencent.ts: it's a transport concern (file → text),
// not a matching concern. Keeps the matcher pure.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { execFileSync } from "node:child_process";

export type ResumeSource = "docx" | "pdf" | "json" | "text";

export interface ParsedResume {
  text: string;
  source: ResumeSource;
  path: string;
}

export async function readResumeFromPath(path: string): Promise<ParsedResume> {
  const ext = extname(path).toLowerCase();

  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path });
    return { text: result.value, source: "docx", path };
  }

  if (ext === ".pdf") {
    // Real-world PDFs come from Word/Pages/online tools and exhibit many
    // failure modes: corrupt XRef tables, fillable AcroForm fields,
    // linearization, embedded fonts, etc. Different extractors handle
    // different subsets. Running both in parallel and picking whichever
    // yielded more substantive text is the most reliable strategy short
    // of OCR.
    //
    // Observed: pdf-parse silently returns only section headers (~500
    // chars of whitespace + "PERSONAL SUMMARY") on a Word-exported PDF
    // where pdftotext extracts the full content (~3KB). Length-based
    // selection catches that.
    const [pdfParseText, popplerText] = await Promise.all([
      tryPdfParse(path),
      Promise.resolve(tryPdftotext(path)),
    ]);
    const a = (pdfParseText ?? "").trim();
    const b = (popplerText ?? "").trim();
    if (!a && !b) {
      throw new Error(
        `failed to extract any text from ${path}. pdf-parse couldn't read ` +
          `the PDF (often a malformed XRef table or unusual structure), and ` +
          `pdftotext from poppler-utils is either not installed or also ` +
          `failed. Install poppler (\`brew install poppler\` on macOS, ` +
          `\`apt install poppler-utils\` on Linux) for better PDF support, ` +
          `or re-export the resume from Word/Pages as a standard PDF.`
      );
    }
    // Pick the more substantive extraction. Ties go to poppler (industry
    // standard, generally better quality on edge cases).
    const winner = b.length >= a.length ? b : a;
    return { text: winner, source: "pdf", path };
  }

  if (ext === ".json") {
    const raw = readFileSync(path, "utf8");
    return { text: flattenJsonResume(raw), source: "json", path };
  }

  // .txt / .md / unknown → read raw
  const text = readFileSync(path, "utf8");
  return { text, source: "text", path };
}

// Turn a JSON resume into plain text suitable for the matcher. Recognizes
// two common shapes and falls back to a generic string-leaf walk for the
// rest:
//   - HA7CH/Xihang shape: header.tagline + experience[].bullets + projects[].bullets + skills[].items
//   - jsonresume.org standard: basics.summary + work[].highlights + skills[].keywords
function flattenJsonResume(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw; // not valid JSON — pass through as raw text
  }
  if (!data || typeof data !== "object") return raw;
  const d = data as Record<string, unknown>;

  const parts: string[] = [];

  // header / basics / personal — taglines and summaries
  const header = d.header as Record<string, unknown> | undefined;
  if (header?.tagline) parts.push(String(header.tagline));
  if (header?.name) parts.push(String(header.name));
  const basics = d.basics as Record<string, unknown> | undefined;
  if (basics?.summary) parts.push(String(basics.summary));
  if (basics?.label) parts.push(String(basics.label));

  // experience / work
  for (const key of ["experience", "work", "jobs"]) {
    const arr = d[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      if (it.role) parts.push(String(it.role));
      if (it.position) parts.push(String(it.position));
      if (it.company) parts.push(String(it.company));
      if (it.name) parts.push(String(it.name));
      if (it.summary) parts.push(String(it.summary));
      const bullets = it.bullets ?? it.highlights ?? it.responsibilities;
      if (Array.isArray(bullets)) parts.push(...bullets.map(String));
      const tags = it.tags ?? it.keywords;
      if (Array.isArray(tags)) parts.push(...tags.map(String));
    }
  }

  // projects
  for (const key of ["projectsDetailed", "projects"]) {
    const arr = d[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      if (it.title) parts.push(String(it.title));
      if (it.name) parts.push(String(it.name));
      if (it.description) parts.push(String(it.description));
      const bullets = it.bullets ?? it.highlights;
      if (Array.isArray(bullets)) parts.push(...bullets.map(String));
      const tags = it.tags ?? it.keywords;
      if (Array.isArray(tags)) parts.push(...tags.map(String));
    }
  }

  // skills — both {name, items[]} and {name, keywords[]} shapes
  const skills = d.skills;
  if (Array.isArray(skills)) {
    for (const s of skills) {
      if (!s || typeof s !== "object") continue;
      const sk = s as Record<string, unknown>;
      if (sk.name) parts.push(String(sk.name));
      const items = sk.items ?? sk.keywords;
      if (Array.isArray(items)) parts.push(...items.map(String));
    }
  }

  // education
  const edu = d.education;
  if (Array.isArray(edu)) {
    for (const e of edu) {
      if (!e || typeof e !== "object") continue;
      const ed = e as Record<string, unknown>;
      if (ed.school) parts.push(String(ed.school));
      if (ed.institution) parts.push(String(ed.institution));
      if (ed.major) parts.push(String(ed.major));
      if (ed.area) parts.push(String(ed.area));
      if (ed.degree) parts.push(String(ed.degree));
      if (ed.studyType) parts.push(String(ed.studyType));
    }
  }

  // If we captured nothing structured, fall back to a generic walk of all
  // string leaves (covers ad-hoc shapes).
  if (parts.length === 0) {
    walkStrings(d, parts);
  }

  return parts.join("\n");
}

// Shell out to poppler's pdftotext. Returns null if pdftotext isn't on PATH
// or fails for any other reason. poppler auto-reconstructs malformed XRef
// tables and handles fillable form fields that pdf-parse misses.
function tryPdftotext(path: string): string | null {
  try {
    const out = execFileSync("pdftotext", [path, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out && out.trim().length > 0 ? out : null;
  } catch {
    return null;
  }
}

// pdf-parse extractor wrapped to return null on any failure (so the caller
// can race it with poppler without try/catch noise).
async function tryPdfParse(path: string): Promise<string | null> {
  try {
    const pdfMod: { default: (b: Buffer) => Promise<{ text: string }> } =
      await import("pdf-parse");
    const result = await pdfMod.default(readFileSync(path));
    return result.text && result.text.trim().length > 0 ? result.text : null;
  } catch {
    return null;
  }
}

function walkStrings(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    if (node.length > 0 && node.length < 2000) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) walkStrings(v, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node)) walkStrings(v, out);
  }
}
