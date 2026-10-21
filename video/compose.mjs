// Joins the recorded shots, places every narration beat at its absolute time (slowed slightly with a pitch-preserving tempo),
// writes SRT captions and the final optimized MP4.
//   node compose.mjs [outputDir]   (default: ../assets)
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ffprobe from "ffprobe-static";
import { FF, OUT, ROOT } from "./lib.mjs";
import { beats, captionEvents, TEMPO, TOTAL } from "./timeline.mjs";

const dest = resolve(process.argv[2] ?? join(ROOT, "..", "assets"));
mkdirSync(dest, { recursive: true });
const ORDER = ["s1", "s2", "s3", "s4a", "s4b", "s5a", "s5b", "s6a", "s6b", "s6c", "s7a", "s7b", "s8a", "s8b", "s8c"];

const run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${bin} failed:\n${r.stderr.slice(-1500)}`);
  return r.stdout;
};
const dur = (file) => Number(run(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
const ts = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

// 1. video: concatenate the shots
const shots = ORDER.map((id) => join(OUT, "shots", `${id}.mp4`));
let videoTotal = 0;
for (const s of shots) videoTotal += dur(s);
writeFileSync(join(OUT, "shots.txt"), shots.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
const joined = join(OUT, "joined.mp4");
run(FF, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(OUT, "shots.txt"), "-c", "copy", joined]);

// 2. audio: every beat at its absolute start
const ids = Object.keys(beats);
const inputs = ids.flatMap((id) => ["-i", join(OUT, "audio", `${id}.mp3`)]);
const filters = ids.map((id, i) => `[${i}:a]atempo=${TEMPO},adelay=${Math.round(beats[id].start * 1000)}|${Math.round(beats[id].start * 1000)}[a${i}]`).join(";");
const mix = `${ids.map((_, i) => `[a${i}]`).join("")}amix=inputs=${ids.length}:normalize=0:duration=longest,apad,atrim=0:${videoTotal.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
const audio = join(OUT, "narration.m4a");
run(FF, ["-y", "-v", "error", ...inputs, "-filter_complex", `${filters};${mix}`, "-map", "[aout]", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", audio]);

// 3. mux and optimize
const final = join(dest, "demo.mp4");
run(FF, ["-y", "-v", "error", "-i", joined, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", "30", "-g", "60", "-c:a", "copy", "-shortest", "-movflags", "+faststart", final]);

const srt = captionEvents().map((e, i) => `${i + 1}\n${ts(e.start)} --> ${ts(Math.max(e.start + 0.2, e.end - 0.05))}\n${e.text}\n`);
writeFileSync(join(dest, "demo.srt"), srt.join("\n"));
console.log("timeline", TOTAL.toFixed(1), "video", videoTotal.toFixed(1), "final", dur(final).toFixed(1), final);
