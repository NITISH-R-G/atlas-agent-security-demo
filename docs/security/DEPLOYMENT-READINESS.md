# Deployment readiness (Atlas 2.2 audit, second pass)

Status: **ready to deploy the working-tree fixes, with the caveats below, once you approve.** Nothing is committed, pushed, deployed or upgraded. Readiness here means "the verified fixes are safe to ship and do not break either presentation story", not "Atlas is secure".

## What would ship (working tree vs deployed `313929a`)

| Change | Finding | Evidence |
|---|---|---|
| Client-address trust (`session.ts`, `chat/route.ts`) | F1 | U I (4 tests, 3 failed first) |
| Approval prompt shows subject, recipient, body preview (`approvals.ts` `describePending`, `orchestrator.ts`, `planner.ts`) | F2 | U I, real browser, live probe |
| Same-origin check and bounded reads (`http-guard.ts`, both routes) | F7, F8a | U I; local build returns 403; hosted pre-fix returned 200 |
| Unknown-id validation (`runtime.ts`), audit target (`approve.ts`) | F5, F8b | U I |
| Ticket content never trusted (`ticket.ts`, `api/approve/route.ts`, `approvals.ts`) | F9, F10 | U I (5 of 25 related tests failed first) |
| Tests, docs, `audit.live.test.ts`, `video/approval-check.mjs`, `test:live` script entry | – | – |

`package.json` differs only by the extra `test:live` file. **No dependency changed.**

## Confirmed findings and status

| ID | Severity | Status |
|---|---|---|
| F9 policy trusted from ticket | Medium (High if the seal secret is weak or leaked) | fixed locally |
| F10 tool, source and time trusted from ticket | Low–Medium | fixed locally |
| F1, F2 | Medium | fixed locally |
| F7, F8a, F5, F8b | Low | fixed locally |
| F3 cross-instance replay (approve, and deny-then-approve) | Medium by design, Low here | **open, infrastructure** |
| I-1 client-chosen Security switch | Info (by design) | open, product decision |

## Unresolved high-risk issues

**None rated High under the current configuration.** Items that could become High:
1. **Seal secret strength (unknown).** Whoever holds `ATLAS_SEAL_SECRET` can mint approvals for protected sends to internal recipients (they can no longer choose policy, tool, or external recipients). Its presence and strength in production are **unknown** and deliberately not inspected.
2. **F3.** Without a verified atomic shared store, single use holds only inside one instance. No such store exists, so it is documented as an unresolved infrastructure limitation and **not** claimed fixed. Any shared-store design must make "mark consumed" atomic (for example a conditional write or `SET NX` with a TTL ≥ ticket life) and be tested against concurrent instances before this item is closed.
3. **Adding real users** would turn "cross-user isolation: not applicable" into a primary gap.

## What an approval ticket binds (verified by tests, not only by reading)

| Bound item | Where | Test |
|---|---|---|
| Exact tool | sealed `tool`; only known sensitive tools restore (`ticket.ts`) | `approval-tickets.test.ts` non-sensitive / unknown tool |
| Exact arguments (recipient, subject, body) | sealed `args`; re-validated by the tool's strict schema at run time; the card text is built from the same parked args | tickets "binds exactly the content shown on the approval card"; "arguments … validated again"; "external recipient … refused" |
| Call identity | `callId` in the ticket must equal the requested `callId` | "cannot be used for a different callId" |
| Session | `sid` sealed, must equal the caller's cookie at consume time; a wrong session does not consume | "session in the ticket must match" |
| Expiry | `at` sealed; > 10 min old or > 60 s in the future is refused | "expired … and future" |
| Integrity | AES-256-GCM; any bit flip, truncation, other secret, or no secret refused | "every single-bit flip", "different secret", "no secret configured" |
| Single use | per instance only | same-instance tests pass; cross-instance is the open F3 gap |
| Policy, state, identity, source | **not read from the ticket**: `policyFor(true)`, empty state, server principal, source from a fixed set | F9/F10 tests; `ticket.ts` |

The protected policy comes from `PROTECTED_POLICY` in `policy.ts`, a frozen constant in the server bundle; `policyFor(true)` returns a copy of it. Nothing in a request or ticket can alter it.

## Seal secret: requirement and how to verify it (not verified here)

Requirement (from `DEPLOY.md` and the code): production must have `ATLAS_SEAL_SECRET` set to the **same** long random value on every instance. Code behaviour: unset or shorter than 16 characters means a random per-process key (tickets then verify only on the instance that issued them, which fails closed); otherwise the key is `sha256("atlas-seal:" + secret)`. Only the length is checked, not entropy.

