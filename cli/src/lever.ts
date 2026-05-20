// Generic Lever (api.lever.co) postings adapter factory.
//
// Lever is a SaaS ATS used by many tech companies for public job boards. The
// unauthenticated REST surface is stable across tenants:
//
//   GET https://api.lever.co/v0/postings/<slug>?mode=json
//     → array of job objects (no pagination — entire board in one call)
//
//   GET https://api.lever.co/v0/postings/<slug>/<id>?mode=json
//     → full job object including the rendered description HTML
//
// All endpoints are GET-only, return JSON, and require no auth headers.
//
// ---- PositionSummary field mapping (Lever → canonical) ----
//   post_id       ← String(job.id)
//   title         ← job.text
//   project       ← job.categories.team or job.categories.department
//   recruit_label ← job.categories.commitment  (e.g. "Intern" / "Full-time")
//   bgs           ← ""  (Lever has no BG dimension)
//   work_cities   ← job.categories.location  (or join allLocations)
//   apply_url     ← job.hostedUrl  (or applyUrl)
//
// ---- Discovery notes ----
//   * Lever returns the full board in one ~200-400 KB JSON array. No pagination.
//   * Some boards include both campus and experienced postings; we filter
//     client-side by keyword / commitment / location.
//   * `categories.allLocations` is an array; we join with " / " when len > 1.

import { extractResumeSignals, scoreOverlap, checkResume } from "./tencent.js";
import type { ApplyFormSchema, ApplyQuestion } from "./apply.js";
import type { PositionScope } from "./adapter.js";
export { checkResume };

// ---------- adapter config ----------

export interface LeverAdapterConfig {
  /** Lever board slug — the `<slug>` in `/v0/postings/<slug>`. */
  slug: string;
  /** Human-readable label for source/error fields. */
  label: string;
}

// ---------- raw response types ----------

interface RawCategories {
  commitment?: string;
  location?: string;
  team?: string;
  department?: string;
  allLocations?: string[];
}

interface RawJob {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: RawCategories;
  country?: string;
  workplaceType?: string;
  createdAt?: number;
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  additionalPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
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
  /** Filter by commitment (e.g. ["Intern", "Full-time"]). Case-insensitive. */
  commitments?: string[];
  /** Filter by team/department substring(s). Case-insensitive. */
  teams?: string[];
  /** Filter by location substring(s). Case-insensitive. */
  cities?: string[];
  /** Caller-requested recruit scope. Lever boards used by Chinese tenants
   *  here are 100% experienced-hire by convention, so we accept the flag
   *  and echo it back, but do not translate it to any upstream filter. */
  scope?: PositionScope;
}

// ---------- createAdapter ----------

