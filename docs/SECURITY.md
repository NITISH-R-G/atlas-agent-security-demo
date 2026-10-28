# Atlas security contract

Atlas is an educational demo. Everything it touches is fictional and in memory. This document says what is enforced, where,
and what is only simulated. Claims here are backed by tests (`npm test`) and, for the live model, `npm run test:live`.

## 1. Assets and trust boundaries

| Asset | Where it lives | Exposed to the browser? |
|---|---|---|
| Provider API key (`GROQ_API_KEY`, ...) | server environment / `.env.local` | Never (tests scan bundles, events, errors, logs) |
| Synthetic resources (projects, documents, customer record) | `environment.ts`, in memory | Only after the tool pipeline allows and filters them |
| Pending approvals, audit log, rate-limit windows | server memory (bounded) | Approval ids and sanitized audit events for the session's own actions |
| Simulated outbox | per-request in-memory list | No network: "sending" appends to a list |

Trust boundaries: (1) browser -> server (untrusted input, including the Security flag, history, and any claimed role);
(2) model -> server (untrusted proposals: names, arguments, text); (3) tool output and retrieved documents -> model
(untrusted data); (4) third-party plugin (Atlas Sync) -> server (unsigned, unpinned, unverified).

## 2. Principals and authority

There are no users. The server derives one principal per request: the fictional agent identity `atlas-agent@atlas-labs.example` acting for
the fictional user Sam Rivera (team `lighthouse`). Nothing in a request body can change it: unknown fields (`role`, `userId`,
`policy`, `controls`) are ignored; the only mode input is the boolean `security`, a **scenario setting, not authentication**.
An anonymous session cookie (`atlas_sid`, HttpOnly, SameSite=Strict, Secure over HTTPS including behind a TLS-terminating proxy, unguessable) binds approvals and rate limits to a browser.

## 3. Tools and side effects

| Tool | Side effect | Sensitive | Trusted | Resource kind |
|---|---|---|---|---|
| `search_kb` | none | no | first-party | knowledge base |
| `get_project` | none | no | first-party | project |
| `list_documents` | none | no | first-party | project files |
| `read_document` | none | no | first-party | document |
| `fetch_updates` | none (returns untrusted text) | no | **third-party, unverified** | project |
| `send_message` | appends to the outbox | **yes** | first-party | recipient |
| `export_records` | returns synthetic customer data | **yes** | first-party | customer |

Every call, from the model or the deterministic planner, goes through one function (`executeTool`): strict argument schema and
resource-kind check (always on, both profiles) -> trust/provenance -> allowlist -> identity scope -> credential scope/expiry ->
resource audience -> approval gate -> execution -> output filtering -> audit.

## 4. Profiles

| | Security OFF (controlled demo weakness) | Security ON |
|---|---|---|
| Identity and credential | all scopes (`*`), non-expiring synthetic token | task-sized scopes, expiring token |
| Resource authorization | not checked | per-resource audience |
| Tool allowlist / provenance | off: the unsigned plugin runs | on: plugin blocked; `export_records` not allowed |
| Untrusted content | followed by the **scripted** agent; reaches a real model unwrapped | treated as data, wrapped, instruction text removed |
| Sensitive actions | run immediately | held for your approval |
| Output filtering | off | protected fields withheld |
| Audit | off | on (in memory) |
| Authorization outage | fails open (defined weakness) | fails closed |

OFF is **not** a bypass of platform protections: argument validation, request limits, the kind check, session binding and the
absence of any filesystem/shell/network tool remain. Its blast radius is the fictional in-memory data.

## 5. Approval lifecycle

`approval_required` (parked server-side with the exact tool, arguments, policy, session; the browser also receives a sealed ticket, see below) -> `approved` or `denied` by the owning
session (single use, TTL 10 minutes, bounded store) -> on approve the call is re-run through the full pipeline, then
`executed` or `blocked`. Other sessions, replays, expired ids, forged ids, and body-supplied arguments cannot resolve or alter
it. A server restart drops pending approvals: the action is never executed (fails closed).

**Serverless hosting.** On Vercel, the request that parks an approval and the one that resolves it can run in different instances (observed: 4 of 4 trials). The parked call therefore also travels to the browser as an AES-256-GCM sealed ticket (`src/lib/agent/seal.ts`, secret `ATLAS_SEAL_SECRET`). `/api/approve` accepts it only for the same session cookie, the same call id and within the ten minute expiry; a tampered ticket, another session, another secret or an expired ticket fails closed with 404. Single use is enforced per instance only.

## 6. Failures

Provider errors (401/402/404/429/5xx/timeout/network, mid-stream errors, empty replies, step limits) become explicit errors with
recovery guidance. There is **no automatic provider fallback** and no mock substitution: the UI always says whether a reply came
from a live model, the built-in assistant, or a scripted scenario. Credential and configuration requests are answered by the
built-in assistant without calling any model.

## 7. Audit and walkthrough

Each tool decision writes one record `{callId, tool, target, decision, layer, source}` (`source` = scripted | builtin | model), plus
a record for a human denial. The walkthrough is built only from recorded execution events: per-control decision, reason code,
evidence (never values), effect (prevented / detected / documented), the controls a blocked call never reached ("not evaluated"),
and the linked audit record. Detection is never shown as prevention.

## 8. Scripted vs live

Scripted scenarios (`demo: true` in the request) run deterministic code with no model; their audit records carry `source: scripted` and the
UI tags the reply "Scripted scenario". Live replies are tagged with the provider and model; built-in replies are tagged as
built-in. A real model may ignore an injected instruction under Security OFF; the scripted agent always follows it, which is what
makes the OFF/ON comparison repeatable.

## 9. Residual risks (explicit)

- Injection detection is a heuristic on normalized text; it misses paraphrases. Authorization never depends on it.
- The anonymous session is not identity; anyone holding the cookie is "the session". No transport security is added by Atlas.
- Approvals, audit log and rate limits are in memory: they vanish on restart and do not span instances. On the serverless deployment a ticket replayed by its own session can land on a different instance and repeat a *simulated* send; audit records and rate-limit counters are per instance. A shared store would fix this and has not been added. Nothing real can be sent or read.
- The Security switch is client-controlled by design (it is the demo). A deployment must not expose this app as a real boundary.
- A real model can still produce wrong or misleading prose; only execution results are authoritative.
- No database, authentication or WAF is included (TLS is provided by the host); the tests are not a penetration test.
- The public deployment is a controlled demonstration, not a production security service.
