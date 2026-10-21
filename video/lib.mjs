// Frame-accurate capture of the real browser UI at 1920x1080 using CDP screencast (viewport 1280x720 @ 1.5x device scale),
// plus the on-screen overlays (caption, source label, cursor, highlight ring) that are drawn into the page itself.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const OUT = join(ROOT, "out");
export const FF = ffmpegPath;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OVERLAY_CSS = `
#atlas-cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1080px;z-index:2147483000;pointer-events:none;
  background:rgba(12,16,28,.86);color:#fff;font:600 22px/1.35 Inter,system-ui,sans-serif;letter-spacing:-.005em;text-align:center;
  padding:10px 22px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .25s}
#atlas-cap.on{opacity:1}
#atlas-tag{position:fixed;left:16px;top:230px;width:236px;white-space:normal;line-height:1.35!important;z-index:2147483000;pointer-events:none;
  font:700 13px/1 Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;padding:10px 14px;border-radius:14px;
  background:rgba(12,16,28,.88);color:#fff;border:1.5px solid var(--c,#7aa7ff);opacity:0;transition:opacity .3s}
#atlas-tag.on{opacity:1}
#atlas-tag i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c,#7aa7ff);margin-right:8px;vertical-align:1px}
#atlas-cursor{position:fixed;left:0;top:0;width:20px;height:20px;z-index:2147483001;pointer-events:none;transform:translate(-100px,-100px);transition:transform .02s linear}
#atlas-cursor::before{content:"";position:absolute;inset:0;border-radius:50%;background:rgba(255,255,255,.9);border:2px solid #1b2440;box-shadow:0 2px 8px rgba(0,0,0,.35)}
#atlas-cursor.down::after{content:"";position:absolute;left:-14px;top:-14px;width:48px;height:48px;border-radius:50%;border:3px solid rgba(80,130,255,.7);animation:rip .45s ease-out forwards}
@keyframes rip{from{transform:scale(.4);opacity:1}to{transform:scale(1.2);opacity:0}}
.atlas-ring{position:fixed;z-index:2147482999;pointer-events:none;border-radius:14px;border:3px solid var(--c,#4f8cff);box-shadow:0 0 0 6px color-mix(in srgb,var(--c,#4f8cff) 22%,transparent);transition:all .35s cubic-bezier(.16,1,.3,1)}
`;

export async function openScene(browser, { url, html, init, width = 1280, height = 720, scale = 1.5, name }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: "light", locale: "en-US" });
  const page = await ctx.newPage();
  if (html) await page.setContent(html, { waitUntil: "load" });
  else {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle");
  }
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    for (const id of ["atlas-cap", "atlas-tag", "atlas-cursor"]) {
      const d = document.createElement("div");
      d.id = id;
      document.body.appendChild(d);
    }
    document.addEventListener("mousemove", (e) => {
      document.getElementById("atlas-cursor").style.transform = `translate(${e.clientX - 10}px,${e.clientY - 10}px)`;
    });
    document.addEventListener("mousedown", () => {
      const c = document.getElementById("atlas-cursor");
      c.classList.remove("down");
      void c.offsetWidth;
      c.classList.add("down");
    });
  });
  if (init) await init(page);
  await page.waitForTimeout(600);
  const dir = join(OUT, "frames", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async (ev) => {
    const file = join(dir, `${String(n++).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(ev.data, "base64"));
    frames.push({ file, t: ev.metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: Math.round(width * scale), maxHeight: Math.round(height * scale), everyNthFrame: 1 });
  const t0 = Date.now();
  const scene = {
    page,
    ctx,
    elapsed: () => (Date.now() - t0) / 1000,
    /** Wait until the scene clock reaches t seconds. */
    async until(t) {
      const ms = t * 1000 - (Date.now() - t0);
      if (ms > 0) await sleep(ms);
    },
    async caption(text) {
      await page.evaluate((t) => {
        const c = document.getElementById("atlas-cap");
        if (!t) c.classList.remove("on");
        else {
          c.textContent = t;
          c.classList.add("on");
        }
      }, text);
    },
    async tag(text, color = "#7aa7ff") {
      await page.evaluate(([t, c]) => {
        const g = document.getElementById("atlas-tag");
        if (!t) g.classList.remove("on");
        else {
          g.innerHTML = `<i></i>${t}`;
          g.style.setProperty("--c", c);
          g.classList.add("on");
        }
      }, [text, color]);
    },
    async ring(locator, color = "#4f8cff") {
      const box = await locator.first().boundingBox();
      if (!box) return;
      await page.evaluate(([b, c]) => {
        let r = document.querySelector(".atlas-ring");
        if (!r) {
          r = document.createElement("div");
          r.className = "atlas-ring";
          document.body.appendChild(r);
        }
        r.style.setProperty("--c", c);
        r.style.left = `${b.x - 6}px`;
        r.style.top = `${b.y - 6}px`;
        r.style.width = `${b.width + 12}px`;
        r.style.height = `${b.height + 12}px`;
        r.style.opacity = "1";
      }, [box, color]);
    },
    async unring() {
      await page.evaluate(() => {
        const r = document.querySelector(".atlas-ring");
        if (r) r.style.opacity = "0";
      });
    },
    async move(locator, { dx = 0, dy = 0 } = {}) {
      const el = locator.first();
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 22 });
    },
    async click(locator) {
      await this.move(locator);
      await sleep(160);
      await locator.first().click({ delay: 60 });
    },
    async type(locator, text, perChar = 38) {
      await this.click(locator);
      await page.keyboard.type(text, { delay: perChar });
    },
    async smoothScrollTo(locator) {
      await locator.first().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      await sleep(700);
    },
    /** Stop capturing and render the frames to an mp4 of exactly `duration` seconds. */
    async finish(duration, file) {
      await sleep(250);
      await cdp.send("Page.stopScreencast").catch(() => {});
      await ctx.close();
      if (frames.length === 0) throw new Error(`no frames captured for ${name}`);
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const next = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + 0.5;
        lines.push(`file '${frames[i].file.replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
      }
      lines.push(`file '${frames.at(-1).file.replace(/\\/g, "/")}'`);
      const list = join(dir, "list.txt");
      writeFileSync(list, lines.join("\n"));
      const fade = 0.3;
      const r = spawnSync(
        FF,
        [
          "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list,
          "-vf", `fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=30,trim=duration=${duration},fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}`,
          "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", "30", "-an", file,
        ],
        { encoding: "utf8" },
      );
      if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}: ${r.stderr}`);
      return frames.length;
    },
  };
  return scene;
}

export async function launch() {
  return chromium.launch();
}
