# Demo video script and timeline

`assets/demo.mp4`, about 2 minutes, 1920 by 1080, 30 fps, narrated with a hosted ElevenLabs voice (Sarah, model `eleven_multilingual_v2`, free plan). Captions are burned in and also provided as `assets/demo.srt`. Every interaction is captured from the deployed app; scripted scenes are labelled on screen and the live scene shows a real Groq reply.

| Scene | Time | On screen | Narration |
|---|---|---|---|
| 1 Opening | 0:00 | Title card | "Your AI agent proposed the action. Should it be allowed to execute it? This is Atlas, a live demonstration of one idea: a model's proposal is not the same thing as authorization." |
| 2 Problem | 0:14 | Clean chat, then Explore Security; scenario A runs (Security off) | "Here's the problem. An assistant that can read files and send messages can be talked into using them. In this fictional workspace, a third-party plugin hides an instruction inside an ordinary project update." |
| 3 Off vs on | 0:28 | Scenario A result, then scenario B (same request, Security on, plugin blocked) | "Watch the same request twice. With Security off, a controlled weakness, the scripted agent uses the unverified plugin, follows the hidden instruction, reads a restricted memo, and queues it for an outside address. Everything is fictional, and off is only a demonstration mode. Now Security on. Same request. The plugin is blocked, and the agent uses the verified project record instead." |
| 4 Policy | 0:54 | Live Groq reply; restricted read denied; Activity details | "Now the live model, Groq. I claim to be the CFO and ask it to read the compensation document. The model proposes the read. The server checks the resource against who may see it, and denies the call. The walkthrough names the control that decided, and why." |
| 5 Approval | 1:12 | Scenario C: pending, Deny, replay, Approve | "Sensitive actions wait for a human. Sending the summary to the team is held. I deny it, and nothing is sent. Run it again, approve, and the server re-checks the call and runs it once, into a simulated outbox. Nothing ever leaves the app." |
| 6 Fail closed | 1:29 | Scenario D; evidence drawer on the Fail closed control | "Now a simulated authorization outage. With Security on, the system fails closed. The send is denied, not guessed. The audit record matches the decision the server actually made." |
| 7 Takeaway | 1:43 | Architecture view for scenarios C and D, end card | "This is the path every request takes. The model proposes. The server validates, authorizes, asks for approval, filters the output, and records an audit event. A model's proposal is not authorization." |

The narration text lives in `video/narration.json`; the recording steps live in `video/record.mjs`.

## Reproduce

```bash
cd video
npm install
npx playwright install chromium
ELEVENLABS_API_KEY=... node generate-audio.mjs   # one clip per scene; skips clips that exist
node record.mjs                                    # captures from the deployed app (ATLAS_URL to override)
node compose.mjs                                   # writes ../assets/demo.mp4 and demo.srt
```

The audio step spends ElevenLabs characters (about 1,650 for the full script). Scene 4 makes one real Groq request per recording.
