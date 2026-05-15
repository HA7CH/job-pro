// One-off network capture: launches system Chrome via puppeteer-core,
// navigates to SenseTime / Horizon Robotics campus pages, dumps every
// request URL + method + post body + response status to stdout.
//
// Goal: determine whether the SPA's actual API call differs from the
// nginx-405 URL we constructed manually (/SU.../pb/positionInfo/listPosition/SU...).
//
// Run: pnpm exec tsx probe/sensetime-network.ts

import puppeteer from "puppeteer-core";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
];

interface CapturedRequest {
  url: string;
  method: string;
  resourceType: string;
  postData?: string;
  status?: number;
  responseBodyPreview?: string;
}

const TARGETS = [
  {
    label: "sensetime-campus",
    url: "https://hr.sensetime.com/SU6710d7c21c240e54e1f82a1b/pb/school.html",
  },
  {
    label: "horizon-school",
    url: "https://wecruit.hotjob.cn/SU6409ef49bef57c635fd390a6/pb/school.html",
  },
  {
    label: "horizon-social",
    url: "https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/social.html",
  },
];

async function probe(label: string, entryUrl: string, executablePath: string) {
  const captured: CapturedRequest[] = [];

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    );

    page.on("request", (req) => {
      const url = req.url();
      // We only care about API / XHR requests, not static assets
      if (req.resourceType() === "document" || req.resourceType() === "fetch" || req.resourceType() === "xhr") {
        captured.push({
          url,
          method: req.method(),
          resourceType: req.resourceType(),
          postData: req.postData(),
        });
      }
    });

    page.on("response", async (resp) => {
      const url = resp.url();
      const c = captured.find((r) => r.url === url && r.status === undefined);
      if (c) {
        c.status = resp.status();
        if (resp.status() === 200 && (c.method === "POST" || url.includes("position") || url.includes("Position") || url.includes("Job"))) {
          try {
            const text = await resp.text();
            c.responseBodyPreview = text.slice(0, 500);
          } catch {
            /* binary or stream */
          }
        }
      }
    });

    await page.goto(entryUrl, { waitUntil: "networkidle2", timeout: 30000 });
    // Give the SPA a few more seconds to fire any deferred XHRs
    await new Promise((r) => setTimeout(r, 4000));

    console.log(`\n=== ${label} (${entryUrl}) ===`);
    for (const r of captured) {
      const stat = r.status ?? "?";
      const body =
        r.postData && r.postData.length < 200 ? ` body=${r.postData}` : r.postData ? ` body=${r.postData.length}b` : "";
      console.log(`  ${stat} ${r.method.padEnd(4)} ${r.resourceType.padEnd(8)} ${r.url}${body}`);
      if (r.responseBodyPreview) {
        console.log(`         resp: ${r.responseBodyPreview.slice(0, 200).replace(/\s+/g, " ")}`);
      }
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const { existsSync } = await import("node:fs");
  const executablePath = CHROME_PATHS.find((p) => existsSync(p));
  if (!executablePath) {
    console.error("No Chrome found at:", CHROME_PATHS.join(", "));
    process.exit(1);
  }
  console.log("Using Chrome:", executablePath);

  for (const t of TARGETS) {
    try {
      await probe(t.label, t.url, executablePath);
    } catch (err) {
      console.error(`[${t.label}] ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
