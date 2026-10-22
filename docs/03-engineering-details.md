# Level 3: Engineering details

For engineers and reviewers. Each section links to the full document or the code.

## Architecture

<img src="../assets/reference/architecture-overview.png" alt="System architecture" width="900">

The model only proposes tool calls; every call passes one server-side function (`executeTool`). Full walkthrough: [ARCHITECTURE.md](ARCHITECTURE.md). Diagram sources and what each confirms: [architecture/README.md](architecture/README.md).

## Security controls (what is actually implemented)

Eleven controls, each recorded per call with a decision, reason code and evidence: least privilege; scoped short-lived credentials; resource-level authorization; tool allowlist; trust and provenance; untrusted-content isolation; injection filtering (heuristic); approval for sensitive actions; output filtering; audit logging; fail closed. Profiles for Security OFF and ON, and what stays enforced under OFF: [SECURITY.md](SECURITY.md).

<details><summary>Approval implementation</summary>

A sensitive call is parked server-side (tool, arguments, policy, session) with a 10 minute TTL. The browser receives an AES-256-GCM sealed ticket. `POST /api/approve` requires the same session cookie, call id and ticket, then re-runs the full pipeline. Files: `approvals.ts`, `approve.ts`, `seal.ts`. Single use is enforced per server instance only on the serverless deployment.

</details>

<details><summary>Audit behaviour</summary>

One record per decision: call id, tool, target, decision, layer, source (scripted, builtin or model). In memory, bounded to 500 records, not durable, per instance on the serverless deployment. The evidence panel is built only from recorded events (`walkthrough-model.ts`). Audit is off under Security OFF by design.

</details>

<details><summary>Test evidence</summary>

355 tests pass and 11 live-provider tests are skipped (skipped is not passed); TypeScript, ESLint and the production build are clean. Hosted checks: a live Groq reply with a denied `read_document`; scripted scenarios A to D; approve, deny and cross-session ticket checks (6 of 6 approvals worked across serverless requests with a ticket, 4 of 4 failed without one); layouts at 360x800, 390x844, 768x1024, 1024x768 and 1440x900 with no horizontal overflow. More detail: [PRESENTATION_CONTEXT.md](PRESENTATION_CONTEXT.md).

</details>

<details><summary>Limitations</summary>

- The Security switch is a demo setting, not authentication; the session is an anonymous cookie.
- Injection detection is heuristic; authorization never depends on it.
- Serverless: single use, audit and rate limits are per instance; a replayed ticket can repeat a simulated send.
- Groq 429 and timeout behaviour is unit tested, not verified on the hosted site.
- Not independently penetration tested; not a production security service.

</details>

## Hosting, video and reference

[DEPLOY.md](DEPLOY.md) · [VIDEO_PRODUCTION.md](VIDEO_PRODUCTION.md) · [REFERENCE-ANALYSIS.md](REFERENCE-ANALYSIS.md) · [PRESENTER.md](PRESENTER.md)
