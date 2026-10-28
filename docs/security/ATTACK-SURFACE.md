# Attack surface (Atlas 2.2 audit)

Everything here was read in the code. Status of each claim: **code-reviewed** unless a test is named. "Unknown" means it could not be established with the access available.

## Request lifecycle

```
browser ──POST /api/chat──► isCrossSite → bounded body read (64 KiB) → parseChatRequest
   │                        → IP / session / global rate limit → concurrency slot (12)
   │                        → policyFor(client "security" flag)
   │                        → exact prepared prompt?  ──yes──► rule-based planner ─┐
   │                                   └─no (and model configured) ► runModel ──┤  proposes tool calls
   │                                                                              ▼
   │                  executeTool  (the only place a tool runs)
   │      unknown tool → strict zod args → resource exists + right kind
   │      → trust/provenance → allowlist → least privilege → credential scope/expiry
   │      → resource audience → approval (sensitive) → run → output filter → audit
   │                                                                              ▼
   ◄────────── NDJSON events ◄── text-only blocks (answer.ts) ◄── "What the server did" appended
   │
   └─POST /api/approve (cookie + sealed ticket) ► isCrossSite → bounded read → takePending
                                       (session-bound, single use per instance) → executeTool again
GET /api/health  → provider + model name, uptime; no keys, no per-provider key presence
```

## Routes (the complete list)

| Route | Method | Reaches tools? | Notes |
|---|---|---|---|
| `/api/chat` | POST | yes, only through `executeTool` | `maxDuration` 60 s, model timeout 45 s |
| `/api/approve` | POST | yes, only for a call parked by `/api/chat`, through `executeTool` | session cookie + (cross-instance) sealed ticket |
| `/api/health` | GET | no | discloses provider and model name by design |
| pages / static | GET | no | |

No other route, server action, middleware, or direct helper calls a tool. Searched: `TOOLS[`, `executeTool(` — callers are `orchestrator.ts`, `planner.ts`, `approve.ts` only.

## Tool-permission matrix (server definitions in `runtime.ts`)

| Tool | Args (strict) | Permission needed | Sensitive (approval) | Allowlisted | Provenance | Side effect |
|---|---|---|---|---|---|---|
| `search_kb` | `query` ≤200 | `kb:read` | no | yes | first party | none |
| `get_project` | `id` (must exist, kind `project`) | resource's `requiredScope` | no | yes | first party | none |
| `list_documents` | `projectId` | `doc:lighthouse:read` | no | yes | first party | none |
| `read_document` | `id` (must exist, kind `document`) | resource's `requiredScope` | no | yes | first party | none |
| `fetch_updates` | `projectId` | `project:lighthouse:read` | no | **no** | **unsigned, unpinned, unverified** | none (static text) |
| `send_message` | `to` (email), `subject` ≤120, `body` ≤4000 | `message:send`, internal recipient only | **yes** | yes | first party | append to per-request in-memory outbox |
| `export_records` | `ids` 1–5, must exist, kind `customer` | `records:export`; audience check always denies | **yes** | **no** | first party | none (returns data when allowed) |

## Sources of identity, roles and approval state

| Item | Source | Trust |
|---|---|---|
| Principal | constant `USER` (Sam Rivera, team `lighthouse`) in `environment.ts`; identity scopes from `policy.leastPrivilege` | server-owned; **no authentication exists** |
| Security profile | JSON field `security: boolean` sent by the browser | **client-chosen by design**; the vulnerable profile is reachable by any caller |
| Roles / admin claims | natural language only | never read by any control |
| Resource ids | model arguments, validated against the server's resource table | untrusted until validated |
| Session | cookie `atlas_sid` (HttpOnly, SameSite=Strict, Secure on HTTPS), random 128 bit | binds approvals and rate limits; not authentication |
| Approval state | in-memory map per process + AES-256-GCM sealed ticket | single use per instance; see F3 |
| Conversation `history` | request body | untrusted, fed to the model as given |

## Persistence boundaries and instance dependencies

| State | Where | Lifetime | Instance dependency |
|---|---|---|---|
| Pending approvals, consumed ids | `globalThis` maps | process | per instance; tickets carry the call across instances |
| Rate-limit windows, inflight cap | `globalThis` | process | per instance, so limits are per instance |
| Audit log | ring buffer (500) + optional stdout JSON line | process | not durable, never served by any route |
| Outbox | per-request `SimState` | one request | none; never leaves the server |

## External-content boundaries

| Boundary | Content | Handling |
|---|---|---|
| Atlas Sync plugin output | static string with an embedded instruction | blocked by trust control when protected; when allowed, wrapped as untrusted data |
| `doc-vendor-handoff` | static text with an embedded instruction, marked `untrusted` | readable (audience ok); output marked untrusted and scanned; cannot grant permission |
| Model provider | streamed text + tool-call JSON | text rendered as plain text blocks; tool calls re-validated server-side |
| URL fetching, file system, shell, database, network from tools | none | not implemented |

## Where a model response becomes visible

`delta` events (live text, rendered as plain text), the final `answer` (text split into `Paragraph` / `ReportSummary` blocks; `lit()` strips quotes, backslashes and newlines so model text cannot add OpenUI components), then the "What the server did" block, which is generated only from execution outcomes. Evidence rows (Activity, Full Evidence) come from `ToolOutcome`, not from the model.

## Security control → enforcement location

| Control | Location |
|---|---|
| Argument validation, unknown tool, resource existence/kind | `runtime.ts` `executeTool` (always on) |
| Trust and provenance, allowlist, least privilege, credential scope/expiry, resource audience | `runtime.ts` `runChecks` |
| Approval for sensitive tools | `runtime.ts` + `approvals.ts`, `approve.ts`, `api/approve/route.ts` |
| Output filtering | `runtime.ts` `redact` |
| Audit | `runtime.ts` `finish` → `audit.ts` |
| Fail closed | `runtime.ts` `runChecks` catch |
| Content isolation / injection filtering | `orchestrator.ts` `forModel`, `content.ts` (advisory, not a boundary) |
| Same-origin check, body bound | `http-guard.ts` (new in this audit) |
| Rate limits, concurrency | `session.ts`, `api/chat/route.ts` |
| Model failure handling | `orchestrator.ts` `runModel`, `provider.ts` |

## Unknowns

- Whether `ATLAS_SEAL_SECRET` is set on the hosted deployment (not inspected; not inferred).
- Number of serverless instances serving production and the Node runtime version there.
- Whether the hosting platform strips a client-sent `fly-client-ip` (made irrelevant by F1 fix, but the pre-fix exposure on Vercel was not proven live).
- Which layer (platform or app) produced the 413 for a chunked oversize body on the hosted site.
