import { chromium } from "playwright";
const S = process.env.S;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const w of [1440, 768, 375]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  const errs = []; p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto("http://localhost:3100/projects/aa20b383-f7f1-46fb-9374-1e18e870d5f6?step=export", { waitUntil: "load" });
  await p.waitForSelector("text=Pre-flight checklist", { timeout: 90000 }); await p.waitForTimeout(1200);
  console.log(w, "scrollWidth", await p.evaluate(() => document.documentElement.scrollWidth), errs.slice(0, 3));
  await p.screenshot({ path: `${S}/m11-${w}.png`, fullPage: true });
  await p.close();
}
await b.close();
