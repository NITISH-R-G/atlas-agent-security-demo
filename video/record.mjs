// Records every shot of the Atlas explainer. Shots alternate between the real product (deployed app), diagrams drawn from the
// SVG sources in docs/architecture (revealed step by step), and short cards. Timing comes from timeline.mjs (narration beats + pauses).
//   node record.mjs            all shots
//   node record.mjs s5a s6c    selected shots
// ATLAS_URL overrides the app URL. Live shots (s2, s5a) make one real Groq request each.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { diagramHtml } from "./diagram-page.mjs";
import { launch, openScene, OUT, ROOT, sleep } from "./lib.mjs";
import { at, captionEvents, endOf, sceneEnd, sceneStart, TOTAL } from "./timeline.mjs";

const URL = process.env.ATLAS_URL ?? "https://atlas-security-demo.vercel.app";
const only = process.argv.slice(2);
mkdirSync(join(OUT, "shots"), { recursive: true });

const RED = "#ff6b6b";
const AMBER = "#f5a524";
const GREEN = "#34c27a";
const CYAN = "#5cc8ff";
const card = (name) => pathToFileURL(join(ROOT, "cards", name)).href;

const side = (p) => p.locator("aside.side");
const exploreBtn = (p) => side(p).getByRole("button", { name: "Explore Security" });
const runBtn = (p, id) => p.getByRole("button", { name: new RegExp(`(Run|Replay) scenario ${id},`) });
const settled = async (p) => {
  await sleep(500); // let the click register before polling for the end of the reply
  await p.waitForFunction(() => !document.querySelector(".msg.assistant[data-status='working']"), null, { timeout: 40000 });
};
const switchEl = (p) => p.getByRole("switch", { name: "Security" });
const chips = (p) => p.locator(".chips");

/** Steps for a diagram scene: [absoluteTime, step] pairs. */
async function stepper(s, rel, plan) {
  for (const [abs, n] of plan) {
    await s.until(Math.max(0, rel(abs)));
    await s.page.evaluate((k) => window.setStep(k), n);
  }
}

