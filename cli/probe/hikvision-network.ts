import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function probe(url: string) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage();
    page.on("response", async (resp) => {
      const t = resp.request().resourceType();
      const u = resp.url();
      if (t === "fetch" || t === "xhr" || t === "document") {
        let size = 0;
        try {
          const body = await resp.text();
          size = body.length;
        } catch {}
        console.log(`  ${resp.status()} ${t.padEnd(6)} ${size}b ${u}`);
      }
    });
    page.on("framenavigated", (f) => console.log(`  -> framenavigated: ${f.url()}`));
    console.log(`=== ${url} ===`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 12000));
    console.log("  final URL:", page.url());
    const html = await page.content();
    console.log(`HTML size after JS: ${html.length}b`);
    // Look for embedded careers data
    const apis = html.match(/(?:https?:\/\/[a-zA-Z0-9.\/_-]+)?(?:\/api\/[a-zA-Z0-9_\/-]+|\/recruit\/[a-zA-Z0-9_\/-]+|\/job\/[a-zA-Z0-9_\/-]+)/g);
    if (apis) console.log("API paths in HTML:", [...new Set(apis)].slice(0, 8));
    // Look for company tenant ID
    const ats = html.match(/app\.mokahr\.com\/[a-z\-_]+\/[a-z0-9_-]+\/\d+|wecruit\.hotjob\.cn\/SU[a-f0-9]+|[a-z0-9\-]+\.zhiye\.com|[a-z0-9\-]+\.italent\.cn|[a-z0-9\-]+\.jobs\.feishu\.cn/g);
    if (ats) console.log("ATS hits:", [...new Set(ats)].slice(0, 5));
    // Find job-like content
    const titles = html.match(/<a[^>]*href="[^"]*(?:job|position|career|recruit)[^"]*"[^>]*>([^<]{3,80})<\/a>/gi);
    if (titles) console.log(`Job-like links: ${titles.length}`);
  } finally {
    await b.close();
  }
}

await Promise.resolve();
for (const u of [
  "https://www.hikvision.com/cn/about/Talent-recruit/",
  "https://www.hikvision.com/cn/about/talent/",
  "https://www.hikvision.com/cn/about/social-recruitment/",
  "https://www.hikvision.com/cn/about/Recruit/",
]) {
  await probe(u);
}
