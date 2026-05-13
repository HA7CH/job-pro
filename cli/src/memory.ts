// Tiny JSON-backed key/value + event log, stored at $JOBPRO_HOME/tencent-memory.json
// (defaults to ~/.jobpro/). Intentionally schema-loose so future companies
// can share the same file with their own namespaced keys.

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface MemoryFile {
  fields: Record<string, string>;
  events: Array<{ ts: string; kind: string; payload: string }>;
}

function memoryPath(): string {
  const base = process.env.JOBPRO_HOME ?? join(homedir(), ".jobpro");
  mkdirSync(base, { recursive: true });
  return join(base, "tencent-memory.json");
}

function load(): MemoryFile {
  const path = memoryPath();
  if (!existsSync(path)) return { fields: {}, events: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      fields: raw.fields ?? {},
      events: raw.events ?? [],
    };
  } catch {
    return { fields: {}, events: [] };
  }
}

function save(data: MemoryFile) {
  writeFileSync(memoryPath(), JSON.stringify(data, null, 2), "utf8");
}

export function memoryList() {
  return { ok: true, path: memoryPath(), ...load() };
}

export function memoryGet(key: string) {
  return { ok: true, key, value: load().fields[key] };
}

export function memorySet(pairs: string[]) {
  if (!pairs.length) {
    return { ok: false, message: "no key=value pairs provided" };
  }
  const data = load();
  const applied: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0) {
      return { ok: false, message: `expected key=value, got: ${JSON.stringify(pair)}` };
    }
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1);
    if (!key) {
      return { ok: false, message: `empty key in ${JSON.stringify(pair)}` };
    }
    data.fields[key] = value;
    applied[key] = value;
  }
  save(data);
  return { ok: true, applied, path: memoryPath() };
}

export function memoryEvent(kind: string, payload = "") {
  if (!kind) return { ok: false, message: "event kind is required" };
  const data = load();
  const entry = {
    ts: new Date().toISOString().slice(0, 19),
    kind,
    payload,
  };
  data.events.push(entry);
  save(data);
  return { ok: true, event: entry, total_events: data.events.length };
}

export function memoryClear() {
  const path = memoryPath();
  if (existsSync(path)) rmSync(path);
  return { ok: true, path, message: "memory cleared" };
}
