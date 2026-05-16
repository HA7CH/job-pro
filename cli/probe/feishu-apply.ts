// Probe a Feishu careers tenant to find the real apply endpoint + body shape.
// Navigates to a job detail page and watches all XHRs fired when the user
// presses "投递".
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const TARGETS = [
  // Pick a Feishu tenant + an active job. NIO has the most volume.
  { tag: "nio",     home: "https://nio.jobs.feishu.cn/campus/position",   apply: "https://nio.jobs.feishu.cn/campus/position/7398064824717920527/detail" },
  { tag: "minimax", home: "https://vrfi1sk8a0.jobs.feishu.cn/379481/position", apply: null },
  { tag: "agibot",  home: "https://agirobot.jobs.feishu.cn/campus/position", apply: null },
];

async function probe(t: typeof TARGETS[number]) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage();
    page.on("response", async (resp) => {
      const t = resp.request().resourceType();
      if (t !== "fetch" && t !== "xhr") return;
      const u = resp.url();
      // Filter to apply / application / submit / upload / delivery
      if (!/apply|application|delivery|submit|upload|deliver|create/i.test(u)) return;
      let preview = "";
      try {
        const body = await resp.text();
        if (body.length < 4000 && (body.startsWith("{") || body.startsWith("["))) {
          preview = body.slice(0, 400).replace(/\s+/g, " ");
        }
      } catch {}
      console.log(`  ${resp.status()} ${resp.request().method().padEnd(4)} ${u}${preview ? "\n           :: " + preview : ""}`);
    });
    page.on("request", (req) => {
      if (req.resourceType() === "fetch" || req.resourceType() === "xhr") {
        const u = req.url();
        if (/apply|application|delivery|submit|upload|deliver|create/i.test(u)) {
          const body = req.postData()?.slice(0, 250) ?? "";
          console.log(`  REQ ${req.method().padEnd(4)} ${u}${body ? "\n           body: " + body : ""}`);
        }
      }
    });

    console.log(`\n=== ${t.tag} → ${t.home} ===`);
    try {
      await page.goto(t.home, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 5000));
      // Click first job card to trigger the detail XHR
      const links = await page.$$eval('a[href*="/position/"]', (els) =>
        (els as HTMLAnchorElement[]).slice(0, 5).map((e) => e.href)
      );
      console.log(`  job links found: ${links.length}`);
      if (links[0]) {
        console.log(`  navigating to detail: ${links[0]}`);
        await page.goto(links[0], { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise((r) => setTimeout(r, 5000));
        // Click "投递" button
        const buttons = await page.$$eval('button, a', (els) =>
          (els as Array<HTMLButtonElement | HTMLAnchorElement>)
            .map((e) => ({ text: e.textContent?.trim(), tag: e.tagName }))
            .filter((b) => b.text && /投递|申请|apply|submit/i.test(b.text))
            .slice(0, 5)
        );
        console.log(`  apply-like buttons: ${JSON.stringify(buttons)}`);
        const applyClick = await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('button, a')) as Array<HTMLButtonElement | HTMLAnchorElement>;
          for (const el of candidates) {
            const t = (el.textContent ?? "").trim();
            if (/投递|申请/.test(t)) {
              el.click();
              return t;
            }
          }
          return null;
        });
        console.log(`  clicked: ${applyClick ?? "none"}`);
        await new Promise((r) => setTimeout(r, 6000));
      }
    } catch (e) {
      console.log(`  ERR: ${(e as Error).message}`);
    }
  } finally {
    await b.close();
  }
}

async function main() {
  for (const t of TARGETS) await probe(t);
}
main();
