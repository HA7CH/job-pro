// Probe each of the remaining 4 stubs' actual careers page in a real browser.
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGETS: Record<string, string[]> = {
  hikvision: [
    "https://www.hikvision.com.cn/cn/about/talent/",
    "https://www.hikvision.com/cn/about/Talent-recruit/",
    "https://www.hikvision.com/cn/about-us/talent-recruitment/",
    "https://www.hikvision.com.cn/cn/recruit/",
  ],
  cicc: [
    "https://www.cicc.com/en/about-us/careers-at-cicc",
    "https://www.cicc.com.cn/cicc/zh/careers",
    "https://www.cicc.com/about-us/careers",
    "https://www.cicc.com.cn/cicc/zh-cn/recruit",
  ],
  cainiao: [
    "https://www.cainiao.com/about/recruit",
    "https://www.cainiao.com/recruit",
    "https://global.cainiao.com/careers",
    "https://www.cainiao.com/about-us/careers",
  ],
  webank: [
    "https://www.webank.com/career/",
    "https://www.webank.com/zhaopin/",
    "https://www.webank.com.cn/career/",
    "https://www.webank.com.cn/zhaopin/",
  ],
};

async function probe(tag: string, urls: string[]) {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const url of urls) {
      console.log(`\n=== ${tag} → ${url} ===`);
      const page = await b.newPage();
      const xhrs: Array<{ url: string; status: number; size: number }> = [];
      page.on("response", async (resp) => {
        const t = resp.request().resourceType();
        if (t === "fetch" || t === "xhr") {
          let size = 0;
          try {
            const body = await resp.text();
            size = body.length;
          } catch {}
          xhrs.push({ url: resp.url(), status: resp.status(), size });
        }
      });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        await new Promise((r) => setTimeout(r, 6000));
        const finalUrl = page.url();
        console.log(`  final URL: ${finalUrl}`);
        // Print all XHR/fetch responses with non-trivial size
        const interesting = xhrs.filter((x) => x.size > 200 && (x.url.includes("/api/") || x.url.includes("job") || x.url.includes("recruit") || x.url.includes("position") || x.url.includes("career")));
        for (const x of interesting.slice(0, 12)) {
          console.log(`  ${x.status} ${x.size}b ${x.url}`);
        }
        // Also: detect Beisen / Moka / Feishu in the final HTML
        const html = await page.content();
        const ats: string[] = [];
        for (const pattern of [/app\.mokahr\.com\/[a-z\-_]+\/[a-z0-9_-]+\/\d+/g, /[a-z0-9\-]+\.zhiye\.com/g, /[a-z0-9\-]+\.italent\.cn/g, /[a-z0-9\-]+\.jobs\.feishu\.cn/g, /wecruit\.hotjob\.cn\/SU[a-f0-9]+/g]) {
          const matches = html.match(pattern);
          if (matches) ats.push(...matches);
        }
        if (ats.length) console.log(`  ATS hits: ${[...new Set(ats)].slice(0, 5).join(", ")}`);
      } catch (err) {
        console.log(`  ERR: ${err instanceof Error ? err.message : err}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await b.close();
  }
}

async function main() {
  for (const [tag, urls] of Object.entries(TARGETS)) {
    await probe(tag, urls);
  }
}
main();
