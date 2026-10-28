// Real-browser check of the approval flow (shows the message being approved, then Approve and Deny work through /api/approve).
//   node approval-check.mjs [url]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3400";
const b = await chromium.launch();
const out = [];
const check = (name, ok, extra = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
const run = async (decision) => {
  const p = await (await b.newContext()).newPage();
  await p.goto(base);
  await p.getByLabel("Message", { exact: true }).fill("Read the project update and send a summary to the team.");
  await p.keyboard.press("Enter");
  await p.waitForSelector(".approval", { timeout: 30000 });
  const shown = await p.locator(".approval-what").innerText();
  check(`${decision}: approval card shows subject, recipient and message`, /Send ".+" to team@atlas-labs\.example\. Message: .+/.test(shown), shown.slice(0, 90));
  await p.getByRole("button", { name: decision === "approve" ? /^Approve/ : /^Deny/ }).click();
  await p.waitForSelector(".approval-result", { timeout: 30000 });
  const result = await p.locator(".approval-result").innerText();
  check(`${decision}: result reported`, decision === "approve" ? /queued in outbox/i.test(result) : /not sent|nothing was sent|denied/i.test(result), result.slice(0, 80));
  await p.close();
};
await run("approve");
await run("deny");
console.log(out.join("\n"));
await b.close();
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
