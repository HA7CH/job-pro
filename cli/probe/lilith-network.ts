// Capture all XHRs jobs.lilith.com makes, to find the Vue data source.
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function probe(url: string) {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await b.newPage();
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "fetch" || t === "xhr" || t === "document") {
        console.log("REQ", req.method().padEnd(4), t.padEnd(8), req.url(), req.postData() ? "BODY:" + req.postData()?.slice(0, 80) : "");
      }
    });
    page.on("response", async (resp) => {
      const url = resp.url();
      const t = resp.request().resourceType();
      if ((t === "fetch" || t === "xhr") && resp.status() === 200) {
        try {
          const txt = await resp.text();
          if (txt.length < 4000 && (txt.includes("{") || txt.includes("["))) {
            console.log("RSP", resp.status(), url, "::", txt.slice(0, 300).replace(/\s+/g, " "));
          } else {
            console.log("RSP", resp.status(), url, "(", txt.length, "bytes)");
          }
        } catch {}
      }
    });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 5000));
  } finally {
    await b.close();
  }
}

await probe("https://jobs.lilith.com/");
