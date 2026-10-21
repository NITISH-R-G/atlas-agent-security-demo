// Turns an editable SVG from docs/architecture into an animated scene page.
// window.setStep(n) reveals every element with data-step <= n (nodes fade in, connectors draw);
// window.focusOn([ids]) mutes everything except the given ids; window.evidence(html) shows a small evidence card.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const SRC = join(ROOT, "..", "docs", "architecture");

export function diagramHtml(name) {
  const svg = readFileSync(join(SRC, `${name}.svg`), "utf8").replace(/^<\?xml[^>]*>\s*/, "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>
  html,body{margin:0;height:100%;background:#fbfcfe;overflow:hidden}
  svg{display:block;width:100vw;height:100vh}
  svg [data-step]{opacity:0;transition:opacity .9s cubic-bezier(.16,1,.3,1)}
  svg [data-step].on{opacity:1}
  svg [data-step] path.edge:not(.dashed){stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.1s cubic-bezier(.16,1,.3,1)}
  svg [data-step].on path.edge:not(.dashed){stroke-dashoffset:0}
  svg [data-step].dim{opacity:.16!important}
  svg [data-step].hot rect:not(.lbg):not(.boundary){stroke-width:5}
  #ev{position:fixed;left:3.4vw;bottom:19vh;width:36vw;background:#fff;border:2px solid #d93a35;border-radius:16px;padding:18px 22px;
     font:600 1.55vw/1.45 "Segoe UI",Inter,system-ui,sans-serif;color:#2a1210;box-shadow:0 18px 50px rgba(20,30,60,.18);opacity:0;transform:translateY(12px);transition:all .8s cubic-bezier(.16,1,.3,1)}
  #ev.on{opacity:1;transform:none}
  #ev small{display:block;font:700 .95vw/1 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#d93a35;margin-bottom:.7vw}
  #ev code{font:600 1.35vw ui-monospace,Consolas,monospace;color:#7d1b18}
  @media (prefers-reduced-motion: reduce){svg [data-step]{transition:none}}
</style></head><body>${svg}<div id="ev"></div>
<script>
  const els = [...document.querySelectorAll("svg [data-step]")];
  window.setStep = (n) => els.forEach((e) => e.classList.toggle("on", Number(e.dataset.step) <= n));
  window.focusOn = (ids) => els.forEach((e) => { e.classList.toggle("dim", !!ids && !ids.includes(e.dataset.id)); e.classList.toggle("hot", !!ids && ids.includes(e.dataset.id) && e.querySelector("rect:not(.lbg):not(.boundary)") !== null); });
  window.evidence = (html) => { const d = document.getElementById("ev"); if (html) { d.innerHTML = html; d.classList.add("on"); } else d.classList.remove("on"); };
  window.setStep(0);
</script></body></html>`;
}
