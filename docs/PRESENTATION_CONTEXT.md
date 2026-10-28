# Presentation context

Technical context for building a slide deck about Atlas. Everything here is taken from the repository, the deployed app and the recorded tests. Where something is conceptual, it says so. Do not add architecture details that are not in this document.

## Plain-language story (use this first)

**The AI suggests an action. Atlas checks whether it is allowed. If it is not allowed, the action does not happen.** Anchor example: "Read the project update and send a summary to the team." Reading is allowed; sending needs approval and waits; the person denies or approves; Atlas shows the real result. A plugin Atlas has not verified is blocked. If a check cannot run, Atlas stops safely (simulated here). Every decision is saved in an activity record. Reference image: `assets/reference/simple-flow.png` (and `safe-stop.png`). Use the plain terms with a general audience and the technical terms below with engineers: AI suggestion = model-proposed tool call; security check = server-side policy enforcement; needs your approval = approval gate; stops safely = fail closed; activity record = audit event.

The engineering sections below are for deeper slides.

## Overview

Atlas is a chat assistant with tools (read a project record, open a document, fetch plugin updates, send a message) running on fictional data. Every tool call, whoever proposed it, passes one server-side policy pipeline. A single **Security** switch compares a controlled, deliberately vulnerable mode (OFF) with server enforcement (ON). Four scripted scenarios, a guided tour, an animated architecture view and an evidence panel make the decisions inspectable. It is an educational demo, deployed at https://atlas-security-demo.vercel.app, source at https://github.com/NITISH-R-G/atlas-agent-security-demo.

## Problem demonstrated

An AI agent can be manipulated by text it reads (a plugin update with a hidden instruction) or by claims in a prompt ("I'm the CFO"). If the model's output is trusted as authorization, the agent can read restricted data or send it out. Atlas shows what changes when the application, not the model, decides.

## Audience

Engineers and security-minded builders new to agent security; technically curious non-specialists. Assume programming knowledge; define agent, tool call, policy boundary, fail closed and audit event on first use.

## Core thesis

**A model's proposal is not authorization.** The model proposes; trusted server code validates, authorizes, asks for approval when needed, filters output and records an audit event.

## Verified architecture and responsibilities

| Component | Responsibility | Where |
|---|---|---|
| Atlas UI (browser) | Chat, Security switch (a demo setting, not authentication), evidence panel, approval cards | `src/components/chat/` |
| Route handlers | Validate requests, anonymous session cookie `atlas_sid` (HttpOnly, SameSite=Strict, Secure on HTTPS), per-session, per-IP and global limits, concurrency cap, body size limit | `src/app/api/chat/route.ts`, `src/app/api/approve/route.ts`, `src/lib/agent/session.ts` |
| Planners | Scripted planner (no model, stages A to D), built-in assistant (no model; handles credential asks), live model via Vercel AI SDK to Groq (`openai/gpt-oss-120b`) which only proposes tool calls | `planner.ts`, `orchestrator.ts`, `provider.ts` |
| Policy pipeline `executeTool` | One function for every call: strict arguments and resource kind, trust and provenance, tool allowlist, identity scope, credential scope and expiry, resource audience, approval gate, execution, output filtering, audit | `src/lib/agent/runtime.ts`, `policy.ts`, `controls.ts` |
| Tools | `search_kb`, `get_project`, `list_documents`, `read_document`, `fetch_updates` (third-party, unverified), `send_message` (sensitive, outbox), `export_records` (sensitive) | `runtime.ts`, `environment.ts` |
| Approval store | Parks a sensitive call (tool, arguments, policy, session); 10 minute TTL; sealed ticket for the browser | `approvals.ts`, `approve.ts`, `seal.ts` |
| Audit log | One record per decision: call id, tool, target, decision, layer, source (scripted, builtin or model); in memory, bounded | `audit.ts` |
| Evidence UI | Walkthrough built only from recorded events; per-control decision, reason code, evidence, effect | `walkthrough-model.ts`, `Walkthrough.tsx` |

There is no database, no shell, no filesystem tool and no network tool. The only outbound call is to Groq.

## Security controls actually implemented

