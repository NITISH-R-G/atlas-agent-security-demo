// Generates one narration clip per beat (1 to 3 sentences) with the ElevenLabs API. The key is read from ELEVENLABS_API_KEY and never printed.
// Beats are spoken separately so the video can place deliberate pauses between them. Existing clips are skipped, so re-running spends no quota.
// Delete out/audio/<beat>.mp3 to regenerate one clip.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ffprobe from "ffprobe-static";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
const cfg = JSON.parse(readFileSync(new URL("./narration.json", import.meta.url), "utf8"));
const dir = new URL("./out/audio/", import.meta.url);
mkdirSync(dir, { recursive: true });
const beats = cfg.scenes.flatMap((s) => s.beats);

const durations = {};
let spent = 0;
for (let i = 0; i < beats.length; i++) {
  const b = beats[i];
  const file = new URL(`${b.id}.mp3`, dir);
  if (!existsSync(file)) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voice.id}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: b.text,
        model_id: cfg.voice.model,
        previous_text: beats[i - 1]?.text,
        next_text: beats[i + 1]?.text,
        voice_settings: { stability: cfg.voice.stability, similarity_boost: cfg.voice.similarity_boost, style: cfg.voice.style, speed: cfg.voice.speed, use_speaker_boost: true },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} for ${b.id}: ${(await res.text()).slice(0, 200)}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    spent += b.text.length;
    console.log("generated", b.id, b.text.length, "chars");
  }
  const out = execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fileURLToPath(file)]).toString().trim();
  durations[b.id] = Number(out);
}
writeFileSync(new URL("./out/durations.json", import.meta.url), JSON.stringify(durations, null, 2));
const total = Object.values(durations).reduce((a, d) => a + d, 0);
console.log(`characters spent this run: ${spent}; speech total ${total.toFixed(1)}s`);