const SHOTS = [
  {
    id: "h1",
    start: sceneStart("p1-what"),
    end: at("b03", -0.5),
    open: { url: card("hook.html") },
    async run() {},
  },
  {
    id: "h2",
    start: at("b03", -0.5),
    end: sceneEnd("p1-what"),
    open: { url: URL },
    async run(s, rel) {
      const p = s.page;
      await s.tag("Fictional data · simulated actions", AMBER);
      await s.until(rel(at("b03", 2.5)));
      await s.ring(p.getByRole("textbox", { name: "Message" }), CYAN);
      await s.until(rel(at("b03", 8.5)));
      await s.ring(switchEl(p), GREEN);
    },
  },
  {
    id: "d1",
    start: sceneStart("p2-flow"),
    end: sceneEnd("p2-flow"),
    open: { html: diagramHtml("simple-flow") },
    async run(s, rel) {
      await stepper(s, rel, [
        [at("b05", 0.9), 1],
        [at("n01", 0.3), 2],
        [at("n01", 5.0), 3],
        [at("n02", 0.3), 5],
        [at("n02", 5.2), 6],
        [at("n02", 8.0), 7],
        [at("n03", 0.2), 8],
      ]);
    },
  },
  {
    id: "c1",
    start: sceneStart("p3-see"),
    end: at("n05", -0.5),
    open: {
      url: URL,
      init: async (p) => {
        await exploreBtn(p).click();
      },
    },
    async run(s, rel) {
      const p = s.page;
      await s.tag("Scripted example · no AI model", AMBER);
      await s.until(rel(at("n04", 0.3)));
      await s.click(runBtn(p, "C"));
      await settled(p);
      const list = chips(p).last();
      await s.smoothScrollTo(list);
      await s.until(rel(at("n04", 2.6)));
      await s.ring(p.locator(".tchip").nth(0), GREEN);
      await s.until(rel(at("n04", 4.2)));
      await s.ring(p.locator(".tchip.pending").last(), AMBER);
    },
  },
  {
    id: "c2",
    start: at("n05", -0.5),
    end: sceneEnd("p3-see"),
    open: {
      url: URL,
      init: async (p) => {
        await exploreBtn(p).click();
        await switchEl(p).click();
      },
    },
    async run(s, rel) {
      const p = s.page;
      await s.tag("Scripted example · no AI model", AMBER);
      await s.until(rel(at("n05", 0.1)));
      await s.click(runBtn(p, "B"));
      await settled(p);
      const blocked = p.locator(".tchip.denied").last();
      await s.smoothScrollTo(blocked);
      await s.ring(blocked, RED);
    },
  },
  {
    id: "a1",
    start: sceneStart("p4-approval"),
    end: sceneEnd("p4-approval"),
    open: {
      url: URL,
      init: async (p) => {
        await exploreBtn(p).click();
        await switchEl(p).click();
      },
    },
    async run(s, rel) {
      const p = s.page;
      await s.tag("Scripted example · no AI model", AMBER);
      await s.until(rel(at("b17", 0.6)));
      await s.click(runBtn(p, "C"));
      await settled(p);
      const card = p.getByRole("group", { name: "Approval required" }).last();
      await s.smoothScrollTo(card);
      await s.until(rel(at("n06", 0.2)));
      await s.ring(card, AMBER);
      await s.until(rel(endOf("n06", 0.7)));
      await s.click(card.getByRole("button", { name: "Deny" }));
      await p.getByText("You declined. Nothing was sent.").waitFor();
      await s.unring();
      await s.until(rel(endOf("n06", 2.8)));
      await s.click(runBtn(p, "C"));
      await settled(p);
      const card2 = p.getByRole("group", { name: "Approval required" }).last();
      await s.smoothScrollTo(card2);
      await s.until(rel(endOf("n06", 5.2)));
      await s.click(card2.getByRole("button", { name: "Approve" }));
      await p.getByText("Approved · Simulated send completed").waitFor();
      await s.ring(p.locator(".approval-result.ok").last(), GREEN);
    },
  },
  {
    id: "f1",
    start: sceneStart("p5-fail"),
    end: sceneEnd("p5-fail"),
    open: { html: diagramHtml("safe-stop") },
    async run(s, rel) {
      await stepper(s, rel, [
        [at("n07", -0.7), 1],
        [at("n07", -0.3), 2],
        [at("n07", 0.1), 3],
        [at("n07", 1.8), 4],
        [at("n07", 3.2), 5],
      ]);
    },
  },
  {
    id: "r1",
    start: sceneStart("p6-remember"),
    end: at("b29", -0.8),
    open: {
      html: diagramHtml("simple-flow"),
      init: async (p) => {
        await p.evaluate(() => window.setStep(8));
      },
    },
    async run(s, rel) {
      const p = s.page;
      await s.until(rel(at("n08", 0.1)));
      await p.evaluate(() => window.focusOn(["you", "e1", "ai"]));
      await s.until(rel(at("n08", 1.7)));
      await p.evaluate(() => window.focusOn(["ai", "e2", "atlas", "term"]));
      await s.until(rel(at("n08", 3.2)));
      await p.evaluate(() => window.focusOn(["atlas", "e3", "e4", "allowed", "blocked"]));
      await s.until(rel(at("n09", -0.4)));
      await p.evaluate(() => {
        window.focusOn(null);
        window.setStep(9);
      });
      await s.until(rel(at("n09", 0.2)));
      await p.evaluate(() => window.focusOn(["atlas", "e5", "record"]));
    },
  },
  {
    id: "r2",
    start: at("b29", -0.8),
    end: sceneEnd("p6-remember"),
    open: { url: card("end.html") },
    async run() {},
  },
];

const events = captionEvents();
const browser = await launch();
for (const shot of SHOTS) {
  if (only.length && !only.includes(shot.id)) continue;
  const dur = shot.end - shot.start;
  console.log(`shot ${shot.id}: ${shot.start.toFixed(1)}s -> ${shot.end.toFixed(1)}s (${dur.toFixed(1)}s)`);
  const s = await openScene(browser, { ...shot.open, name: shot.id });
  const rel = (abs) => abs - shot.start;
  const caps = (async () => {
    for (const ev of events) {
      if (ev.end <= shot.start + 0.05 || ev.start >= shot.end) continue;
      await s.until(Math.max(0, rel(ev.start)));
      await s.caption(ev.text);
      await s.until(Math.min(dur, rel(ev.end)));
      await s.caption("");
    }
  })();
  await Promise.all([shot.run(s, rel), caps]);
  await s.until(dur);
  const frames = await s.finish(dur, join(OUT, "shots", `${shot.id}.mp4`));
  console.log(`  done ${shot.id} (${frames} frames)`);
}
await browser.close();
console.log(`total timeline ${(TOTAL / 60).toFixed(2)} min`);
