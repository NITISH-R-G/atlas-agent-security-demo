// Generates one narration clip per scene with the ElevenLabs API (key read from ELEVENLABS_API_KEY, never printed).
// Skips scenes whose clip already exists so a re-run never spends quota twice. Delete out/audio/<id>.mp3 to regenerate.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ffprobe from "ffprobe-static";
import { fileURLToPath } from "node:url";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
const cfg = JSON.parse(readFileSync(new URL("./narration.json", import.meta.url), "utf8"));
const dir = new URL("./out/audio/", import.meta.url);
mkdirSync(dir, { recursive: true });

const durations = {};
for (const s of cfg.scenes) {
  const file = new URL(`${s.id}.mp3`, dir);
  if (!existsSync(file)) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voice.id}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: s.text, model_id: cfg.voice.model, voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} for ${s.id}: ${(await res.text()).slice(0, 200)}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log("generated", s.id, s.text.length, "chars");
  }
  const out = execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fileURLToPath(file)]).toString().trim();
  durations[s.id] = Number(out);
}
writeFileSync(new URL("./out/durations.json", import.meta.url), JSON.stringify(durations, null, 2));
console.log(durations);
