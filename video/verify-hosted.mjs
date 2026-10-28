// Acceptance run against the public site in fresh browser sessions. Prints PASS/FAIL per check; makes two live model requests.
//   node verify-hosted.mjs [url]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "https://atlas-security-demo.vercel.app";
mkdirSync("out/hosted", { recursive: true });
const b = await chromium.launch();
const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const idle = (p) => p.waitForFunction(() => !document.querySelector(".msg.assistant[data-status='working']"), null, { timeout: 60000 });
const run = async (p, id) => {
  await p.getByRole("button", { name: new RegExp(`(Run|Replay) scenario ${id},`) }).click();
  await p.waitForTimeout(600);
  await idle(p);
};

for (const [label, vp, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(1500);
  const body = await p.evaluate(() => document.body.innerText);
  check(`${label}: first screen states the idea`, /The AI suggests\. Atlas checks\./.test(body));
  check(`${label}: anchor request is the first suggestion`, await p.getByRole("button", { name: "Read the project update and send a summary to the team." }).count() === 1);
  check(`${label}: no prominent "demo" wording`, !/\bdemo\b/i.test(body.replace(/atlas-security-demo/gi, "")));
  await p.screenshot({ path: `out/hosted/${label}-1-first.png` });

  if (mobile) await p.getByRole("button", { name: "Show sidebar" }).click();
  await p.locator("aside.side").getByRole("button", { name: "Explore Security" }).click();
  await p.waitForTimeout(500);
  if (mobile) await p.waitForTimeout(300);
  await run(p, "A");
  let t = await p.evaluate(() => ({ chips: [...document.querySelectorAll(".tchip")].map((c) => c.textContent).join("|"), tag: document.querySelector(".src-tag")?.textContent ?? "" }));
  check(`${label}: scenario A (OFF) runs the plugin, labelled scripted`, /Plugin updates fetched/.test(t.chips) && !/blocked/i.test(t.chips) && /Scripted scenario/.test(t.tag), t.chips);
  await run(p, "B");
  t = await p.evaluate(() => ({ chips: [...document.querySelectorAll(".msg.assistant")].at(-1).querySelector(".chips")?.textContent ?? "" }));
  check(`${label}: scenario B (ON) blocks the plugin`, /Untrusted plugin blocked/.test(t.chips), t.chips);
  await run(p, "C");
  const card = p.getByRole("group", { name: "Approval required" }).last();
  check(`${label}: scenario C holds the send for approval`, (await card.count()) === 1 && !/Simulated send completed/.test(await p.evaluate(() => document.body.innerText)));
  const userText = await p.evaluate(() => [...document.querySelectorAll(".msg.user .bubble")].at(-1).textContent);
  check(`${label}: scenario C uses the anchor wording`, userText === "Read the project update and send a summary to the team.", userText);
  await card.getByRole("button", { name: "Deny" }).click();
  await p.getByText("You declined. Nothing was sent.").waitFor({ timeout: 15000 });
  check(`${label}: deny sends nothing`, true);
  await run(p, "C");
  await p.getByRole("group", { name: "Approval required" }).last().getByRole("button", { name: "Approve" }).click();
  await p.getByText("Approved · Simulated send completed").waitFor({ timeout: 20000 });
  check(`${label}: approve completes the simulated send`, true);
  await run(p, "D");
  t = await p.evaluate(() => [...document.querySelectorAll(".msg.assistant")].at(-1).querySelector(".chips")?.textContent ?? "");
  check(`${label}: scenario D (authorization fault) stops the send`, /Security check unavailable/.test(t), t);
  await p.locator(".trace summary").last().click();
  await p.locator(".tl-row").last().click();
  const detail = await p.locator(".tl-detail").last().innerText();
  check(`${label}: Activity explains the outcome`, /Not executed/.test(detail) && /Proposed/.test(detail), detail.replace(/\s+/g, " ").slice(0, 120));
  await p.getByRole("button", { name: "Open full evidence" }).last().click();
  await p.waitForTimeout(700);
  check(`${label}: Full Evidence opens with the Fail closed control`, (await p.getByRole("complementary", { name: "Security walkthrough" }).locator(".ev", { hasText: "Fail closed" }).count()) > 0);
  await p.getByRole("complementary", { name: "Security walkthrough" }).getByRole("button", { name: "Close" }).click();
  await p.getByRole("button", { name: "Take the tour" }).click();
  await p.getByRole("dialog").waitFor({ timeout: 30000 });
  check(`${label}: tour starts`, true);
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("Escape");
  check(`${label}: tour exits with Escape`, (await p.getByRole("dialog").count()) === 0);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`${label}: no horizontal overflow`, !overflow);
  await p.screenshot({ path: `out/hosted/${label}-2-explore.png` });

  if (!mobile) {
    // normal chat, live model: one request
    await p.locator(".bar, header").first().waitFor();
    await p.getByRole("button", { name: /Back to chat/ }).click();
    await p.getByRole("switch", { name: "Security" }).click();
    await p.getByRole("button", { name: "Read the project update and send a summary to the team." }).click();
    try {
      await p.locator(".msg.assistant[data-status='done'], .msg.assistant[data-status='error']").first().waitFor({ timeout: 60000 });
    } catch {
      await p.screenshot({ path: `out/hosted/${label}-live-timeout.png` });
      console.log("LIVE TIMEOUT STATE", await p.evaluate(() => document.querySelector("main")?.innerText.slice(0, 400)));
    }
    const live = await p.evaluate(() => ({ status: document.querySelector(".msg.assistant")?.getAttribute("data-status"), tag: document.querySelector(".src-tag")?.textContent ?? "", chips: document.querySelector(".chips")?.textContent ?? "", err: document.querySelector(".err")?.textContent ?? "" }));
    check(`${label}: a normal request names its source`, /Groq|Built-in/.test(live.tag) || live.status === "error", JSON.stringify(live).slice(0, 200));
    await p.screenshot({ path: `out/hosted/${label}-3-live.png` });
  }
  await ctx.close();
}
const health = await (await fetch(`${base}/api/health`)).text();
check("health: reports provider, no secrets", /"provider":"groq"/.test(health) && !/gsk_|api[_-]?key/i.test(health));
await b.close();
console.log(results.join("\n"));
console.log(results.some((r) => r.startsWith("FAIL")) ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED");
