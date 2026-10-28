# Security findings (Atlas 2.2 audit)

Labels: **Confirmed** = reproduced by a test or live request. **Suspected** = reasoned from code, not reproduced. **Unresolved** = cannot be decided with available access. Ratings use impact in Atlas's synthetic setting and note what would change them. Nothing is committed or deployed.

## Confirmed, fixed locally (regression tests in `src/lib/agent/security-audit.test.ts`)

| ID | Severity | Finding | Reproduction before fix | Fix | After |
|---|---|---|---|---|---|
| F9 | **Medium** (High if the seal secret leaks or is guessable) | `/api/approve` ran a restored ticket under the **policy stored in the ticket**. Anyone able to mint a ticket (leaked or guessed `ATLAS_SEAL_SECRET`, only length ≥16 is enforced) could pick "all controls off" and execute `export_records` | test "a ticket sealed with a policy that disables every control…" returned `status: ok` | `api/approve/route.ts` ignores ticket policy and state; restored calls run under the protected profile, and tickets whose policy lacks approval are not restored | passes; genuine approval still works |
| F10 | **Low–Medium** (needs the seal secret) | Found by the in-depth F9 review. A restored ticket was also trusted for: any tool (a ticket for a non-sensitive or unknown tool was accepted and executed), a free-form `source` that went into the audit record, and an `at` in the future (it would never expire) | tests "non-sensitive tool", "unknown tool or inherited property name", "audit source", "dated in the future" failed before the fix | new `ticket.ts` `restoreParkedCall` (only known sensitive tools, 32-hex session id, source from a fixed set, protected policy, empty state) and a future-date bound in `restorePending` | 22 tests in `approval-tickets.test.ts` pass |
| F1 | **Medium** | `clientIp()` trusted `fly-client-ip` first and the **leftmost** `x-forwarded-for` entry on every host, so a caller could invent a new address per request and evade the per-IP limit | 160 requests with rotating `fly-client-ip` → last status 200 (expected 429) | `fly-client-ip` only when the route says it runs on Fly (`FLY_APP_NAME`); otherwise `x-real-ip`, then the **rightmost** forwarded entry | passes |
| F2 | **Medium** | On the live-model path the approval card showed only "Send message <recipient>"; the user approved without seeing subject or body | `summary` was `Send message team@atlas-labs.example` | `describePending` builds the text from the parked (validated) arguments: subject, recipient, 300-char body preview, truncation stated; also used by the rule-based path | passes; browser check passes |
| F7 | **Low** (quota burn, no data exposure) | `/api/chat` accepted cross-site browser POSTs (no `Origin` check). `/api/approve` too, though `SameSite=Strict` normally keeps the cookie off such requests | local test 200; **hosted site returned 200 to `Origin: https://evil.example`** | `http-guard.isCrossSite` on both routes (403 on foreign `Origin` or `Sec-Fetch-Site` not same-origin/none) | passes; local build returns 403; hosted still vulnerable until deployed |
| F8a | **Low** | Body size was checked only after reading the whole body when no `Content-Length` was sent; the approval route had no limit | test pulled all 400 chunks (6.4 MB) before rejecting | `readBoundedText` stops at the limit (64 KiB chat, 16 KiB approve) | passes; hosted returned 413 (layer unknown) |
| F5 | **Low** | Unknown resource ids were handled by accident: protected profile → "denied" via a made-up scope; vulnerable profile → a thrown error ("error"), and unknown customer ids exported an empty `ok` | decisions `denied`/`error`/`ok` instead of `invalid` | existence + kind guard in `executeTool` (always on) | passes |
| F8b | **Low** | Audit `target` was `-` for a human-denied `export_records` | target `-` | target now includes the ids | passes |

## Confirmed, open

| ID | Severity | Finding | Why it is not fixed |
|---|---|---|---|
| F3 | **Medium** by design, **Low** in practice here | Single-use approvals are enforced per instance. With a shared seal secret, a ticket can be replayed on another instance within its 10-minute life (test "KNOWN GAP" demonstrates it). Without a secret, tickets fail closed across instances | needs a shared store (KV/DB). Impact today: a duplicate append to a per-request in-memory outbox |
| I-1 | Info (by design) | The Security switch is a client field. Any caller can use the deliberately vulnerable profile | product decision; the profile only touches synthetic data and is labelled |

## Confirmed, informational (live observations, not defects)

- Live probes: all authorization assertions held. The model chose a different tool, or none, in several cases (see VERIFICATION-REPORT). One probe hit a provider rate limit and failed safe.

## Suspected / unresolved

