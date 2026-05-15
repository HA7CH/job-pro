// Capture all XHRs talent.antgroup.com makes to find the careers API.
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
      if (t === "fetch" || t === "xhr") {
        const body = req.postData()?.slice(0, 200) ?? "";
        console.log("REQ", req.method().padEnd(4), t.padEnd(6), req.url(), body ? "BODY:" + body : "");
      }
    });
    page.on("response", async (resp) => {
      const t = resp.request().resourceType();
      if ((t === "fetch" || t === "xhr") && resp.status() === 200) {
        try {
          const txt = await resp.text();
          if (txt.length < 4000 && (txt.includes("{") || txt.includes("["))) {
            console.log("RSP", resp.status(), resp.url(), "::", txt.slice(0, 250).replace(/\s+/g, " "));
          } else if (txt.includes("position") || txt.includes("job")) {
            console.log("RSP", resp.status(), resp.url(), "(", txt.length, "bytes, may have jobs)");
          }
        } catch {}
      }
    });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 8000));
  } finally {
    await b.close();
  }
}

const target = process.argv[2] ?? "https://talent.antgroup.com/campus-list";
await probe(target);
