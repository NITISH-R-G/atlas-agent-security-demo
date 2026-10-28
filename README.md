<div align="center">

# Atlas

**The AI suggests. Atlas checks. The action is allowed, held for approval, or blocked.**

An interactive project for exploring security for AI agents.

<img src="assets/reference/simple-flow.png" alt="You ask, the AI suggests, Atlas checks, and the action is either allowed or blocked" width="860">

**[Try Atlas](https://atlas-security-demo.vercel.app)** · **[Watch the 3-minute video](assets/demo.mp4)** · [Documentation](docs/README.md)

</div>

## What Atlas does

Atlas is a chat assistant that can use tools: read a project record, open a document, fetch plugin updates, send a message. The AI only *suggests* which tool to use. Before anything runs, Atlas checks the suggestion, and the result is one of three outcomes:

| Outcome | What happens |
|---|---|
| **Allowed** | The action runs. |
| **Approval required** | The action waits until you approve or deny it. |
| **Blocked** | The action stops. |

If a check cannot run, Atlas stops the action safely.

## A concrete example

You type: *"Read the project update and send a summary to the team."*

| Step | Result |
|---|---|
| Read the project update | **Allowed.** It happens. |
| Send the summary | **Approval required.** It waits. |
| You press Deny | **Nothing sent.** |
| You press Approve | **Simulated send completed.** |
| A plugin Atlas has not verified asks for something | **Blocked.** The action stops. |

Everything runs on fictional data and every send is simulated: no real message leaves the app.

## Try Atlas

**[Open Atlas](https://atlas-security-demo.vercel.app)** and click the first suggestion. Then open **Explore Security** in the sidebar for the four scripted scenarios below. The sidebar has New chat, **Search chats** (Ctrl or Cmd + K), session-local history with rename and delete, and Explore Security; chats are kept in this browser tab only. Every reply is labelled as a *scripted scenario*, a *live model* (Groq) reply, or a *built-in assistant* reply.

## Watch the narrated explanation

<div align="center">

<a href="assets/demo.mp4"><img src="assets/video-thumbnail.png" alt="Atlas explainer video: the AI suggests, Atlas checks" width="860"></a>

<sub>3 minutes, captions burned in ([demo.srt](assets/demo.srt)). Recorded from a local build of this repository; the hosted site serves the same interface.</sub>

</div>

## Security scenarios

| | Scenario | What you see |
|---|---|---|
| A | Untrusted plugin (Security off) | A scripted run follows a plugin's hidden instruction, reads a restricted synthetic memo and queues a simulated send. A controlled weakness, shown for comparison. |
| B | Protected request (Security on) | The same request: the unverified plugin is blocked and the verified project record is used instead. |
| C | Human approval | Reading is allowed; the send stays pending until you Deny (nothing sent) or Approve (simulated send completed). |
| D | A check fails | A simulated authorization failure: with Security on, the action stops safely and the activity explains why. |

Scenarios A to D are scripted so they repeat exactly, and need no model, key or quota. The Security switch compares the two modes for learning; it is not a login and not a production security boundary.

<table>
<tr>
<td width="62%"><img src="assets/screenshots/desktop-live-denied.png" alt="A live Groq reply with a denied Read document step"><br><sub>A live model reply; Atlas denied the restricted read.</sub></td>
<td width="38%"><img src="assets/screenshots/mobile-approval.png" alt="Approval card with Deny and Approve on a phone"><br><sub>On a phone: waiting for approval.</sub></td>
</tr>
</table>

New here? Read in this order: [Level 1, understand Atlas](docs/01-understand-atlas.md) → [Level 2, see how it works](docs/02-how-it-works.md) → [Level 3, engineering details](docs/03-engineering-details.md).

## Architecture for engineers

The model only proposes tool calls. One server-side function checks every call before it runs, and the browser cannot change the decision.

<img src="assets/reference/architecture-overview.png" alt="System architecture" width="860">

<details><summary>More diagrams, controls and stack</summary>

| | |
|---|---|
| [Request and policy lifecycle](assets/reference/request-lifecycle.png) | one tool call from request to recorded outcome |
| [Approval lifecycle](assets/reference/approval-lifecycle.png) | parked, sealed ticket, decision, validation, outcome |
| [Security OFF versus ON](assets/reference/security-mode-comparison.png) | the same scripted request, two outcomes |
| [Fail closed](assets/reference/fail-closed-flow.png) | a check that cannot complete stops the action |

Editable SVG sources: [docs/architecture](docs/architecture).

Eleven server-side controls: least privilege, scoped short-lived credentials, resource-level authorization, tool allowlist, trust and provenance, untrusted-content isolation, injection filtering, approval for sensitive actions, output filtering, audit logging, fail closed. See [SECURITY.md](docs/SECURITY.md) and [ARCHITECTURE.md](docs/ARCHITECTURE.md).

Stack: Next.js 16, React 19, TypeScript, Vercel AI SDK 7 with Groq (`openai/gpt-oss-120b`), OpenUI, zod 4, vitest 3. No database. Hosted on Vercel.

</details>

## Testing and known limitations

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run test:live   # real provider checks; skipped (not passed) without a key
```

Last run: **417 passed, 11 skipped**. The skipped tests are live-provider checks and are not counted as passes. Type-check, lint and production build were clean. The [security coverage matrix](docs/SECURITY-COVERAGE.md) maps each AI security issue to its implementation and tests, including the defect found and fixed in the last review (whitespace padding could hide an injection phrase from the heuristic detector).

**Not verified:** Groq rate-limit or outage behaviour on the hosted site, use from several devices at once, load.

**Limits to know:**
- The vulnerable behaviour in scenario A is scripted so the comparison repeats; a live AI can behave differently.
- On the serverless deployment, approval single use, the activity record and rate limits are **per server instance**, so a replayed approval can repeat a *simulated* send. A shared store would fix this and has not been added.
- Injection detection is a heuristic and misses paraphrases; authorization never depends on it.
- Atlas does not stop every attack, and has not been independently penetration tested. It is not a production security service.

## Setup and contributing

```bash
npm install
cp .env.example .env.local     # set GROQ_API_KEY for live replies; scripted scenarios need no key
npm run dev                    # http://localhost:3000
```

Environment variable **names** (values are never committed): `LLM_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL`, optional `OPENROUTER_*`, `OPENAI_*`, `NVIDIA_*` (see `.env.example`), `ATLAS_SEAL_SECRET` (signs approval tickets on serverless hosts), `ATLAS_AUDIT_STDOUT`. Without a provider, free-text chat uses the built-in assistant and says so.

Before a change: run the checks above. Keep tool authorization, approvals, output filtering and the activity record on the server, keep resources synthetic, and do not add real network, filesystem or shell tools. Add a regression test with any fix.

Docs: [Interface design audit](docs/DESIGN-AUDIT.md) · [index](docs/README.md) · [Presenter guide](docs/PRESENTER.md) · [Coverage matrix](docs/SECURITY-COVERAGE.md) · [Video production](docs/VIDEO_PRODUCTION.md) · [Presentation context](docs/PRESENTATION_CONTEXT.md) · [Deploying](docs/DEPLOY.md)

Atlas is not affiliated with OpenAI; the interface only follows common chat conventions. No license has been selected for this repository yet.