I did not read, list or print production configuration. Verify it yourself, or authorize me to, in this order:
1. **Presence, without values:** in the Vercel project, Settings → Environment Variables, confirm `ATLAS_SEAL_SECRET` exists for Production (or `vercel env ls production`, which prints names only).
2. **Strength:** it should be generated, not typed, for example `openssl rand -base64 32` (≥ 32 random bytes). Never paste it into chat, logs or the repo. If it was ever shared or is short or guessable, rotate it (a rotation invalidates pending approvals, which fail closed).
3. **Behaviour, no secret needed:** after deployment run `node video/approval-check.mjs https://atlas-security-demo.vercel.app` several times. Consistent passes show tickets verify across the instances that served those requests; an intermittent "unknown or expired" suggests the secret is missing or differs between environments.
4. **Scope:** the Production and Preview environments should use different secrets.

Until step 1 and 2 are confirmed, treat the secret as an **unverified deployment prerequisite**, not a verified control.

## Dependency recommendations (not applied)

**All dependency advisories remain unresolved** until you approve the upgrades below; this commit changes no dependency.

Exact packages, advisories, paths and the simulation are in `SECURITY-FINDINGS.md` (F6). Minimal set: `npm update undici` (7.30.0 → 7.30.1, patch within `^7.29.0`); `npm uninstall @openuidev/react-headless @openuidev/react-ui` (no imports in `src`, `scripts/` or `video/`). A throw-away simulation of both gives `found 0 vulnerabilities` for the production audit. Dev-only: `vitest` 5.0.5 (major); `video/` Playwright ≥ 1.55.1 (GHSA-7mvr-c777-76hp). After applying: full suite, `npm run generate`, build, browser checks.

## Residual risks

See `RESIDUAL-RISKS.md`. Highlights: persuadable model (server record limits the damage, not the wording), advisory-only injection scanner, per-instance limits and audit, no authentication, no monitoring, no `script-src`, F3.

## Verification status by evidence type

| Type | Covered | Not covered |
|---|---|---|
| Code review | all route, runtime, approval, ticket, session, provider code | `planner.ts`, `controls.ts`, `content.ts`, UI read only in part |
| Unit / mocked-provider / route integration | 630 pass, 13 skipped (live) | – |
| Real browser, local production build | 25 acceptance checks (desktop + mobile), approve and deny | cross-site cookie behaviour in other browsers |
| Live provider (Groq, one run, 9 probes) | invariants held, 1 rate-limit error handled | OFF profile, timeouts, repeat runs, other models |
| Hosted | public GET/HEAD and 3 POSTs on the **old** build | everything about the new build; env vars; instance count |

## Exact hosted checks required after deployment

Run only after you approve and deploy. Replace `$U` with `https://atlas-security-demo.vercel.app`.

1. **Right build is live.** Confirm the deployed commit on the Vercel deployment page equals your commit (the app itself does not report a SHA), then:
   ```bash
   curl -s $U/api/health
   ```
   expect `status: ok`, provider and model name, no key data.
2. **Cross-origin rejected.** Expect `403`:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/api/chat -H "Origin: https://evil.example" -d '{"message":"Why was that denied?","security":true}'
   ```
3. **Same-origin accepted.** Expect `200`:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/api/chat -H "Origin: $U" -H "Content-Type: application/json" -d '{"message":"Why was that denied?","security":true}'
   ```
4. **Chunked oversize.** Expect `413`:
   ```bash
   head -c 200000 /dev/zero | tr '\0' 'x' | curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/api/chat -H "Transfer-Encoding: chunked" --data-binary @-
   ```
5. **Approval round trip in a real browser (this is the check that matters most, because it exercises cookie + origin + ticket on Vercel):**
   ```bash
   node video/approval-check.mjs $U
   ```
   expect 4 PASS. If approval fails with "unknown or expired", `ATLAS_SEAL_SECRET` may be unset or differ between instances (see F3); report it rather than working around it.
6. **Acceptance run, both profiles, desktop and mobile** (no model quota used):
   ```bash
   node video/verify-hosted.mjs $U
   ```
   expect ALL CHECKS PASSED. Add `LIVE_PROBE=1` only if you accept one live provider call.
7. **Security headers unchanged:** `curl -sI $U/` shows nosniff, frame deny, no-referrer, HSTS, CSP.
8. **Per-IP limit on Vercel (optional, ~160 requests):** with a stable caller, send 160 requests that rotate a bogus `fly-client-ip`; expect `429` before the end. Skip if you do not want that traffic.
9. **Watch the first minutes of logs** for unexpected 403s (a legitimate browser blocked by the origin check would show as the chat failing in step 5/6).

Rollback: redeploy the previous Vercel deployment (`313929a`).