| ID | Item | Status |
|---|---|---|
| F4 | Forged assistant turns in `history` can persuade the model | Server decisions unaffected (tested, mocked and live). Residual: misleading model text, bounded by the "What the server did" record. Not a vulnerability in enforcement |
| F6 | Dependency advisories | See below. Reachability analysis says unreachable; not upgraded (your decision) |
| U-1 | Is `ATLAS_SEAL_SECRET` set and strong in production? | **Unknown** (not inspected on purpose) |
| U-2 | Does Vercel strip a client-sent `fly-client-ip`? | Unknown; moot after F1 |
| U-3 | Does `SameSite=Strict` stop the cookie on a real cross-site POST in the target browsers? | Standard behaviour, not tested here |
| N-1 | New: `invalid` vs `denied` now reveals whether an id exists | Low; ids are already listed to the model and visible in the UI |

## F6: dependency advisories (from `npm audit`, installed tree; nothing upgraded)

Direct dependencies in `package.json`: `@openuidev/react-headless` 0.18.1 and `@openuidev/react-ui` 0.18.1. **Neither is imported anywhere in `src`** (only `@openuidev/react-lang` is), and `.next/static` contains no `ag-ui` or `katex` strings.

| Package (installed) | Advisory | Severity | Path | Reachable in Atlas? | Fix available |
|---|---|---|---|---|---|
| `undici` 7.30.0 | GHSA-4qv8-2p9j-2685, -f72v-6w45-q472, -xjj6-f33q-929c, -4w7w-5xrc-9h26, -2m5v-pch6-74hx, -qrxm-fqhp-jwvm, -9fm3-97px-rjf6, -55wc-3pg8-jfw6 (fixed in 7.30.1) | high (cvss 5.9–7.5) | `@ai-sdk/openai` → `@ai-sdk/provider-utils` → `undici` | **Not on Atlas's current path.** provider-utils uses it only in its *download* helper (`createSafeNodeFetch`, for fetching file/image URLs); Atlas sends text only and model calls use Node's built-in `fetch` | yes, patch 7.30.1 (within the `^7.29.0` range) |
| `zod` 3.25.76 (nested) | GHSA-mrhx-c7xc-m3w5 (fixed in 4.6.6) | high (7.5) | `@openuidev/react-headless` → `@ag-ui/core` → `zod` | **No**: package not imported or bundled. Atlas's own zod is 4.6.7 (fixed) | no (upstream) |
| `katex` 0.16.47 | GHSA-238p-pmpm-9mq7 | low | `@openuidev/react-ui` → `rehype-katex` / `remark-math` | **No**: not imported or bundled | partial |
| `vitest` ≤4.1.10, `@vitest/mocker`, `tinypool` | GHSA-82fw-gwwq-j7x9, -qxg6-89mg-rqv8, -5gmw-xhrv-c9v3, -85c8-ppgw-ccpr | critical/moderate (dev only) | dev dependency | Test runner only; relevant if untrusted tests/mocks run on a developer or CI machine | yes, `vitest` 5.0.5 (major) |

Reachability was established by static search and a bundle string search, not by exhaustive dynamic analysis, and the hosted runtime's Node and package versions were not inspected.

**Completed investigation (nothing was changed in the repository):**
- `scripts/*.mjs` and every file under `video/` were searched for `@openuidev/react-ui`, `react-headless`, `@ag-ui`, `katex`, `remark-math`, `undici`: **no imports**. Only `AGENTS.md`, `package.json` and the audit docs mention them. `video/` has its own `package.json` (`playwright` 1.49.1, `ffmpeg-static`, `ffprobe-static`); its audit has one high advisory, **GHSA-7mvr-c777-76hp** (Playwright < 1.55.1 installs browsers without verifying the TLS certificate), install-time only, tooling, fixable by Playwright ≥ 1.55.1 (1.64.1 offered, not a semver-major jump).
- `undici` 7.30.1 exists on the registry and satisfies provider-utils' `^7.29.0`.
- Simulated in a throw-away copy (lockfile only, never in the repo): removing the two `@openuidev` packages alone leaves **undici still flagged**; updating `undici` alone leaves the zod/KaTeX chain; **doing both gives `found 0 vulnerabilities`** for the full production audit. `npm uninstall --dry-run` reports 218 packages would be removed.

**Minimal recommendation (not done, needs your approval):**
1. `npm update undici` (to 7.30.1; patch within the existing range, lockfile change only). This is the only change needed for the advisories that sit on a package Atlas actually installs for runtime use.
2. `npm uninstall @openuidev/react-headless @openuidev/react-ui` (unused; clears `@ag-ui/core`, nested zod 3, KaTeX chain). After it: rerun `npm run generate`, the full suite and the build, and confirm `AGENTS.md`'s package map still reads correctly. Risk: `@openuidev/cli` or the generate step might expect them; the build and `npm run generate` will show that.
3. Separately: `vitest` 5.0.5 (semver-major; dev only) and `video/` Playwright ≥ 1.55.1.
Reachability for 1 is static analysis (the download helper is not on Atlas's path); updating it is still the cheaper and safer course than relying on that analysis.