Eleven controls, each recorded per call with decision, reason code and evidence: least privilege; scoped, short-lived credentials; resource-level authorization; tool allowlist; trust and provenance; untrusted-content isolation; injection filtering (a heuristic); approval for sensitive actions; output filtering; audit logging; fail closed. Under Security OFF most are intentionally not enforced (the controlled weakness); argument validation, request limits, session binding and the absence of dangerous tools remain.

## Security OFF versus ON (scripted scenarios A and B)

| | OFF | ON |
|---|---|---|
| Plugin update with a hidden instruction | plugin runs; scripted agent follows it | plugin blocked (unsigned, unpinned publisher) |
| Restricted memo | read | not touched |
| Outside address | message queued in the outbox | none; verified project record used |
| Audit | none | record per decision |

These are scripted so the comparison repeats. A live model may not follow the hidden instruction at all; the video says so.

## Restricted resource (live example)

With Security ON, asking the live model (claiming to be the CFO) to read `doc-comp-bands`: the model proposes `read_document`; the server decides **denied** under least privilege because the agent identity does not hold the scope `doc:hr:read`; outcome: not executed. Claims in the prompt carry no authority.

## Approval lifecycle (scenario C)

1. The call passes the earlier checks and reaches the approval gate.
2. The server parks it (tool, arguments, policy, session) and the UI shows an approval card; nothing has run.
3. The browser receives a sealed ticket (AES-256-GCM, unreadable and unforgeable by the client, 10 minute expiry).
4. The person chooses Approve or Deny. Deny: recorded as declined, never runs. Approve: the server validates the same session cookie, call id, ticket and expiry, then re-runs the full pipeline and executes once into the outbox.
5. The outcome is recorded. Limitation: single use is enforced per server instance only on the serverless deployment.

## Fail-closed scenario (scenario D)

A simulated authorization fault is injected. With Security ON the required check cannot complete, the Fail closed control denies, `send_message` is not executed and the denial is recorded. With Security OFF the same fault fails open (the defined weakness). It is a controlled simulation, not a real service outage.

## Verified testing evidence

