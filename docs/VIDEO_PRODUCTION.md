# Video production guide

`assets/demo.mp4` is a 3 minute explainer for first-time viewers. It replaces the earlier 6 minute engineering cut, which introduced too many ideas at once. This document records the story, narration, timeline, sources and how to rebuild it.

## Purpose and main takeaway

A viewer with no background in AI agents should understand Atlas from the video alone:

> **The AI suggests an action. Atlas checks whether it is allowed. If it is not allowed, the action does not happen.**

Everything else supports that sentence. Engineering depth lives in [Level 3 of the docs](03-engineering-details.md), not in the video.

## The story and the one example

One fictional request anchors the whole video: *"Read the project update and send a summary to the team."* In the app (scenario C) this is exactly what happens: reading the project record is **allowed**, sending the summary **needs approval** and waits, then the viewer sees a Deny (nothing sent) and an Approve (simulated send completed). A second scripted run (scenario B) shows a plugin that is not verified being **blocked**. A simulated failed check then shows Atlas stopping safely.

Order of ideas: what Atlas is, then three objects (You, AI, Atlas checks) with two outcomes (Allowed, Blocked), then the real app, then approval, then a failed check, then the three-sentence summary. Restricted documents, Security OFF versus ON, tickets and the audit pipeline are deliberately left to the docs and the app.

## Plain words first, technical words after

| Said in the video | Technical term (introduced only after the plain explanation) |
|---|---|
| AI suggestion | model-proposed tool call (not used in the video) |
| Atlas checks | server-side security check (the narration says "Engineers call this a security check on the server") |
| Allowed, blocked | authorization decisions |
| Needs your approval, waiting | approval gate (not used) |
| Stops safely | fail closed (not used) |
| Activity record | audit event (not used) |

The video never uses the words policy, scope, ticket, trust boundary, authorization or audit.

## Narration script

Each beat is a separate clip, so pauses come from the timeline. Beats `b..` were reused from earlier cached audio (identical text); `n..` beats are new.

### What is Atlas?

- **b01** (0:01, pause 1.5 s): When an AI agent decides to do something, what actually decides whether it is allowed to happen?
- **b02** (0:09, pause 3 s): That question is behind this whole project. It's called Atlas.
- **b03** (0:17, pause 3.5 s): Atlas looks like an ordinary assistant. You type a request, and it can use tools: read a project record, open a document, fetch updates from a plugin, or send a message.

### The important difference

- **b05** (0:33, pause 2.4 s): Let's build the flow, one piece at a time. It starts with you, sending a request.
- **n01** (0:41, pause 3.2 s): Say you ask: read the project update, and send a summary to the team. The AI reads your request, and suggests what to do.
- **n02** (0:53, pause 3.5 s): Atlas checks each suggestion before anything runs. If it's allowed, the action happens. If it's blocked, the action stops.
- **n03** (1:07, pause 5 s): Engineers call this a security check on the server.

### See it work

- **n04** (1:17, pause 3.8 s): Reading the project update is allowed. Sending the summary needs your approval, so it waits.
- **n05** (1:27, pause 4 s): Here, Atlas blocked a plugin that wasn't verified.

### Why approval matters

- **b17** (1:36, pause 2 s): Some actions are allowed, but only with a human decision. Sending a message to the team is one of them.
- **n06** (1:45, pause 6.5 s): Right now, the action is waiting, not done. Let's say no first, then yes.
- **b20** (1:57, pause 4 s): And remember, a send here only writes to a simulated outbox. No message ever leaves the application.

### What if a check fails?

- **n07** (2:10, pause 3.8 s): What if a check can't run? Atlas stops safely, and nothing happens.
- **b25** (2:19, pause 4 s): This was a controlled, simulated failure. It does not prove how the system behaves in a real infrastructure outage.

### What to remember

- **b26** (2:33, pause 1.8 s): So, what did Atlas demonstrate?
- **n08** (2:37, pause 4 s): The AI suggests. Atlas checks. The action is allowed, or blocked.
- **n09** (2:47, pause 3.2 s): Every decision is saved in an activity record.
- **b29** (2:53, pause 5 s): You can try the live demo and read the code on GitHub. Thanks for watching.

## Scene and shot timeline

| Part | Time | Duration |
|---|---|---|
| What is Atlas? | 0:00 to 0:32 | 32 s |
| The important difference | 0:32 to 1:16 | 44 s |
| See it work | 1:16 to 1:35 | 19 s |
| Why approval matters | 1:35 to 2:09 | 34 s |
| What if a check fails? | 2:09 to 2:32 | 23 s |
| What to remember | 2:32 to 3:03 | 31 s |

