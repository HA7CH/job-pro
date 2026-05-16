// Generic Greenhouse Boards adapter factory.
//
// Greenhouse (boards-api.greenhouse.io) is a widely-used SaaS ATS. Multiple
// Chinese companies (or their international arms) self-host their public job
// board on a `<slug>` namespace there. The unauthenticated REST surface is
// stable across tenants:
//
//   GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs
//     → { jobs: [...], meta: { total: <int> } }
//
//   GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs/<id>?content=true
//     → full job object including the rendered description HTML
//
//   GET https://boards-api.greenhouse.io/v1/boards/<slug>/departments
//     → { departments: [{ id, name, child_ids[], parent_id }] }
//
//   GET https://boards-api.greenhouse.io/v1/boards/<slug>/offices
//     → { offices: [{ id, name, location, child_ids[], parent_id }] }
//
// All endpoints are GET-only, return JSON, and require no auth headers.
//
// ---- PositionSummary field mapping (Greenhouse → canonical) ----
//   post_id       ← String(job.id)
//   title         ← job.title
//   project       ← job.departments[0]?.name (or "")
//   recruit_label ← job.metadata where name matches "Employment Type" (else "")
//   bgs           ← ""  (Greenhouse has no BG dimension)
//   work_cities   ← job.location.name
//   apply_url     ← job.absolute_url
//
// ---- Discovery notes ----
//   * Greenhouse returns the full job list in a single call — no pagination is
//     required for ATS sizes seen so far (<2000 jobs).
//   * The `meta.total` field is always present.
//   * `content=true` on the detail endpoint returns description as escaped HTML.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { ApplyFormSchema, ApplyQuestion } from "./apply.js";
export { checkResume };

// ---------- adapter config ----------

export interface GreenhouseAdapterConfig {
  /** Greenhouse board slug — the `<slug>` in `/v1/boards/<slug>/jobs`. */
  slug: string;
  /** Human-readable label for source/error fields. */
  label: string;
}

// ---------- raw response types ----------

interface RawLocation {
  name?: string;
}

interface RawDepartment {
  id?: number;
  name?: string;
  child_ids?: number[];
  parent_id?: number | null;
}

interface RawOffice {
  id?: number;
  name?: string;
  location?: string;
  child_ids?: number[];
  parent_id?: number | null;
}

interface RawMetadata {
  id?: number;
  name?: string;
  value?: string | number | null;
  value_type?: string;
}

interface RawJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: RawLocation;
  offices?: RawOffice[];
  departments?: RawDepartment[];
  metadata?: RawMetadata[] | null;
  updated_at?: string;
  first_published?: string;
  requisition_id?: string;
  content?: string;
  company_name?: string;
}

interface RawJobsResponse {
  jobs?: RawJob[];
  meta?: { total?: number };
}

// ---------- PositionSummary (canonical) ----------

export interface PositionSummary {
  post_id: string;
  title: string;
  project: string;
  recruit_label: string;
  bgs: string;
  work_cities: string;
  apply_url: string;
}

// ---------- SearchOptions ----------

export interface SearchOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** Department names or IDs to filter by (case-insensitive substring on name). */
  departments?: string[];
  /** Office/location substring to filter by (case-insensitive). */
  cities?: string[];
}

// ---------- createAdapter ----------

