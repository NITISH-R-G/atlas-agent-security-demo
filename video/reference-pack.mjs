// Builds assets/reference/ (product screenshots from the deployed app and diagram exports) and assets/video-thumbnail.png.
// Product screenshots use scripted-demo requests (the real server still decides), so they need no live model and show no private data.
//   node reference-pack.mjs
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { OUT, ROOT } from "./lib.mjs";

const URL = process.env.ATLAS_URL ?? "https://atlas-security-demo.vercel.app";
const REF = join(ROOT, "..", "assets", "reference");
const EXPORTS = join(ROOT, "..", "docs", "architecture", "exports");
mkdirSync(REF, { recursive: true });
mkdirSync(join(OUT, "ref"), { recursive: true });

const dataUri = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const b = await chromium.launch();

async function capture(ctxOpts, file, afterLoad) {
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  await p.route("**/api/chat", (route) => route.continue({ postData: JSON.stringify({ ...JSON.parse(route.request().postData() ?? "{}"), demo: true }) }));
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(1500);
  await afterLoad(p);
  await p.screenshot({ path: file, timeout: 60000 });
  await ctx.close();
}

const conversation = async (p) => {
  await p.getByRole("switch", { name: "Security" }).click();
  await p.getByRole("button", { name: "Send the project summary to the team." }).click();
  await p.waitForSelector(".approval", { timeout: 30000 });
  await p.waitForTimeout(800);
};

// Desktop (1920x1080)
await capture({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, join(REF, "atlas-product-desktop.png"), conversation);

// Mobile screens at 390x844 @2x, then framed on a 16:9 canvas
const m1 = join(OUT, "ref", "m1.png");
const m2 = join(OUT, "ref", "m2.png");
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
await capture(mobile, m1, conversation);
await capture(mobile, m2, async (p) => {
  await p.getByRole("button", { name: "Show sidebar" }).click();
  await p.waitForTimeout(600);
});
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:1080px;background:radial-gradient(1200px 700px at 70% 10%,#e8eeff,transparent 60%),#f4f6fb;font-family:"Segoe UI",Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:90px;color:#121a30}
  img{height:900px;border-radius:44px;box-shadow:0 30px 80px rgba(20,30,70,.28);border:10px solid #121a30}
  .t{width:520px}.t h1{font-size:54px;margin:0 0 18px;letter-spacing:-.02em}.t p{font-size:26px;color:#4b556d;line-height:1.4;margin:0}
</style><div class="t"><h1>Responsive by design</h1><p>The same chat on a phone: the sidebar becomes a drawer, and approvals stay reachable. 390 × 844.</p></div>
<img src="${dataUri(m1)}"><img src="${dataUri(m2)}">`);
await page.waitForTimeout(500);
await page.screenshot({ path: join(REF, "atlas-product-mobile.png") });
await page.close();

// Diagrams (rendered from the SVG sources)
const map = {
  "architecture-overview.png": "architecture-overview.png",
  "request-lifecycle.png": "request-lifecycle.png",
  "approval-lifecycle.png": "approval-lifecycle.png",
  "security-mode-comparison.png": "security-mode-comparison.png",
  "fail-closed-flow.png": "fail-closed-flow.png",
  "simple-flow.png": "simple-flow.png",
  "safe-stop.png": "safe-stop.png",
};
for (const [from, to] of Object.entries(map)) copyFileSync(join(EXPORTS, from), join(REF, to));

// Thumbnail
const thumb = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await thumb.setContent(`<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:1080px;overflow:hidden;font-family:"Segoe UI",Inter,system-ui,sans-serif;color:#fff;
    background:radial-gradient(1200px 800px at 85% 10%,rgba(79,140,255,.35),transparent 60%),radial-gradient(900px 600px at 0% 100%,rgba(40,200,190,.2),transparent 60%),#0b1020}
  .logo{position:absolute;left:90px;top:80px;display:flex;align-items:center;gap:20px;font-size:44px;font-weight:650}
  .logo i{width:78px;height:78px;border-radius:24px;display:grid;place-items:center;font-style:normal;font-size:42px;background:linear-gradient(135deg,#3b6cff,#27c4d6);box-shadow:0 12px 40px rgba(60,110,255,.5)}
  h1{position:absolute;left:90px;top:300px;width:900px;font-size:104px;line-height:1.04;letter-spacing:-.03em;margin:0}
  h1 span{color:#8db4ff}
  p{position:absolute;left:94px;top:690px;width:820px;font-size:38px;line-height:1.35;color:#b6c2de;margin:0}
  .tag{position:absolute;left:94px;bottom:80px;font-size:28px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7fd3ff}
  img{position:absolute;right:70px;top:250px;width:860px;border-radius:26px;box-shadow:0 30px 90px rgba(0,0,0,.55);border:2px solid #2c3a62}
</style><div class="logo"><i>A</i>Atlas</div>
<h1>The AI suggests. <span>Atlas checks.</span></h1>
<p>A plain-English look at how Atlas decides whether an AI action may happen.</p>
<div class="tag">3-minute explainer · live demo</div>
<img src="${dataUri(join(EXPORTS, "simple-flow.png"))}">`);
await thumb.waitForTimeout(600);
await thumb.screenshot({ path: join(ROOT, "..", "assets", "video-thumbnail.png") });
await b.close();
writeFileSync(join(OUT, "ref", "done.txt"), "ok");
console.log("reference pack written to", REF);
