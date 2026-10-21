// Renders docs/architecture/*.svg to presentation-quality PNGs (1920x1080 and 3840x2160) from the SVG sources.
//   node build (docs/architecture/build.mjs) first, then: node export-diagrams.mjs
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { ROOT } from "./lib.mjs";

const SRC = join(ROOT, "..", "docs", "architecture");
const OUT = join(SRC, "exports");
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const f of readdirSync(SRC).filter((x) => x.endsWith(".svg"))) {
  const svg = readFileSync(join(SRC, f), "utf8").replace(/^<\?xml[^>]*>\s*/, "");
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fbfcfe}svg{display:block;width:100vw;height:100vh}</style>${svg}`;
  for (const [w, h, suffix] of [[1920, 1080, ""], [3840, 2160, "@2x"]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html);
    await p.waitForTimeout(200);
    await p.screenshot({ path: join(OUT, f.replace(".svg", `${suffix}.png`)) });
    await p.close();
  }
  console.log("exported", f);
}
await b.close();