export function createAdapter(cfg: LeverAdapterConfig) {
  const API_LIST = `https://api.lever.co/v0/postings/${encodeURIComponent(cfg.slug)}?mode=json`;
  const API_DETAIL = (id: string) =>
    `https://api.lever.co/v0/postings/${encodeURIComponent(cfg.slug)}/${encodeURIComponent(id)}?mode=json`;
  const SOURCE = `api.lever.co/${cfg.slug}`;
  const BOARD_URL = `https://jobs.lever.co/${encodeURIComponent(cfg.slug)}`;

  const HEADERS: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json",
  };

  function summarize(job: RawJob): PositionSummary {
    const id = String(job.id ?? "");
    const cats = job.categories ?? {};
    const locs = cats.allLocations ?? [];
    const work_cities =
      locs.length > 1
        ? locs.filter(Boolean).join(" / ")
        : cats.location ?? locs[0] ?? "";
    return {
      post_id: id,
      title: job.text ?? "",
      project: cats.team ?? cats.department ?? "",
      recruit_label: cats.commitment ?? "",
      bgs: "",
      work_cities,
      apply_url: job.hostedUrl ?? job.applyUrl ?? `${BOARD_URL}/${id}`,
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
      response = await fetch(API_LIST, { headers: HEADERS });
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
    let jobs: RawJob[];
    try {
      jobs = (await response.json()) as RawJob[];
    } catch (err) {
      const msg = `bad JSON: ${err instanceof Error ? err.message : String(err)}`;
      _allCache = { ok: false, message: msg, fetchedAt: now };
      return { ok: false, message: msg };
    }
    if (!Array.isArray(jobs)) jobs = [];
    _allCache = { ok: true, jobs, fetchedAt: now };
    return { ok: true, jobs };
  }

  function applyFilters(jobs: RawJob[], opts: SearchOptions): RawJob[] {
    const kw = (opts.keyword ?? "").trim().toLowerCase();
    const commitFilters = (opts.commitments ?? []).map((s) => String(s).toLowerCase());
    const teamFilters = (opts.teams ?? []).map((s) => String(s).toLowerCase());
    const cityFilters = (opts.cities ?? []).map((s) => String(s).toLowerCase());
    return jobs.filter((job) => {
      const cats = job.categories ?? {};
      if (kw) {
        const blob = [
          job.text ?? "",
          cats.team ?? "",
          cats.department ?? "",
          cats.location ?? "",
          (cats.allLocations ?? []).join(" "),
          cats.commitment ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(kw)) return false;
      }
      if (commitFilters.length) {
        const c = (cats.commitment ?? "").toLowerCase();
        if (!commitFilters.some((f) => c.includes(f))) return false;
      }
      if (teamFilters.length) {
        const blob = `${cats.team ?? ""} ${cats.department ?? ""}`.toLowerCase();
        if (!teamFilters.some((t) => blob.includes(t))) return false;
      }
      if (cityFilters.length) {
        const blob = [
          cats.location ?? "",
          ...(cats.allLocations ?? []),
        ]
          .join(" ")
          .toLowerCase();
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
      scope: opts.scope,
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
      scope: opts.scope,
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
      response = await fetch(API_DETAIL(id), { headers: HEADERS });
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
    const sections = [job.descriptionPlain ?? ""];
    for (const list of job.lists ?? []) {
      const heading = list.text ?? "";
      const body = (list.content ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (heading || body) sections.push(`${heading}: ${body}`.trim());
    }
    sections.push(job.additionalPlain ?? "");
    const description = sections.filter(Boolean).join("\n\n").trim();
    return {
      ok: true as const,
      source: SOURCE,
      post_id: id,
      title: job.text ?? "",
      project: summary.project,
      recruit_label: summary.recruit_label,
      workplace_type: job.workplaceType ?? "",
      country: job.country ?? "",
      created_at: job.createdAt ?? 0,
      description,
      work_cities: summary.work_cities,
      apply_url: summary.apply_url,
    };
  }

  // ---------- fetchDictionaries ----------
  // Lever doesn't expose a filter catalog; synthesize from the live board.

  let _dictCache:
    | {
        ok: true;
        source: string;
        teams: string[];
        departments: string[];
        commitments: string[];
        cities: string[];
        total: number;
      }
    | { ok: false; source: string; message: string }
    | null = null;

  async function fetchDictionaries() {
    if (_dictCache !== null) return _dictCache;
    const pool = await fetchAllRaw();
    if (!pool.ok) {
      const r = { ok: false as const, source: SOURCE, message: pool.message };
      _dictCache = r;
      return r;
    }
    const teams = new Set<string>();
    const departments = new Set<string>();
    const commitments = new Set<string>();
    const cities = new Set<string>();
    for (const j of pool.jobs) {
      const c = j.categories ?? {};
      if (c.team) teams.add(c.team);
      if (c.department) departments.add(c.department);
      if (c.commitment) commitments.add(c.commitment);
      for (const loc of c.allLocations ?? []) if (loc) cities.add(loc);
      if (c.location) cities.add(c.location);
    }
    const result = {
      ok: true as const,
      source: SOURCE,
      teams: [...teams].sort(),
      departments: [...departments].sort(),
      commitments: [...commitments].sort(),
      cities: [...cities].sort(),
      total: pool.jobs.length,
    };
    _dictCache = result;
    return result;
  }

  // ---------- notices (stub) ----------

  const NOTICES_STUB = {
    ok: false as const,
    source: SOURCE,
    message: `${cfg.label}: Lever boards have no announcements endpoint`,
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
      const c = job.categories ?? {};
      const blob = [
        job.text ?? "",
        c.team ?? "",
        c.department ?? "",
        c.location ?? "",
        (c.allLocations ?? []).join(" "),
        c.commitment ?? "",
        job.descriptionPlain ?? "",
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
  // Lever's application form is rendered server-side at
  //   GET https://jobs.lever.co/<slug>/<id>/apply
  // For programmatic access, the detail endpoint `/v0/postings/<slug>/<id>?mode=json`
  // includes `customQuestions` (array of { fields, text, description }) and
  // `applyForm` metadata. The actual submission endpoint Lever exposes
  // publicly is the same apply page — they accept multipart/form-data on
  // POST to https://jobs.lever.co/<slug>/<id>/apply (the form action).
  //
  // We surface the customQuestions normalised into our ApplyFormSchema
  // shape. Every Lever board also requires the standard contact-info
  // fields (name / email / phone / resume), which we hard-code as a
  // synthesised prelude — Lever's `applyForm` describes them implicitly.

  interface LeverDetailExtra extends RawJob {
    customQuestions?: Array<{
      text?: string;
      description?: string;
      fields?: Array<{
        text?: string;
        type?: string;
        required?: boolean;
        options?: Array<{ text?: string }>;
      }>;
    }>;
    applyForm?: unknown;
  }

  async function fetchApplicationSchema(postId: string): Promise<
    { ok: true; schema: ApplyFormSchema } | { ok: false; source: string; message: string }
  > {
    const id = (postId ?? "").trim();
    if (!id) return { ok: false, source: SOURCE, message: "post_id is required" };
    let response: Response;
    try {
      response = await fetch(API_DETAIL(id), { headers: HEADERS });
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
    let job: LeverDetailExtra;
    try {
      job = (await response.json()) as LeverDetailExtra;
    } catch (err) {
      return {
        ok: false,
        source: SOURCE,
        message: `bad JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // Lever's standard contact-info block.
    const standard: ApplyQuestion[] = [
      { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
      { label: "Last Name",  required: true, fields: [{ name: "last_name",  type: "input_text" }] },
      { label: "Email",      required: true, fields: [{ name: "email",      type: "input_text" }] },
      { label: "Phone",      required: true, fields: [{ name: "phone",      type: "input_text" }] },
      { label: "Resume",     required: true, fields: [{ name: "resume",     type: "input_file" }] },
    ];
    // Custom-question fields keyed by their human label so the staging
    // step can match them via profile.custom["…"].
    const custom: ApplyQuestion[] = (job.customQuestions ?? []).flatMap((cq) =>
      (cq.fields ?? []).map((f) => ({
        label: f.text ?? cq.text ?? "",
        description: cq.description ?? null,
        required: f.required ?? false,
        fields: [
          {
            name: (f.text ?? cq.text ?? "").slice(0, 60).replace(/\s+/g, "_").toLowerCase(),
            type:
              f.type === "multiple-choice"
                ? "single_select"
                : f.type === "multi-choice"
                  ? "multi_select"
                  : f.type === "textarea"
                    ? "textarea"
                    : "input_text",
            values: (f.options ?? []).map((o) => ({ value: o.text ?? "", label: o.text ?? "" })),
          },
        ],
      }))
    );
    return {
      ok: true,
      schema: {
        source: SOURCE,
        post_id: id,
        job_title: job.text ?? "",
        apply_url: job.applyUrl ?? job.hostedUrl ?? `${BOARD_URL}/${id}/apply`,
        submit_endpoint: `${BOARD_URL}/${id}/apply`,
        submit_method: "POST",
        submit_kind: "multipart-anon",
        endpoint_verified: true,
        submit_notes:
          "Lever apply-page accepts anonymous multipart/form-data POST whose field " +
          "names match Lever's hosted apply form (standard contact-info + each " +
          "customQuestion's auto-named field).",
        questions: [...standard, ...custom],
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