- Automated: 417 tests pass and 11 live-provider tests are skipped (skipped is not passed); TypeScript, ESLint and the production build are clean. Suites cover policy decisions, approvals (session binding, replay on one instance, tampered tickets, cross-instance tickets), hardening (limits, cookies), adversarial scenarios, UI flows (scenarios A to D, approvals, evidence, sidebar, tour) and provider error classification.
- Hosted (https://atlas-security-demo.vercel.app): live Groq reply with a denied `read_document`; scripted scenarios A to D; approve, deny, replay and cross-session ticket checks; 6 of 6 approvals worked across serverless requests with a ticket and 4 of 4 failed without one; layouts at 360x800, 390x844, 768x1024, 1024x768 and 1440x900 with no horizontal overflow.
- Local: an invalid provider key produced an honest error and the guided scenarios still ran.
- Not verified: Groq 429 and timeout behaviour on the hosted site (unit tested only), several physical devices at once, load, real infrastructure outages.

## Known limitations

The Security switch is a demo setting, not authentication; the session is an anonymous cookie. Injection detection is heuristic and authorization never depends on it. On the serverless deployment single use, audit records and rate limits are per instance, so a replayed ticket can repeat a simulated send. The audit log is in memory and not durable. Not a certified product, not independently penetration tested. Fictional data only.

## Terminology

- **Agent**: an assistant that can call tools.
- **Tool call / proposal**: the model's request to run a tool with arguments; not an authorization.
- **Policy pipeline**: the server function that checks and then executes or denies each call.
- **Trust boundary**: here, the line between untrusted model output and trusted server code.
- **Least privilege**: the agent identity holds only the scopes its task needs (for example `doc:hr:read` is not among them).
- **Approval**: an explicit person decision for a sensitive action.
- **Sealed ticket**: encrypted, authenticated token that carries the parked call to the browser and back.
- **Fail closed**: if a required check cannot complete, deny.
- **Audit event**: a recorded decision (call id, tool, target, decision, layer, source).
- **Scripted scenario**: deterministic code, no model, labelled in the UI.

## Learning journey

Question, then what Atlas is, then the request flow built piece by piece, then OFF versus ON, then a denial by server code, then approval, then fail closed with evidence, then what is and is not demonstrated.

## Proposed slide sequence (one message per slide)

| # | Slide | Message | Image |
|---|---|---|---|
| 1 | Title | The AI suggests. Atlas checks. | `video-thumbnail.png` |
| 2 | The simple idea | You ask, the AI suggests, Atlas checks, allowed or blocked | `simple-flow.png` |
| 3 | What Atlas is | A normal assistant on fictional data, with tools | `atlas-product-desktop.png` |
| 4 | Request flow | The model proposes; the server decides | `request-lifecycle.png` |
| 5 | System view | Everything inside the boundary is trusted server code | `architecture-overview.png` |
| 6 | Same request, two modes | OFF is a controlled weakness; ON enforces | `security-mode-comparison.png` |
| 7 | A live denial | The prompt's claim carries no authority | `request-lifecycle.png` (deny path highlighted) |
| 8 | Human approval | Sensitive actions wait, and the server still re-checks | `approval-lifecycle.png` |
| 9 | Fail closed | If a check cannot complete, nothing runs | `fail-closed-flow.png` |
| 10 | Evidence | Each decision is recorded with a reason | `atlas-product-desktop.png` (evidence panel: take from the live app) |
| 11 | Works on a phone | Same behaviour, responsive layout | `atlas-product-mobile.png` |
| 12 | What it proves | Five demonstrated principles | none |
| 13 | What it does not prove | Limits, stated plainly | none |
| 14 | Try it | Live demo and repository | `video-thumbnail.png` |

## Reference images (`assets/reference/`)

| File | Communicates | Basis |
|---|---|---|
| `atlas-product-desktop.png` | The clean desktop chat with an approval pending | real deployed UI (scripted request) |
| `atlas-product-mobile.png` | Phone layout: approval card and drawer | real deployed UI at 390x844 |
| `architecture-overview.png` | System components and the trust boundary | SVG source `docs/architecture/architecture-overview.svg` |
| `request-lifecycle.png` | Request, proposal, policy checks, allow or deny, audit | SVG source |
| `approval-lifecycle.png` | Parked, ticket, decision, validation, outcome | SVG source |
| `security-mode-comparison.png` | OFF versus ON outcomes | SVG source |
| `fail-closed-flow.png` | Authorization unavailable stops the action | SVG source |
| `simple-flow.png` | The beginner diagram: You, AI, Atlas checks, Allowed or Blocked | SVG source `docs/architecture/simple-flow.svg` |
| `safe-stop.png` | A check that cannot run stops the action (simulated) | SVG source `docs/architecture/safe-stop.svg` |
| `../video-thumbnail.png` | Video cover | designed card using the simple diagram |

All are 16:9 (1920 x 1080). Editable sources and 4K exports are in `docs/architecture/`.

## Suggested speaker notes and transitions

- Slide 2 to 3: "Atlas is a way to make that question concrete."
- 4 to 5: "That was one call. Here is the whole system, and notice where the dashed line is."
- 5 to 6: "Let's see what the line changes: the same request, twice."
- 6 to 7: "The scripted run is repeatable. Now a live model, which is not."
- 7 to 8: "Denial is one outcome. Some actions are allowed, but only if a person agrees."
- 8 to 9: "Now what if the check itself breaks?"
- 9 to 10: "How would you know what happened? The server's own record."
- 12 to 13: "Before you leave with a conclusion, here is what this does not show."

## Claims that must not be made without further evidence

- That Atlas is production ready, certified, or independently penetration tested.
- That the system prevents all prompt injection or that injection detection is reliable.
- That approvals are single use across instances on the serverless deployment.
- That the live model reliably reproduces the vulnerable behaviour (only the scripted agent does).
- That the fail-closed result covers real infrastructure outages.
- That Groq rate-limit (429) handling is verified on the hosted site.
- That any message is really sent (the outbox is simulated) or that real data is involved.
- That Atlas is affiliated with OpenAI or uses any OpenAI agent system.
