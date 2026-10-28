// Captures the real UI at the required viewport sizes and checks for horizontal overflow.
// Usage: node responsive.mjs <baseUrl> <outDir>
// Prompts go through the normal composer; access requests are answered by the server's rules, so no model is needed.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? "out/resp";
mkdirSync(out, { recursive: true });
const sizes = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
];
const b = await chromium.launch();
const report = [];
for (const [w, h] of sizes) {
  const mobile = w < 860;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 500, colorScheme: "light" });
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(1500);
  const shot = async (name) => {
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    report.push(`${w}x${h} ${name}: scrollWidth=${o.sw} clientWidth=${o.cw} ${o.sw > o.cw + 1 ? "OVERFLOW" : "ok"}`);
    await p.screenshot({ path: `${out}/${w}x${h}-${name}.png`, timeout: 60000 });
  };
  const ask = async (text) => {
    await p.getByLabel("Message", { exact: true }).fill(text);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(600);
    await p.waitForFunction(() => !document.querySelector(".msg.assistant[data-status='working']") && document.querySelector(".msg.assistant"), null, { timeout: 60000 });
  };
  await shot("1-chat-empty");
  if (mobile) {
    await p.getByRole("button", { name: "Show sidebar" }).click();
    await p.waitForTimeout(500);
    await shot("2-drawer");
    await p.getByRole("button", { name: "Close sidebar" }).first().click();
    await p.waitForTimeout(400);
  }
  await ask("Show me the Project Nightingale budget.");
  await shot("3-denied");
  await p.locator("details.trace summary").first().click();
  await p.locator(".tl-row").first().click();
  await p.waitForTimeout(400);
  await shot("4-activity-open");
  await p.getByRole("button", { name: "Open full evidence" }).last().click();
  await p.waitForTimeout(700);
  await shot("5-full-evidence");
  await p.getByRole("complementary", { name: "Security walkthrough" }).getByRole("button", { name: "Close" }).click();
  await p.getByRole("switch", { name: "Security" }).click();
  await ask("Find the latest project updates.");
  await shot("6-protections-off");
  await ctx.close();
}
await b.close();
console.log(report.join("\n"));
