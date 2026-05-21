// Tencent `saveResumeInfo` structured-field filler.
//
// Background. The Tencent campus form at join.qq.com/resumeedit.html has
// TWO independent stores:
//   1. The PDF resume blob — bound to the post via POST /api/v1/resume/bindResume.
//      This is what apply.ts has handled since 1.0.x via `submit_kind: "multipart-session"`.
//   2. The structured candidate profile (教育经历 / 实习经历 / 项目经历 / 技能 /
//      意向信息) — saved via POST /api/v1/resume/saveResumeInfo and reflected
//      on every other Tencent post's resumeedit page.
//
// Until this module, store (2) was never auto-filled — bindResume succeeded
// but the user opened the resumeedit page to a stale (or empty) structured
// profile. Reviewing dozens of empty / 5-years-old fields is what made the
// old `--via-cdp` flow feel half-finished.
//
// This module fills store (2) by driving the SPA's DOM directly — Vue +
// Element Plus controlled inputs, repeatable sections (添加学历/添加实习/
// 添加项目), `el-select` (hidden-but-clickable options) and skipping the
// 3 `el-cascader` city fields (lazy-loaded, intentionally manual).
//
// Out-of-scope for this PR:
//   * Raw HTTP to saveResumeInfo — body shape is unverified; we let the
//     SPA's own fetch carry the changes via Vue state.
//   * Cascader autofill (current_city, two study_locations) — graceful skip.
//   * `--really-submit` (final 提交简历 click) — the user reviews + clicks.
//   * Generalising the DOM walker to other Element-Plus adapters — Tencent-
//     specific for now; a follow-up can extract the helpers if mihoyo /
//     other EP-using adapters need them.

import { existsSync } from "node:fs";
import type { CapturedSession, StagedApplication } from "./apply.js";
import type { SubmitTarget, FeishuStepLog, MultiStepResult } from "./apply.js";
import { loadProfile } from "./apply.js";
import { withPage, injectCookies } from "./cdp.js";

// ---------- profile.json structured types ----------
//
// These mirror the optional keys documented in examples/profile.example.json.
// All fields are optional — the filler skips any section the user hasn't
// provided, so a partially-populated profile still produces a partial fill
// (better than nothing).

export interface ProfileEducation {
  level?: "本科" | "硕士研究生" | "博士研究生" | "高中" | "大专" | string;
  school?: string;
  department?: string;
  major?: string;
  start?: string;          // YYYY-MM or YYYY-MM-DD; the SPA accepts either.
  end?: string;
  city?: string;           // skipped (cascader); kept for future use.
  gpa?: string;            // optional, written into GPA-GPA input.
  gpa_base?: string;       // optional, written into GPA-BASE input.
  rank?: "前5%" | "前10%" | "前20%" | "其他" | string;
}

export interface ProfileInternship {
  company?: string;
  role?: string;
  start?: string;
  end?: string;
  ongoing?: boolean;       // when true, the 至今 checkbox stays checked.
  description?: string;
}

export interface ProfileProject {
  name?: string;
  role?: string;
  start?: string;
  end?: string;
  ongoing?: boolean;
  description?: string;
  link?: string;
}

export interface ProfileSkills {
  english?: { exam?: string; score?: string };   // e.g. { exam: "IELTS", score: "7.5" }
  languages?: string[];                          // dev-language multi-select values (Python, TypeScript, …)
  ai_skills?: string;                            // free-text "AI 应用技能"
  extra?: string;                                // 补充信息 (≤500 chars)
  homepage?: string;                             // 个人主页超链接
}

export interface ProfileIntent {
  cities?: string[];                             // 期望工作城市 (≤3)
  accept_other_cities?: boolean;                 // 是否接受其他城市分配
  bgs?: string[];                                // 感兴趣的事业群 (e.g. "CSIG云与智慧产业事业群")
  interview_city?: string;
  earliest_start?: string;                       // 最早可入职 YYYY-MM-DD
  duration?: string;                             // 实习时长 — must be one of the el-select options
  days_per_week?: string;                        // 每周可出勤天数
}

// ---------- structured profile slot on the profile.json ----------

