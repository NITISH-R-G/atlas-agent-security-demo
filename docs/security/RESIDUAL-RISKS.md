# Residual risks (Atlas 2.2 audit)

Risks that remain after the local fixes. Each states what would have to be true for it to matter.

## Needs infrastructure or a product decision

| Risk | Why it remains | What would reduce it |
|---|---|---|
| **Cross-instance approval replay** (F3) | single-use tracking is in process memory | shared store (KV / database) holding consumed call ids; or one always-on instance (as `fly.toml` configures) |
| **No authentication; one hard-coded principal** | by design for a demonstration | real sign-in and per-user policy. Until then cross-user isolation is *not applicable*, not *protected* |
| **Client-chosen Security switch** | the vulnerable profile is part of the product | a server-side allowlist (for example an environment flag that disables the vulnerable profile on a public deployment) |
| **Audit is in memory, bounded, not durable, not tamper-evident** | no log store | stdout audit lines already exist (`ATLAS_AUDIT_STDOUT=1`); ship them to durable storage and alert on denials |
| **Rate limits are per instance** | in-memory windows | shared counters |
| **Seal secret is approval authority** | whoever holds `ATLAS_SEAL_SECRET` can mint approvals for protected sends (not for other tools or weaker policy after F9) | long random secret, rotation; enforce a larger minimum length (not changed here because the production secret's length is unknown and raising it could break cross-instance approvals) |

## Explicit residual risk: cross-instance approval replay (F3)

**Status: unresolved, infrastructure-dependent. Not mitigated beyond the bounds below. No shared-store solution was implemented or tested.**

What is enforced: within one server instance a parked call is removed atomically on first use (`takePending`, synchronous), its id is remembered as consumed, and a ticket cannot revive it there. Tests: `approval-tickets.test.ts` (20 parallel approvals run once; approve-vs-deny has one winner).

What is not: a different instance has its own memory. It has never seen the first decision, so it will accept the same ticket again.

Conditions under which this can produce a duplicate (or reversed) action, all of which must hold:
1. `ATLAS_SEAL_SECRET` is set to the same value on every instance. If it is unset or differs, tickets fail closed across instances and this risk does not exist (at the cost of approvals failing when the request lands elsewhere).
2. The ticket is younger than 10 minutes (`TTL_MS`).
3. The request carries the same `atlas_sid` cookie that parked the call (HttpOnly, SameSite=Strict), so the replayer is that browser or someone who holds both the cookie and the ticket.
4. The second request is routed to an instance that has not consumed that id (a different instance, or the same one after a restart).

Ways it can happen without an attacker: the browser or a network layer retries the approve request after a timeout and the retry lands on another instance (duplicate action); or a user denies, then approves the same card after the page has been reloaded onto another instance (a refused action then runs).

Bounds that do hold: a replay re-runs the full pipeline under the server's protected policy with the original arguments, so it cannot do more than the original approval covered (same tool, same recipient, same message), cannot reach external recipients, and expires with the ticket. In today's Atlas the action is an append to a per-request in-memory outbox that is discarded, so a duplicate has no external effect. **If a real delivery or other irreversible tool is ever added, this risk becomes a real duplicate-action risk and must be closed first.**

What closing it requires: a shared store with an atomic "claim" operation (for example a conditional write or `SET key NX EX 660` keyed by call id, checked before execution and also written on deny), verified with a multi-instance concurrency test, with a defined behaviour when the store is unreachable (fail closed). Until then this stays listed as open.

## Model and content risks (cannot be eliminated by the server)

- **Persuasion.** A model can be talked into *proposing* a forbidden action or into writing misleading text. The server blocks the action and appends "What the server did" for refused or held calls, but it does not fact-check every sentence the model writes about allowed calls.
- **Advisory injection scanner.** `content.ts` is heuristic. It is not an authorization boundary and is not treated as one.
- **Tool selection varies.** Live runs show the model sometimes picks a different tool, or none. Authorization outcomes did not vary.
- **Forged history** is accepted as conversation context (F4).

## Web hardening not done

- CSP has no `script-src` / `default-src` (Next inline scripts); HSTS lacks `includeSubDomains` and preload. Low impact because the app has no `dangerouslySetInnerHTML` and renders model text as text.
- Non-browser clients are not subject to the origin check (they carry no ambient credentials, so this is the intended limit of the check).
- Chunked-body protection depends on the app now; the hosted platform returned 413 before the fix, so its own limit is also in play (layer unknown).

## Dependencies (F6)

Production audit reports 9 advisories (5 high). Static analysis says none are on a path Atlas executes today, and two direct dependencies are unused. This is analysis, not proof; resolution awaits your decision (see SECURITY-FINDINGS.md).

## Deployment

- The hosted site still runs the pre-audit commit (`313929a`); F1, F2, F5, F7, F8a, F8b and F9 are fixed only in the working tree.
- Hosted configuration (seal secret, instance count, Node version) was not inspected.

## Not tested

Live timeout and duplicate-retry behaviour; live Security OFF probes; real-browser cross-site cookie behaviour; hosted per-IP limit; shared-store behaviour (does not exist).
