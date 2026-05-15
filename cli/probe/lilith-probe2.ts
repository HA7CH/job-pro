import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
async function main() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage();
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "fetch" || t === "xhr") console.log("REQ", req.method().padEnd(4), req.url());
    });
    page.on("response", async (resp) => {
      const t = resp.request().resourceType();
      if ((t === "fetch" || t === "xhr") && resp.status() === 200) {
        try {
          const txt = await resp.text();
          if (txt.length < 2000) console.log("RSP", resp.url(), "::", txt.slice(0, 400).replace(/\s+/g, " "));
          else console.log("RSP", resp.url(), "(", txt.length, "bytes)");
        } catch {}
      }
    });
    await page.goto("https://jobs.lilith.com/", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 6000));
    const links = await page.$$eval("a[href]", (els: Element[]) => (els as HTMLAnchorElement[]).map(e => ({href: e.getAttribute("href"), text: e.textContent?.trim()})).slice(0, 30));
    console.log("LINKS:", JSON.stringify(links.filter((l) => l.href && !l.href.startsWith("javascript") && !l.href.includes("/privacy")), null, 2));
  } finally {
    await b.close();
  }
}
main();
