// Capture the exact POST body + response shape for liepin pc-search-job
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await b.newPage();
    let bodyDump = "";
    let responseDump = "";
    let headersDump = "";
    page.on("request", (req) => {
      if (req.url().includes("pc-search-job") && req.method() === "POST") {
        bodyDump = req.postData() ?? "";
        headersDump = JSON.stringify(req.headers(), null, 2);
      }
    });
    page.on("response", async (resp) => {
      if (resp.url().includes("pc-search-job")) {
        try {
          responseDump = await resp.text();
        } catch {}
      }
    });
    await page.goto("https://www.liepin.com/zhaopin/?key=海康威视", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));
    console.log("===headers===");
    console.log(headersDump);
    console.log("\n===request body===");
    console.log(bodyDump);
    console.log("\n===response preview (first 4KB)===");
    console.log(responseDump.slice(0, 4000));
    console.log("\n===total response size===", responseDump.length);
    // Try to parse and show jobs count
    try {
      const j = JSON.parse(responseDump);
      const jobs = j?.data?.jobCardList ?? j?.data?.list ?? j?.data?.jobs ?? [];
      console.log("jobs count:", jobs.length);
      if (jobs[0]) console.log("first job keys:", Object.keys(jobs[0]).slice(0, 30));
    } catch (e) {
      console.log("parse err:", (e as Error).message);
    }
  } finally {
    await b.close();
  }
}
main();
