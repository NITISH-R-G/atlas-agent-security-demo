# Presenter guide

A short story to tell in your own words. The one sentence to keep: **the AI suggests, Atlas checks, and the action is allowed, held for approval, or blocked.**

Live: https://atlas-security-demo.vercel.app · Video (3 min): [`assets/demo.mp4`](../assets/demo.mp4) · Plain-language docs: [Level 1](01-understand-atlas.md)

## Before you start (2 minutes)

1. Open the site and check `/api/health` shows provider `groq` (it never shows keys).
2. Send one ordinary message so the server is warm.
3. Know where **Explore Security** is (sidebar, or the link under the message box).

## The story (about 3 minutes)

**1. Opening.** "AI assistants can now do more than answer questions. They can take actions. But who decides whether those actions are allowed?"

**2. A normal request.** Click the first suggestion: *Read the project update and send a summary to the team.* "Reading the update is allowed. Sending it needs my approval, so it waits." Point at the two small labels under the reply (allowed, approval required) and the amber approval card. Nothing has been sent yet.

**3. The key idea.** "The AI suggests what to do. Atlas checks it before the action runs." Open **Activity** to show the recorded reason for each step. Keep **Full Evidence** closed unless someone asks.

**4. Decide.** Press **Deny**: "Nothing was sent." Run it again and press **Approve**: "Atlas checks again, then the send is simulated. No real message leaves the app."

**5. A blocked action.** Open **Explore Security**, run **B**: "This plugin is not trusted, so Atlas stops it. The assistant uses the verified project record instead." Optional contrast: **A** shows what happens with Security off, a controlled weakness shown for comparison. It is scripted so it repeats.

**6. A failed check.** Run **D**: "If the required check cannot run, the protected action stops." Say it is a simulated failure, not a real outage.

**7. Close.** "The main idea is simple: the AI suggests, Atlas checks, and the action is allowed, held, or blocked."

Optional: **Take the tour** in Explore Security (five short steps).

## Say these out loud

- Everything is fictional and every send is simulated.
- Scripted scenarios (A to D) do not call an AI model; live replies say which model answered.
- The Security switch compares two modes for learning. It is not a login and not a production security boundary.
- Atlas does not stop every attack and has not been independently penetration tested.

## If something goes wrong

| Problem | What to do |
|---|---|
| The live model errors or is rate limited | Atlas shows an honest error. Do not retry repeatedly. Carry on with Explore Security: scenarios A to D never use a model. |
| "Unknown or expired" on Approve | The approval expired (10 minutes) or the server restarted. Run the request again. |
| The site is slow to start | Open `/api/health` first and wait for it; the first request after idle takes a few seconds. |
| The hosted site does not match the video wording | The video was recorded from a local build while a redeploy was blocked. Say so, and use the local build or the video. |
| A live reply does not suggest a tool | Models vary. Use the scripted scenarios, which are repeatable. |

## Where the detail lives

Engineering explanation (controls, approvals, activity records, tests, limits): [Level 3](03-engineering-details.md), [SECURITY.md](SECURITY.md), and the [coverage matrix](SECURITY-COVERAGE.md). Do not narrate those live.

## Local run

```bash
npm install && npm run dev        # http://localhost:3000
npm test                          # deterministic suites
npm run test:live                 # real provider checks (skipped, not passed, without a key)
```
