import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
async function main() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage();
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "fetch" || t === "xhr") {
        const body = req.postData()?.slice(0, 200) ?? "";
        console.log("REQ", req.method().padEnd(4), req.url(), body);
      }
    });
    page.on("response", async (resp) => {
      const t = resp.request().resourceType();
      if ((t === "fetch" || t === "xhr") && resp.status() === 200) {
        try {
          const txt = await resp.text();
          if (txt.length < 3000) console.log("RSP", resp.url(), "::", txt.slice(0, 400).replace(/\s+/g, " "));
          else console.log("RSP", resp.url(), "(", txt.length, "bytes)");
        } catch {}
      }
    });
    await page.goto("https://lilithgames.jobs.feishu.cn/career/?keywords=&location=CT_11&current=1&limit=10", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 8000));
  } finally {
    await b.close();
  }
}
main();
