// Captures the real UI at the required viewport sizes and checks for horizontal overflow and off-screen tour cards.
// Usage: node responsive.mjs <baseUrl> <outDir> [--demo-route]
//   --demo-route marks chat requests as scripted-demo requests so a layout run needs no live model (the server still decides everything).
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? "out/resp";
const demoRoute = process.argv.includes("--demo-route");
mkdirSync(out, { recursive: true });
const sizes = [
  [360, 800],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
];
const b = await chromium.launch();
const report = [];
for (const [w, h] of sizes) {
  const mobile = w < 860;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 500, colorScheme: "light" });
  const p = await ctx.newPage();
  if (demoRoute) {
    await p.route("**/api/chat", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      return route.continue({ postData: JSON.stringify({ ...body, demo: true }) });
    });
  }
  await p.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(1500);
  const check = async (label) => {
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    const card = await p.evaluate(() => {
      const c = document.querySelector(".tour-card");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5 };
    });
    report.push(`${w}x${h} ${label}: scrollWidth=${o.sw} clientWidth=${o.cw} ${o.sw > o.cw + 1 ? "OVERFLOW" : "ok"}${card ? (card.inside ? " tour-card inside viewport" : " TOUR-CARD OUTSIDE") : ""}`);
  };
  const shot = async (name) => {
    await check(name);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await p.screenshot({ path: `${out}/${w}x${h}-${name}.png`, timeout: 60000 });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await p.waitForTimeout(1000);
      }
    }
  };
  await shot("1-chat-empty");
  if (mobile) {
    await p.getByRole("button", { name: "Show sidebar" }).click();
    await p.waitForTimeout(500);
    await shot("2-drawer");
    await p.getByRole("button", { name: "Close sidebar" }).first().click();
    await p.waitForTimeout(400);
  }
  // Normal chat: Security ON, request that needs approval
  await p.getByRole("switch", { name: "Security" }).click();
  await p.getByRole("button", { name: "Send the project summary to the team." }).click();
  await p.waitForTimeout(demoRoute ? 3500 : 7000);
  await shot("3-chat-approval");
  const approve = p.getByRole("button", { name: "Approve", exact: true });
  if (await approve.count()) {
    await approve.click();
    await p.waitForTimeout(1500);
    await shot("4-chat-approved");
  }
  await p.locator("details.trace summary").first().click();
  await p.locator(".tl-row").first().click();
  await p.waitForTimeout(400);
  await shot("5-chat-activity-open");
  // Explore Security
  await p.locator(".fineprint .linkish").click();
  await p.waitForTimeout(600);
  await shot("6-explore");
  await p.getByRole("button", { name: /Run scenario B/ }).click();
  await p.waitForTimeout(3000);
  await p.getByRole("button", { name: /Run scenario C/ }).click();
  await p.waitForTimeout(3000);
  await shot("7-explore-replay");
  await p.getByRole("tab", { name: "Architecture" }).click();
  await p.waitForTimeout(500);
  await shot("8-architecture");
  await p.getByRole("tab", { name: "Replay" }).click();
  await p.getByRole("button", { name: "Take the tour" }).click();
  await p.getByRole("dialog").waitFor({ timeout: 15000 });
  await p.waitForTimeout(900);
  await shot("9-tour-step1");
  for (let i = 2; i <= 5; i++) {
    const next = p.getByRole("button", { name: /^(Next|Done)$/ });
    if (!(await next.count())) break;
    await next.click();
    await p.waitForTimeout(900);
    if (i === 3 || i === 4) await shot(`9-tour-step${i}`);
  }
  await ctx.close();
}
await b.close();
console.log(report.join("\n"));