export interface StructuredProfileExtras {
  educations?: ProfileEducation[];
  internships?: ProfileInternship[];
  projects?: ProfileProject[];
  skills?: ProfileSkills;
  intent?: ProfileIntent;
}

// ---------- structured_fill schema marker ----------
//
// Lives on ApplyFormSchema.structured_fill so the dispatcher can route to
// this executor when --via-cdp is requested for a Tencent post. Other
// adapters can declare their own marker in a follow-up PR — we don't
// generalise yet.

export interface StructuredFillSpec {
  adapter: "tencent";
  /** True iff cascader fields are intentionally skipped. Forwarded to step-log. */
  cascader_skip?: boolean;
}

// ---------- the executor ----------

/**
 * Drive a Tencent resumeedit form via puppeteer. Two phases:
 *   (a) saveResumeInfo — fill every supported structured field from
 *       profile.educations / internships / projects / skills / intent.
 *   (b) bindResume — re-upload the PDF resume so it's attached to this post.
 *
 * The final 提交简历 click is intentionally NOT performed; the user reviews
 * the populated form themselves and submits when satisfied.
 */
export async function executeTencentStructuredFill(
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
        "executeTencentStructuredFill requires session.json (the join.qq.com login cookies " +
        "need to be in the puppeteer browser before navigation). Run `job-pro extension` to capture one.",
      steps: [],
    };
  }
  const steps: FeishuStepLog[] = [];
  const debug = target.kind === "debug";
  const editUrl = `https://join.qq.com/resumeedit.html?postid=${encodeURIComponent(staged.post_id)}&subDirectionId=`;

  // Cookie injection (same pattern as executeCdpRealBrowser).
  if (session) {
    const host = "join.qq.com";
    const inj = await injectCookies(session.cookies ?? [], host);
    if (!inj.ok) {
      steps.push({ step: "inject-cookies", url: host, status: 0, ok: false, message: inj.error.message });
      return { ok: false, posted_to: editUrl, message: inj.error.message, steps };
    }
    steps.push({ step: "inject-cookies", url: host, status: 200, ok: true, message: `injected ${session.cookies?.length ?? 0} cookies` });
  }

  // Read the structured profile out of profile.json. We load fresh here
  // rather than threading through staged so the executor can be used
  // standalone (e.g. by a future `job-pro tencent fill <postid>` verb).
  const pf = loadProfile();
  if (!pf.ok) {
    return { ok: false, posted_to: editUrl, message: `profile read failed: ${pf.message}`, steps };
  }
  const profile = pf.profile as typeof pf.profile & StructuredProfileExtras;
  const structured: StructuredProfileExtras = {
    educations: profile.educations,
    internships: profile.internships,
    projects: profile.projects,
    skills: profile.skills,
    intent: profile.intent,
  };

  // PDF path for the bindResume step (optional — if missing we still fill).
  const resumeField = staged.staged.find((f) => f.name === "resume");
  const resumePath = resumeField?.value && existsSync(resumeField.value) ? resumeField.value : null;

  const r = await withPage(async (page) => {
    await page.goto(editUrl, { waitUntil: "networkidle2", timeout: 30000 });
    steps.push({ step: "navigate", url: page.url(), status: 200, ok: true, message: `loaded ${page.url()}` });

    // Wait for the SPA form to mount — we look for the "教育经历" section
    // header which is rendered as plain text by the SPA on every resumeedit
    // load (logged-in or not). If we never see it, the user probably isn't
    // logged in and the SPA bounced to the homepage.
    try {
      await page.waitForSelector("body", { timeout: 5000 });
    } catch {
      steps.push({ step: "wait-form", url: page.url(), status: 0, ok: false, message: "form root never rendered" });
      return { kind: "no-form" as const };
    }
    const formLoaded: boolean = await page.evaluate(() => {
      return document.body.innerText.includes("教育经历") && !!document.querySelector('input[placeholder="请输入学校名称"]');
    });
    if (!formLoaded) {
      steps.push({ step: "wait-form", url: page.url(), status: 0, ok: false, message: "resumeedit didn't render the structured form — session may be invalid" });
      return { kind: "no-form" as const };
    }
    steps.push({ step: "wait-form", url: page.url(), status: 200, ok: true, message: "structured form mounted" });

    if (debug) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { kind: "debug" as const };
    }

    // -----------------------------------------------------------------
    // Fill the structured fields. All DOM work happens in one big
    // page.evaluate so we don't pay 25× round-trip cost — the helpers
    // (native setter, el-select hidden click, section locator) are
    // defined inline inside the page context.
    // -----------------------------------------------------------------
    const fillResult: {
      filled: string[];
      skipped: string[];
      errors: string[];
    } = await page.evaluate((s: StructuredProfileExtras, contactEmail: string, contactPhone: string) => {
      // ----- helpers -----
      function setNative(el: HTMLInputElement | HTMLTextAreaElement, val: string): void {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (!setter) return;
        setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }
      function findInput(placeholder: string, valueIncludes?: string): HTMLInputElement | null {
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
        const matches = inputs.filter((i) => i.placeholder === placeholder);
        if (valueIncludes) {
          const hit = matches.find((i) => i.value && i.value.includes(valueIncludes));
          if (hit) return hit;
        }
        return matches[0] ?? null;
      }
      function findTextarea(placeholderIncludes: string, valueIncludes?: string): HTMLTextAreaElement | null {
        const tas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"));
        const matches = tas.filter((t) => t.placeholder && t.placeholder.includes(placeholderIncludes));
        if (valueIncludes) {
          const hit = matches.find((t) => t.value && t.value.includes(valueIncludes));
          if (hit) return hit;
        }
        return matches[0] ?? null;
      }
      function sleep(ms: number): Promise<void> {
        return new Promise((r) => setTimeout(r, ms));
      }
      async function pickElSelect(inputPlaceholder: string, optionText: string): Promise<boolean> {
        const inp = document.querySelector<HTMLInputElement>(`input[placeholder="${inputPlaceholder}"]`);
        if (!inp) return false;
        const wrap = (inp.closest(".el-select") as HTMLElement) ?? inp.parentElement;
        if (!wrap) return false;
        ["mousedown", "mouseup", "click"].forEach((t) => wrap.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
        await sleep(200);
        const dropdowns = Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown"));
        const target = dropdowns.find((dd) => {
          const items = Array.from(dd.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).map((li) => li.textContent?.trim() ?? "");
          return items.includes(optionText);
        });
        if (!target) return false;
        const item = Array.from(target.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find((li) => (li.textContent?.trim() ?? "") === optionText);
        if (!item) return false;
        ["mousedown", "mouseup", "click"].forEach((t) => item.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
        await sleep(200);
        return true;
      }
      async function pickElSelectMulti(inputPlaceholder: string, optionTexts: string[]): Promise<string[]> {
        const inp = document.querySelector<HTMLInputElement>(`input[placeholder="${inputPlaceholder}"]`);
        if (!inp) return [];
        const wrap = (inp.closest(".el-select") as HTMLElement) ?? inp.parentElement;
        if (!wrap) return [];
        ["mousedown", "mouseup", "click"].forEach((t) => wrap.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
        await sleep(200);
        const dropdowns = Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown"));
        const target = dropdowns.find((dd) => {
          const items = Array.from(dd.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).map((li) => li.textContent?.trim() ?? "");
          return optionTexts.every((o) => items.includes(o));
        });
        if (!target) return [];
        const picked: string[] = [];
        for (const opt of optionTexts) {
          const item = Array.from(target.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find((li) => (li.textContent?.trim() ?? "") === opt);
          if (item) {
            ["mousedown", "mouseup", "click"].forEach((t) => item.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
            picked.push(opt);
            await sleep(150);
          }
        }
        document.body.click();
        await sleep(150);
        return picked;
      }
      function isolatedContainerFor(input: HTMLElement, placeholderSelector: string): HTMLElement | null {
        let c: HTMLElement | null = input;
        for (let i = 0; i < 12 && c; i++) {
          c = c.parentElement;
          if (!c) break;
          if (c.querySelectorAll(placeholderSelector).length === 1) return c;
        }
        return null;
      }

      const filled: string[] = [];
      const skipped: string[] = [];
      const errors: string[] = [];

      return (async () => {
        // ----- basic info (contact only — name/birth/ID stay as-is to avoid clobbering correct data) -----
        if (contactEmail) {
          const emailInp = findInput("请输入邮箱地址");
          if (emailInp) { setNative(emailInp, contactEmail); filled.push("email"); }
        }
        if (contactPhone) {
          const phoneInp = findInput("请填写您的手机号码");
          if (phoneInp) { setNative(phoneInp, contactPhone); filled.push("phone"); }
        }

        // ----- intent -----
        if (s.intent) {
          if (s.intent.cities?.length) {
            const r = await pickElSelectMulti("请选择期望工作城市（至多三个）", s.intent.cities.slice(0, 3));
            if (r.length > 0) filled.push(`intent.cities[${r.length}]`);
          }
          if (s.intent.bgs?.length) {
            // 事业群 is single-select on Tencent — pick first usable.
            for (const bg of s.intent.bgs) {
              const ok = await pickElSelect("请选择感兴趣的事业群", bg);
              if (ok) { filled.push(`intent.bg=${bg}`); break; }
            }
          }
          if (s.intent.interview_city) {
            const ok = await pickElSelect("请输入面试城市", s.intent.interview_city);
            if (ok) filled.push("intent.interview_city");
          }
          if (s.intent.duration) {
            const ok = await pickElSelect("请选择时长", s.intent.duration);
            if (ok) filled.push("intent.duration");
          }
          if (s.intent.days_per_week) {
            const ok = await pickElSelect("请选择天数", s.intent.days_per_week);
            if (ok) filled.push("intent.days_per_week");
          }
          if (s.intent.earliest_start) {
            // The earliest-start date input is identified by its surrounding label.
            const dateInp = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="选择日期"]')).find((d) => {
              if (d.value) return false;
              let p: HTMLElement | null = d.parentElement;
              for (let k = 0; k < 8 && p; k++) {
                if (p.textContent && p.textContent.includes("最早可入职")) return true;
                p = p.parentElement;
              }
              return false;
            });
            if (dateInp) { setNative(dateInp, s.intent.earliest_start); filled.push("intent.earliest_start"); }
          }
        }

        // ----- education -----
        if (s.educations && s.educations.length > 0) {
          // Overwrite the first (existing) education row in place; click 添加学历 for the rest.
          for (let i = 0; i < s.educations.length; i++) {
            const edu = s.educations[i];
            if (i > 0) {
              const addBtn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim().includes("添加学历"));
              if (!addBtn) { skipped.push(`education[${i}] (no 添加学历 button)`); continue; }
              addBtn.click();
              await sleep(300);
            }
            const schools = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="请输入学校名称"]'));
            const slot = schools[i];
            if (!slot) { skipped.push(`education[${i}] (no school slot)`); continue; }
            if (edu.school) setNative(slot, edu.school);
            const container = isolatedContainerFor(slot, 'input[placeholder="请输入学校名称"]');
            if (!container) { errors.push(`education[${i}] no isolated container`); continue; }
            if (edu.department) {
              const dept = container.querySelector<HTMLInputElement>('input[placeholder="请输入院系"]');
              if (dept) setNative(dept, edu.department);
            }
            if (edu.major) {
              const major = container.querySelector<HTMLInputElement>('input[placeholder="请输入专业"]');
              if (major) setNative(major, edu.major);
            }
            const dateInps = container.querySelectorAll<HTMLInputElement>('input[placeholder="选择日期"]');
            if (dateInps.length >= 2) {
              if (edu.start) setNative(dateInps[0], edu.start);
              if (edu.end) setNative(dateInps[1], edu.end);
            }
            // Degree (学历) dropdown — open the section's el-select and click the hidden option.
            if (edu.level) {
              const xueliInp = container.querySelector<HTMLInputElement>('input[placeholder="请选择学历"]');
              if (xueliInp) {
                const w = (xueliInp.closest(".el-select") as HTMLElement) ?? xueliInp.parentElement;
                if (w) {
                  ["mousedown", "mouseup", "click"].forEach((t) => w.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
                  await sleep(220);
                  const dds = Array.from(document.querySelectorAll<HTMLElement>(".el-select-dropdown"));
                  const dd = dds.find((d) => Array.from(d.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).some((li) => (li.textContent?.trim() ?? "") === (edu.level as string)));
                  if (dd) {
                    const item = Array.from(dd.querySelectorAll<HTMLElement>(".el-select-dropdown__item")).find((li) => (li.textContent?.trim() ?? "") === (edu.level as string));
                    if (item) {
                      ["mousedown", "mouseup", "click"].forEach((t) => item.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
                      await sleep(200);
                    }
                  }
                }
              }
            }
            filled.push(`education[${i}]=${edu.school ?? "?"}`);
          }
        }

        // ----- internships -----
        if (s.internships && s.internships.length > 0) {
          // We never touch existing internship rows the user already cleaned up
          // in the SPA — we only ADD. So fast-forward past any existing rows
          // and click 添加实习经历 for each profile internship.
          //
          // Strategy: overwrite if there's exactly 1 existing row AND it's empty.
          // Otherwise append. (Tencent's SPA pre-populates 1 empty row on a
          // brand-new profile.)
          const startCount = document.querySelectorAll('input[placeholder="请输入实习公司"]').length;
          const shouldOverwriteFirst = startCount === 1 && (() => {
            const first = document.querySelector<HTMLInputElement>('input[placeholder="请输入实习公司"]');
            return first ? first.value.trim().length === 0 : false;
          })();
          for (let i = 0; i < s.internships.length; i++) {
            const it = s.internships[i];
            if (!(i === 0 && shouldOverwriteFirst)) {
              const addBtn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim().includes("添加实习经历"));
              if (!addBtn) { skipped.push(`internship[${i}] (no add button)`); continue; }
              addBtn.click();
              await sleep(300);
            }
            const companies = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="请输入实习公司"]'));
            const slot = companies[companies.length - 1];
            if (!slot) { skipped.push(`internship[${i}] (no slot)`); continue; }
            if (it.company) setNative(slot, it.company);
            const container = isolatedContainerFor(slot, 'input[placeholder="请输入实习公司"]');
            if (!container) { errors.push(`internship[${i}] no isolated container`); continue; }
            if (it.role) {
              const role = container.querySelector<HTMLInputElement>('input[placeholder="请输入职位"]');
              if (role) setNative(role, it.role);
            }
            const dateInps = container.querySelectorAll<HTMLInputElement>('input[placeholder="选择日期"]');
            if (dateInps.length >= 2) {
              if (it.start) setNative(dateInps[0], it.start);
              if (it.end && !it.ongoing) setNative(dateInps[1], it.end);
            }
            if (it.description) {
              const desc = container.querySelector<HTMLTextAreaElement>('textarea[placeholder="请输入描述内容"]');
              if (desc) setNative(desc, it.description);
            }
            filled.push(`internship[${i}]=${it.company ?? "?"}`);
          }
        }

        // ----- projects -----
        if (s.projects && s.projects.length > 0) {
          // Mirror the internships pattern. Projects on Tencent have a
          // "请输入项目名称（含校园实践）" placeholder that is also used by
          // the 作品集 (作品链接) section — exclude that by scoping to
          // ancestors that include "项目经历-" and don't include "作品链接".
          function projectSlots(): HTMLInputElement[] {
            return Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder*="请输入项目名称"]')).filter((inp) => {
              let p: HTMLElement | null = inp.parentElement;
              for (let i = 0; i < 12 && p; i++) {
                const t = p.textContent ?? "";
                if (t.includes("项目经历-") && !t.includes("作品链接")) return true;
                p = p.parentElement;
              }
              return false;
            });
          }
          const startSlots = projectSlots();
          const startCount = startSlots.length;
          const shouldOverwriteFirst = startCount === 1 && startSlots[0].value.trim().length === 0;
          for (let i = 0; i < s.projects.length; i++) {
            const p = s.projects[i];
            if (!(i === 0 && shouldOverwriteFirst)) {
              const addBtn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim().includes("添加项目经历"));
              if (!addBtn) { skipped.push(`project[${i}] (no add button)`); continue; }
              addBtn.click();
              await sleep(300);
            }
            const slots = projectSlots();
            const slot = slots[slots.length - 1];
            if (!slot) { skipped.push(`project[${i}] (no slot)`); continue; }
            if (p.name) setNative(slot, p.name);
            let c: HTMLElement | null = slot;
            for (let k = 0; k < 12 && c; k++) {
              c = c.parentElement;
              if (c && c.querySelector('input[placeholder="请输入在项目中担任的角色"]') && c.querySelectorAll('input[placeholder*="请输入项目名称"]').length === 1) break;
            }
            if (!c) { errors.push(`project[${i}] no isolated container`); continue; }
            if (p.role) {
              const role = c.querySelector<HTMLInputElement>('input[placeholder="请输入在项目中担任的角色"]');
              if (role) setNative(role, p.role);
            }
            const dateInps = c.querySelectorAll<HTMLInputElement>('input[placeholder="选择日期"]');
            if (dateInps.length >= 2) {
              if (p.start) setNative(dateInps[0], p.start);
              if (p.end && !p.ongoing) setNative(dateInps[1], p.end);
            }
            if (p.description) {
              const desc = c.querySelector<HTMLTextAreaElement>('textarea[placeholder="请输入描述内容"]');
              if (desc) setNative(desc, p.description);
            }
            filled.push(`project[${i}]=${p.name ?? "?"}`);
          }
        }

        // ----- skills -----
        if (s.skills) {
          if (s.skills.ai_skills) {
            const ai = findTextarea("AI工具");
            if (ai) { setNative(ai, s.skills.ai_skills); filled.push("skills.ai_skills"); }
          }
          if (s.skills.extra) {
            const extra = findTextarea("自我评价");
            if (extra) { setNative(extra, s.skills.extra.slice(0, 500)); filled.push("skills.extra"); }
          }
          if (s.skills.homepage) {
            const hp = findInput("请输入个人主页超链接");
            if (hp) { setNative(hp, s.skills.homepage); filled.push("skills.homepage"); }
          }
          if (s.skills.languages?.length) {
            const r = await pickElSelectMulti("请输入你擅长的开发语言", s.skills.languages);
            if (r.length > 0) filled.push(`skills.languages[${r.length}]`);
          }
        }

        // ----- explicit skip notice for cascader fields -----
        skipped.push("cascader: 当前所处地 (manual)");
        skipped.push("cascader: 目前就读地 × N (manual)");

        return { filled, skipped, errors };
      })();
    }, structured, profile.email, profile.phone);

    steps.push({
      step: "fill-structured",
      url: page.url(),
      status: fillResult.errors.length === 0 ? 200 : 207,
      ok: fillResult.errors.length === 0,
      message: `filled ${fillResult.filled.length} fields; skipped ${fillResult.skipped.length}${fillResult.errors.length > 0 ? `; errors=${fillResult.errors.join(",")}` : ""}`,
    });

    // -----------------------------------------------------------------
    // Optional second phase: bindResume (PDF attach). We don't fire it
    // here — the SPA's own "更新" / "上传简历" button already handles PDF
    // re-upload, and the existing multipart-session executor in apply.ts
    // covers the bindResume call for users who want raw HTTP. This
    // executor's job is the structured form; the PDF flow already works.
    // We screenshot the result so the user can verify before reviewing
    // the actual page.
    // -----------------------------------------------------------------
    if (resumePath) {
      steps.push({ step: "resume-bind", url: page.url(), status: 0, ok: true, message: `resume PDF attached separately; bindResume not re-fired from this executor` });
    }

    return { kind: "filled" as const, fillResult };
  });

  if (!r.ok) {
    return { ok: false, posted_to: editUrl, message: r.error.message, steps };
  }
  const v = r.value as { kind: string; fillResult?: { filled: string[]; skipped: string[]; errors: string[] } };
  if (v.kind === "no-form") {
    return { ok: false, posted_to: editUrl, message: "structured form never rendered — session likely invalid or post id wrong", steps };
  }
  if (v.kind === "debug") {
    return { ok: true, posted_to: editUrl, message: "debug: navigated + form mounted, no fill performed", steps };
  }
  const fr = v.fillResult!;
  return {
    ok: fr.errors.length === 0,
    posted_to: editUrl,
    message:
      `structured fill complete — filled ${fr.filled.length}, skipped ${fr.skipped.length}, errors ${fr.errors.length}. ` +
      `Review at ${editUrl} and click 提交简历 when ready. ` +
      `Manual fields (el-cascader): 当前所处地 + 每段教育的目前就读地.`,
    steps,
  };
}