| Shot | Part | Visual | Mode | Key on-screen text |
|---|---|---|---|---|
| h1 | What is Atlas? | Dark card: "An AI can suggest an action. Who decides if it happens?", then the Atlas name | Card | An AI can suggest an action. Who decides if it happens? |
| h2 | What is Atlas? | The real, clean chat; rings on the message box and the Security switch | Product | Fictional data, simulated actions |
| d1 | The important difference | Diagram, drawn in order: You, the request, AI, Atlas checks, Allowed, Blocked, the term | Diagram | You / AI / Atlas checks / Allowed / Blocked |
| c1 | See it work | Scenario C: Get project record is allowed, Send message waits for approval | Product | Scripted example, no AI model |
| c2 | See it work | Scenario B: the unverified plugin is blocked | Product | Scripted example, no AI model |
| a1 | Why approval matters | Scenario C: approval card, Deny (declined), run again, Approve (simulated send completed) | Product | Scripted example, no AI model |
| f1 | What if a check fails? | Diagram: You, AI, Atlas checks, Check unavailable, Stops | Diagram | A simulated failure in the demo, not a real outage |
| r1 | What to remember | The same diagram, highlighting AI, then Atlas checks, then Allowed or Blocked, then the Activity record | Diagram | The AI suggests. Atlas checks. |
| r2 | What to remember | Closing card with the live demo and repository | Card | Try Atlas, and read the code |

Rules followed: one diagram at a time; the diagram starts nearly empty and grows as each idea is spoken; a finished diagram is held still while the viewer reads it; no more than two things on screen besides the footer caption (at most two lines).

## Honest labelling

Product shots carry a label: "Fictional data, simulated actions" or "Scripted example, no AI model". The video does not use the live model. The end card says the data is fictional, the actions simulated, and that this is an educational demo that is not independently penetration tested. The spoken text says the failure is "controlled" and "simulated" and "does not prove how the system behaves in a real infrastructure outage".

## Sources

| File | Role |
|---|---|
| `video/narration.json` | scenes, beats, text, pauses, voice settings |
| `video/generate-audio.mjs` | ElevenLabs text to speech per beat; skips clips that exist |
| `video/timeline.mjs` | absolute timeline and caption chunks |
| `docs/architecture/build.mjs`, `simple-flow.svg`, `safe-stop.svg` | the two beginner diagrams (editable) |
| `video/diagram-page.mjs`, `video/cards/*.html` | stepwise diagram scenes, opening and closing cards |
| `video/record.mjs` | nine shots; product shots drive the app with Playwright |
| `video/compose.mjs` | joins shots, places audio, normalizes loudness, writes `demo.srt` |
| `video/reference-pack.mjs` | `assets/reference/` and `assets/video-thumbnail.png` |

## Regenerate

```bash
cd video && npm install && npx playwright install chromium
node ../docs/architecture/build.mjs && node export-diagrams.mjs
ELEVENLABS_API_KEY=... node generate-audio.mjs   # spends characters only for beats without a clip
ATLAS_URL=https://atlas-security-demo.vercel.app node record.mjs
node compose.mjs
node reference-pack.mjs
```

## Voice and audio

- Provider: **ElevenLabs**, free plan, hosted API only. Voice "Sarah", model `eleven_multilingual_v2`, speed 0.95, stability 0.55, similarity 0.75, style 0.1; pitch-preserving tempo 0.93 and loudness normalization to -16 LUFS.
- Cost of this revision: 687 new characters (9 new beats). Nine beats were reused from cached audio. The free monthly allowance is now almost used (9,940 of 10,000) and renews on 18 November 2026.
- Not verified by a person: the audio was checked by waveform analysis (level, silence structure, alignment by construction), not by listening.

## Output

| Property | Value |
|---|---|
| File | `assets/demo.mp4` |
| Format | 1920 x 1080, 30 fps, H.264, AAC stereo |
| Duration | 3 minutes 2.6 seconds |
| Size | 11.7 MB |
| Footage source | a local production build of the same commit (`next start`), because the hosted deployment could not be updated in time: Vercel's free plan rejected further uploads for 24 hours. The interface is identical apart from the scenario C request wording, which the hosted site still shows as "Send the project summary to the team." until it is redeployed |

## Verified, illustrative, untested

- **Verified:** every product shot is the real application with real server decisions; scripted scenarios are labelled; the approval buttons and results shown are the app's own; tests (355 passing, 11 live skipped) cover the behaviours shown.
- **Illustrative:** the two beginner diagrams simplify the implementation; "Atlas checks" stands for the server-side pipeline described in [ARCHITECTURE.md](ARCHITECTURE.md). The failed check is a simulated fault.
- **Untested or not claimed:** real outages, Groq rate limits on the hosted site, several devices at once, any independent penetration test.
