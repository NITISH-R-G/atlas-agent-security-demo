// Joins the recorded scene videos with the narration audio, writes SRT captions and the final optimized MP4.
//   node compose.mjs [outputDir]   (default: ../assets)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ffprobe from "ffprobe-static";
import { FF, OUT, ROOT } from "./lib.mjs";

const dest = resolve(process.argv[2] ?? join(ROOT, "..", "assets"));
mkdirSync(dest, { recursive: true });
const narration = JSON.parse(readFileSync(join(ROOT, "narration.json"), "utf8"));
const durations = JSON.parse(readFileSync(join(OUT, "durations.json"), "utf8"));
const LEAD = 0.5;

const run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.slice(0, 6).join(" ")} failed:\n${r.stderr}`);
  return r.stdout;
};
const dur = (file) => Number(run(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
const ts = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

const parts = [];
const srt = [];
let offset = 0;
let n = 1;
for (const s of narration.scenes) {
  const video = join(OUT, "scenes", `${s.id}.mp4`);
  const audio = join(OUT, "audio", `${s.id}.mp3`);
  const d = dur(video);
  const out = join(OUT, "scenes", `${s.id}.av.mp4`);
  run(FF, ["-y", "-v", "error", "-i", video, "-i", audio, "-filter_complex", `[1:a]adelay=${Math.round(LEAD * 1000)}|${Math.round(LEAD * 1000)},apad,atrim=0:${d}[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-t", String(d), out]);
  parts.push(out);
  // captions: same sentence timing as the on-screen ones
  const sentences = s.text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const total = sentences.reduce((a, x) => a + x.length, 0);
  let t = LEAD;
  for (const sentence of sentences) {
    const start = t;
    t += (sentence.length / total) * durations[s.id];
    srt.push(`${n++}\n${ts(offset + start)} --> ${ts(offset + t - 0.05)}\n${sentence}\n`);
  }
  offset += d;
}
writeFileSync(join(OUT, "list.txt"), parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
const joined = join(OUT, "joined.mp4");
run(FF, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(OUT, "list.txt"), "-c", "copy", joined]);
const final = join(dest, "demo.mp4");
run(FF, [
  "-y", "-v", "error", "-i", joined,
  "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
  "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", "30", "-g", "60",
  "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart", final,
]);
writeFileSync(join(dest, "demo.srt"), srt.join("\n"));
console.log("wrote", final, `${dur(final).toFixed(1)}s`);
