// Computes the absolute timeline from narration.json (beats, deliberate pauses) and the generated audio durations.
// Speech is slowed slightly with a pitch-preserving tempo change (TEMPO) so it never sounds rushed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, ROOT } from "./lib.mjs";

export const TEMPO = 0.93;
export const SCENE_LEAD = 1.0; // silence at the start of each scene
export const SCENE_TAIL = 0.5;

export const narration = JSON.parse(readFileSync(join(ROOT, "narration.json"), "utf8"));
const raw = JSON.parse(readFileSync(join(OUT, "durations.json"), "utf8"));
export const speechSeconds = (id) => raw[id] / TEMPO;

export const beats = {};
export const scenes = {};
let t = 0;
for (const s of narration.scenes) {
  const start = t;
  let local = SCENE_LEAD;
  for (const b of s.beats) {
    const d = speechSeconds(b.id);
    beats[b.id] = { scene: s.id, text: b.text, start: start + local, dur: d, end: start + local + d, pause: b.pause };
    local += d + b.pause;
  }
  local += SCENE_TAIL;
  scenes[s.id] = { start, end: start + local, title: s.title };
  t += local;
}
export const TOTAL = t;

/** Absolute time of a beat start plus an offset. */
export const at = (beatId, offset = 0) => beats[beatId].start + offset;
export const endOf = (beatId, offset = 0) => beats[beatId].end + offset;
export const sceneStart = (id) => scenes[id].start;
export const sceneEnd = (id) => scenes[id].end;

/** Keeps every caption to at most two lines by splitting long sentences at a comma or colon near the middle. */
function splitLong(s) {
  if (s.length <= 118) return [s];
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (/[,:;]/.test(s[i]) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  if (best < 0) return [s];
  return [s.slice(0, best + 1).trim(), s.slice(best + 1).trim()].flatMap(splitLong);
}

/** Caption chunks: each beat split into sentences, timed in proportion to length within the beat's speech window. */
export function captionEvents() {
  const ev = [];
  for (const b of Object.values(beats)) {
    const sentences = b.text.split(/(?<=[.?!])\s+/).filter(Boolean).flatMap(splitLong);
    const total = sentences.reduce((a, s) => a + s.length, 0);
    let cur = b.start;
    for (const s of sentences) {
      const d = (s.length / total) * b.dur;
      ev.push({ start: cur, end: cur + d, text: s });
      cur += d;
    }
  }
  return ev;
}
