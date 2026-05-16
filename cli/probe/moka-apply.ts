// Probe Moka apply endpoint shape — grep JS bundle for /api/outer/ats-apply/*
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function probe(label: string, url: string) {
  console.log(`\n=== ${label} : ${url} ===`);
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage();
    const scripts: string[] = [];
    page.on("response", (resp) => {
      if (resp.request().resourceType() === "script") {
        scripts.push(resp.url());
      }
    });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));
    console.log(`  loaded scripts: ${scripts.length}`);
    // Find Moka-app js (largest static JS)
    const candidates = scripts.filter((u) => /static-ats\.mokahr\.com|moka-fe-public/.test(u));
    console.log(`  candidate URLs: ${candidates.length}`);
    for (const s of candidates.slice(0, 8)) console.log(`    ${s}`);
  } finally {
    await b.close();
  }
}

await probe("megvii social", "https://app.mokahr.com/social-recruitment/megviihr/38641");
