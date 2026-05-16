// Probe public job aggregators (51job / lagou / zhipin / zhaopin / liepin)
// via real browser to find which ones expose an anonymous JSON endpoint.
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const TARGETS: Array<[string, string]> = [
  ["51job", "https://we.51job.com/pc/search?keyword=海康威视&searchType=2&jobArea=000000&sortType=0&metro="],
  ["lagou", "https://www.lagou.com/jobs/list_%E6%B5%B7%E5%BA%B7%E5%A8%81%E8%A7%86"],
  ["zhipin", "https://www.zhipin.com/web/geek/job?query=海康威视&city=100010000"],
  ["zhaopin", "https://sou.zhaopin.com/?jl=489&kw=海康威视&kt=3"],
  ["liepin", "https://www.liepin.com/zhaopin/?key=海康威视"],
];

async function probe(label: string, url: string) {
  console.log(`\n=== ${label} ===`);
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage();
    const captured: Array<{ method: string; url: string; status: number; size: number; preview: string }> = [];
    page.on("response", async (resp) => {
      const t = resp.request().resourceType();
      if (t !== "fetch" && t !== "xhr") return;
      const u = resp.url();
      const interesting = /api|search|list|position|company|recruit|job/i.test(u);
      if (!interesting) return;
      try {
        const body = await resp.text();
        const preview = body.length < 4000 && (body.startsWith("{") || body.startsWith("[")) ? body.slice(0, 200).replace(/\s+/g, " ") : "";
        captured.push({ method: resp.request().method(), url: u, status: resp.status(), size: body.length, preview });
      } catch {}
    });
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 6000));
    } catch (e) {
      console.log("  goto err:", (e as Error).message);
    }
    for (const c of captured.slice(0, 12)) {
      console.log(`  ${c.status} ${c.method.padEnd(4)} ${c.size.toString().padStart(7)}b ${c.url}${c.preview ? "\n         :: " + c.preview : ""}`);
    }
  } finally {
    await b.close();
  }
}

async function main() {
  for (const [name, url] of TARGETS) await probe(name, url);
}
main();
