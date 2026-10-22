<div align="center">

# Atlas

**An AI assistant that checks every action before it runs: the AI suggests, Atlas checks, and the action is allowed or blocked.**

<img src="assets/reference/simple-flow.png" alt="You ask, the AI suggests, Atlas checks, and the action is either allowed or blocked" width="860">

</div>

## An example

You type: *"Read the project update and send a summary to the team."*

| Step | What Atlas does |
|---|---|
| Read the project update | **Allowed.** It happens. |
| Send the summary | **Needs your approval.** It waits. Deny: nothing is sent. Approve: it is sent to a simulated outbox. |
| A plugin Atlas has not verified asks for something | **Blocked.** The action stops. |
| A security check cannot run (simulated) | **Stops safely.** Nothing happens. |

Everything is fictional and every send is simulated. Atlas does not prevent all attacks and does not make AI completely safe: it is an educational demo of the idea, with limits listed [below](#tests-and-limitations).

## Try it

**[Open the live demo](https://atlas-security-demo.vercel.app)**, then choose **Explore Security** in the sidebar and run scenario **C** (approval).

## Watch (3 minutes)

<div align="center">

<a href="assets/demo.mp4"><img src="assets/video-thumbnail.png" alt="Atlas explainer video: the AI suggests, Atlas checks" width="860"></a>

<sub>Click to play the narrated video (`assets/demo.mp4`, 3:03, captions burned in; also <a href="assets/demo.srt">demo.srt</a>).</sub>

</div>

New here? Read in this order: [Level 1, understand Atlas](docs/01-understand-atlas.md) → [Level 2, see how it works](docs/02-how-it-works.md) → [Level 3, engineering details](docs/03-engineering-details.md).

## Main features

- A normal chat assistant with tools, and a **Security** switch to compare a controlled weakness (off) with enforcement (on).
- **Approval cards** for sensitive actions, with separate Deny and Approve.
- **Explore Security**: four scripted scenarios, an animated path, and a short guided tour.
- **Activity details** on demand, and an evidence panel with every check and the saved activity record.
- Every reply says where it came from: *scripted scenario* (no AI model), *live model (Groq)*, or *built-in assistant*.
- Works on phones: the sidebar becomes a drawer, and approval buttons stay reachable.

<table>
<tr>
<td width="62%"><img src="assets/screenshots/desktop-live-denied.png" alt="Desktop: a live Groq reply with a denied Read document chip"><br><sub>A live AI reply; Atlas denied the restricted read.</sub></td>
<td width="38%"><img src="assets/screenshots/mobile-approval.png" alt="Mobile: approval card with Deny and Approve"><br><sub>On a phone: waiting for approval.</sub></td>
</tr>
</table>

## Architecture and engineering details

For engineers: the model only proposes tool calls, and one server-side function checks every call before it runs.

<img src="assets/reference/architecture-overview.png" alt="System architecture" width="860">

<details><summary>More diagrams</summary>

| | |
|---|---|
| [Request and policy lifecycle](assets/reference/request-lifecycle.png) | one tool call from request to recorded outcome |
| [Approval lifecycle](assets/reference/approval-lifecycle.png) | parked, sealed ticket, decision, validation, outcome |
| [Security OFF versus ON](assets/reference/security-mode-comparison.png) | the same scripted request, two outcomes |
| [Fail closed](assets/reference/fail-closed-flow.png) | a check that cannot complete stops the action |

Editable SVG sources: [docs/architecture](docs/architecture).

</details>

<details><summary>Security controls and stack</summary>

Eleven server-side controls: least privilege, scoped short-lived credentials, resource-level authorization, tool allowlist, trust and provenance, untrusted-content isolation, injection filtering, approval for sensitive actions, output filtering, audit logging, fail closed. Details: [SECURITY.md](docs/SECURITY.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md).

Stack: Next.js 16, React 19, TypeScript, Vercel AI SDK 7 with Groq (`openai/gpt-oss-120b`), OpenUI, zod 4, vitest 3. No database. Hosted on Vercel.

</details>

<details><summary>Run it locally</summary>

```bash
npm install
cp .env.example .env.local     # set GROQ_API_KEY if you want live replies; scripted scenarios need no key
npm run dev                    # http://localhost:3000
```

Environment variable **names** (values are never committed): `LLM_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL`, optional `OPENROUTER_*`, `OPENAI_*`, `NVIDIA_*` (see `.env.example`), `ATLAS_SEAL_SECRET` (signs approval tickets on serverless hosts), `ATLAS_AUDIT_STDOUT`. Without a provider, free-text chat uses the built-in assistant and says so.

</details>

## Tests and limitations

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run test:live   # real provider checks; skipped (not passed) without a key
```

At the last run: **355 passed, 11 skipped** (the skipped tests are live-provider checks and are not counted as passes); type-check, lint and production build clean. Browser checks covered scenarios A to D, approve and deny, a live Groq denial, and layouts at 360, 390, 768, 1024 and 1440 px wide with no horizontal overflow.

**Not verified:** Groq 429 or outage behaviour on the hosted site, use from several devices at once, load.

**Limits to know:**
- Security OFF versus ON is a controlled demonstration, not advice to turn security off in a real application. The vulnerable behaviour is scripted so the comparison is repeatable; a live AI can behave differently.
- The Security switch is a demo setting, not a login.
- On the serverless deployment, approval replay protection and the activity record are per server instance, so a replayed approval can repeat a *simulated* send.
- Not independently penetration tested; not a production security service.

## Docs

[Level 1](docs/01-understand-atlas.md) · [Level 2](docs/02-how-it-works.md) · [Level 3](docs/03-engineering-details.md) · [Presenter guide](docs/PRESENTER.md) · [Video production](docs/VIDEO_PRODUCTION.md) · [Presentation context](docs/PRESENTATION_CONTEXT.md) · [Deploying](docs/DEPLOY.md)

Atlas is not affiliated with OpenAI; the interface only follows common chat conventions. No license has been selected for this repository yet.