export function createAdapter(cfg: GreenhouseAdapterConfig) {
  const API_ROOT = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(cfg.slug)}`;
  const SOURCE = `boards-api.greenhouse.io/${cfg.slug}`;
  const BOARD_URL = `https://job-boards.greenhouse.io/${encodeURIComponent(cfg.slug)}`;

  const HEADERS: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json",
  };

  function summarize(job: RawJob): PositionSummary {
    const id = String(job.id ?? "");
    const dept = job.departments?.[0]?.name ?? "";
    const employmentType =
      (job.metadata ?? []).find(
        (m) => (m.name ?? "").toLowerCase() === "employment type"
      )?.value;
    const recruit_label =
      typeof employmentType === "string" ? employmentType : "";
    return {
      post_id: id,
      title: job.title ?? "",
      project: dept,
      recruit_label,
      bgs: "",
      work_cities: job.location?.name ?? "",
      apply_url: job.absolute_url ?? `${BOARD_URL}/jobs/${id}`,
    };
  }

  let _allCache: { ok: true; jobs: RawJob[]; fetchedAt: number } | { ok: false; message: string; fetchedAt: number } | null = null;

  async function fetchAllRaw(): Promise<
    { ok: true; jobs: RawJob[] } | { ok: false; message: string }
  > {
    const now = Date.now();
    if (_allCache && now - _allCache.fetchedAt < 5 * 60 * 1000) {
      return _allCache.ok ? { ok: true, jobs: _allCache.jobs } : { ok: false, message: _allCache.message };
    }
    let response: Response;
    try {
      response = await fetch(`${API_ROOT}/jobs?content=false`, { headers: HEADERS });
    } catch (err) {
      const msg = `network error: ${err instanceof Error ? err.message : String(err)}`;
      _allCache = { ok: false, message: msg, fetchedAt: now };
      return { ok: false, message: msg };
    }
    if (!response.ok) {
      const msg = `HTTP ${response.status}: ${response.statusText}`;
      _allCache = { ok: false, message: msg, fetchedAt: now };
      return { ok: false, message: msg };
    }
    let payload: RawJobsResponse;
    try {
      payload = (await response.json()) as RawJobsResponse;
    } catch (err) {
      const msg = `bad JSON: ${err instanceof Error ? err.message : String(err)}`;
      _allCache = { ok: false, message: msg, fetchedAt: now };
      return { ok: false, message: msg };
    }
    const jobs = payload.jobs ?? [];
    _allCache = { ok: true, jobs, fetchedAt: now };
    return { ok: true, jobs };
  }

  function applyFilters(jobs: RawJob[], opts: SearchOptions): RawJob[] {
    const kw = (opts.keyword ?? "").trim().toLowerCase();
    const deptFilters = (opts.departments ?? []).map((s) => String(s).toLowerCase());
    const cityFilters = (opts.cities ?? []).map((s) => String(s).toLowerCase());
    return jobs.filter((job) => {
      if (kw) {
        const blob = [
          job.title ?? "",
          job.location?.name ?? "",
          (job.departments ?? []).map((d) => d.name).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(kw)) return false;
      }
      if (deptFilters.length) {
        const blob = (job.departments ?? [])
          .map((d) => (d.name ?? "").toLowerCase())
          .join(" ");
        if (!deptFilters.some((d) => blob.includes(d))) return false;
      }
      if (cityFilters.length) {
        const blob = (job.location?.name ?? "").toLowerCase();
        if (!cityFilters.some((c) => blob.includes(c))) return false;
      }
      return true;
    });
  }

  async function searchPositions(opts: SearchOptions = {}) {
    const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 20));
    const page = Math.max(1, opts.page ?? 1);

    const pool = await fetchAllRaw();
    if (!pool.ok) {
      return {
        ok: false as const,
        message: pool.message,
        source: SOURCE,
        apply_url: BOARD_URL,
        positions: [] as PositionSummary[],
      };
    }
    const filtered = applyFilters(pool.jobs, opts);
    const offset = (page - 1) * pageSize;
    const paginated = filtered.slice(offset, offset + pageSize);
    return {
      ok: true as const,
      source: SOURCE,
      query: opts,
      page,
      page_size: pageSize,
      total: filtered.length,
      positions: paginated.map(summarize),
    };
  }

  async function fetchAllPositions(opts: SearchOptions & { maxPages?: number } = {}) {
    const pool = await fetchAllRaw();
    if (!pool.ok) {
      return {
        ok: false as const,
        message: pool.message,
        source: SOURCE,
        apply_url: BOARD_URL,
        fetched: 0,
        positions: [] as PositionSummary[],
      };
    }
    const filtered = applyFilters(pool.jobs, opts);
    return {
      ok: true as const,
      source: SOURCE,
      total: filtered.length,
      fetched: filtered.length,
      positions: filtered.map(summarize),
    };
  }

  async function fetchPositionDetail(postId: string) {
    const id = (postId ?? "").trim();
    if (!id) {
      return { ok: false as const, source: SOURCE, message: "post_id is required" };
    }
    let response: Response;
    try {
      response = await fetch(
        `${API_ROOT}/jobs/${encodeURIComponent(id)}?content=true`,
        { headers: HEADERS }
      );
    } catch (err) {
      return {
        ok: false as const,
        source: SOURCE,
        post_id: id,
        message: `network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!response.ok) {
      return {
        ok: false as const,
        source: SOURCE,
        post_id: id,
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    let job: RawJob;
    try {
      job = (await response.json()) as RawJob;
    } catch (err) {
      return {
        ok: false as const,
        source: SOURCE,
        post_id: id,
        message: `bad JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const summary = summarize(job);
    const html = job.content ?? "";
    // Crude HTML-to-text: decode common entities, strip tags.
    const description = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return {
      ok: true as const,
      source: SOURCE,
      post_id: id,
      title: job.title ?? "",
      project: summary.project,
      recruit_label: summary.recruit_label,
      requisition_id: job.requisition_id ?? "",
      first_published: job.first_published ?? "",
      updated_at: job.updated_at ?? "",
      description,
      work_cities: job.location?.name ?? "",
      apply_url: summary.apply_url,
    };
  }

  // ---------- fetchDictionaries ----------

  let _dictCache:
    | {
        ok: true;
        source: string;
        departments: Array<{ id: number; name: string; parent_id: number | null }>;
        offices: Array<{ id: number; name: string; location: string; parent_id: number | null }>;
      }
    | { ok: false; source: string; message: string }
    | null = null;

  async function fetchDictionaries() {
    if (_dictCache !== null) return _dictCache;
    try {
      const [deptRes, offRes] = await Promise.all([
        fetch(`${API_ROOT}/departments`, { headers: HEADERS }),
        fetch(`${API_ROOT}/offices`, { headers: HEADERS }),
      ]);
      if (!deptRes.ok && !offRes.ok) {
        const r = {
          ok: false as const,
          source: SOURCE,
          message: `HTTP ${deptRes.status}/${offRes.status}`,
        };
        _dictCache = r;
        return r;
      }
      const deptJson = deptRes.ok
        ? ((await deptRes.json()) as { departments?: RawDepartment[] })
        : { departments: [] };
      const offJson = offRes.ok
        ? ((await offRes.json()) as { offices?: RawOffice[] })
        : { offices: [] };
      const result = {
        ok: true as const,
        source: SOURCE,
        departments: (deptJson.departments ?? []).map((d) => ({
          id: d.id ?? 0,
          name: d.name ?? "",
          parent_id: d.parent_id ?? null,
        })),
        offices: (offJson.offices ?? []).map((o) => ({
          id: o.id ?? 0,
          name: o.name ?? "",
          location: o.location ?? "",
          parent_id: o.parent_id ?? null,
        })),
      };
      _dictCache = result;
      return result;
    } catch (err) {
      const r = {
        ok: false as const,
        source: SOURCE,
        message: `network error: ${err instanceof Error ? err.message : String(err)}`,
      };
      _dictCache = r;
      return r;
    }
  }

  // ---------- notices (stub) ----------

  const NOTICES_STUB = {
    ok: false as const,
    source: SOURCE,
    message: `${cfg.label}: Greenhouse boards have no announcements endpoint`,
  };

  async function listNotices(): Promise<typeof NOTICES_STUB> {
    return NOTICES_STUB;
  }

  async function getNotice(
    _id: string
  ): Promise<{ ok: false; source: string; message: string }> {
    return NOTICES_STUB;
  }

  async function findNoticesByQuestion(
    _question: string,
    _opts: { questionTime?: string; topK?: number } = {}
  ): Promise<{ ok: false; source: string; message: string }> {
    return NOTICES_STUB;
  }

  // ---------- matchResume ----------

  async function matchResume(
    text: string,
    opts: { topN?: number; candidates?: number } = {}
  ) {
    const topN = Math.max(1, opts.topN ?? 5);
    const candidates = Math.max(topN, opts.candidates ?? 20);
    const { terms, cities } = extractResumeSignals(text ?? "");

    if (!terms.length) {
      return {
        ok: false as const,
        source: SOURCE,
        message: "could not extract any technical signals from the text",
        preview: (text ?? "").slice(0, 120),
      };
    }

    const pool = await fetchAllRaw();
    if (!pool.ok) {
      return { ok: false as const, source: SOURCE, message: pool.message, positions: [] };
    }

    type Scored = { score: number; raw: RawJob; reasons: string[] };
    const scored: Scored[] = [];

    for (const job of pool.jobs) {
      const blob = [
        job.title ?? "",
        job.location?.name ?? "",
        (job.departments ?? []).map((d) => d.name).join(" "),
      ].join(" ");
      const { score, reasons } = scoreOverlap(blob, terms, cities);
      if (score > 0) scored.push({ score, raw: job, reasons });
    }
    scored.sort((a, b) => b.score - a.score);

    let shortlist = scored.slice(0, Math.max(topN, candidates));
    if (!shortlist.length) {
      shortlist = pool.jobs.slice(0, candidates).map((raw) => ({
        score: 0,
        raw,
        reasons: [],
      }));
    }

    const matches = shortlist.slice(0, topN).map((s) => {
      const mr =
        s.reasons.length > 0
          ? s.reasons.slice(0, 5)
          : ["no specific keyword overlap — surfaced from full board listing"];
      return { ...summarize(s.raw), match_reasons: mr };
    });

    return {
      ok: true as const,
      source: SOURCE,
      extracted_terms: terms,
      city_preferences: cities,
      matches,
      note:
        "match_reasons surfaces overlapping keywords, not a probability of getting an interview. " +
        "The only authority on selection is HR.",
    };
  }

  // ---------- fetchApplicationSchema (Phase 2) ----------
  //
  // Greenhouse boards expose the full question schema at
  //   GET /v1/boards/<slug>/jobs/<id>?questions=true
  // The submission endpoint (per Greenhouse Job Board API docs) is
  //   POST /v1/boards/<slug>/jobs/<id>
  // with multipart/form-data body whose keys match the `name` fields
  // returned in the schema. We surface both here; actual submission is
  // gated behind the `--really-submit` guard in the dispatcher.
  //
  // Type adapter: Greenhouse's wire format is identical to our internal
  // ApplyFormSchema except some `values` arrays come back as `{ value, label }`
  // objects already, so it's a clean mapping.

  interface GreenhouseRawQuestion {
    description?: string | null;
    label?: string;
    required?: boolean;
    fields?: Array<{
      name?: string;
      type?: string;
      values?: Array<{ value?: string; label?: string }>;
    }>;
  }

  interface GreenhouseJobDetail extends RawJob {
    questions?: GreenhouseRawQuestion[];
  }

  async function fetchApplicationSchema(postId: string): Promise<
    { ok: true; schema: ApplyFormSchema } | { ok: false; source: string; message: string }
  > {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false, source: SOURCE, message: "post_id is required" };
    const url = `${API_ROOT}/jobs/${encodeURIComponent(id)}?questions=true`;
    let response: Response;
    try {
      response = await fetch(url, { headers: HEADERS });
    } catch (err) {
      return {
        ok: false,
        source: SOURCE,
        message: `network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        source: SOURCE,
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    let job: GreenhouseJobDetail;
    try {
      job = (await response.json()) as GreenhouseJobDetail;
    } catch (err) {
      return {
        ok: false,
        source: SOURCE,
        message: `bad JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const questions: ApplyQuestion[] = (job.questions ?? []).map((q) => ({
      label: q.label ?? "",
      description: q.description ?? null,
      required: q.required ?? false,
      fields: (q.fields ?? []).map((f) => ({
        name: f.name ?? "",
        type: f.type ?? "input_text",
        values: (f.values ?? []).map((v) => ({ value: v.value ?? "", label: v.label ?? "" })),
      })),
    }));
    return {
      ok: true,
      schema: {
        source: SOURCE,
        post_id: id,
        job_title: job.title ?? "",
        apply_url: job.absolute_url ?? `${BOARD_URL}/jobs/${id}`,
        submit_endpoint: `${API_ROOT}/jobs/${encodeURIComponent(id)}`,
        submit_method: "POST",
        submit_kind: "multipart-anon",
        endpoint_verified: true,
        submit_notes:
          "Greenhouse Job Board API accepts anonymous multipart/form-data POSTs " +
          "whose field names match the questions[].fields[].name returned here.",
        questions,
      },
    };
  }

  return {
    searchPositions,
    fetchAllPositions,
    fetchPositionDetail,
    fetchDictionaries,
    listNotices,
    getNotice,
    findNoticesByQuestion,
    matchResume,
    checkResume,
    fetchApplicationSchema,
  };
}
