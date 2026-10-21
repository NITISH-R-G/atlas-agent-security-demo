# Hosting Atlas (Fly.io, single always-on machine)

Atlas keeps approvals, audit and rate limits in memory, so it must run as **one persistent server process** (not serverless,
not multiple instances). `fly.toml` pins one machine with auto-stop off. Approvals/audit are ephemeral: a restart or deploy
drops pending approvals (fails closed) and clears the audit log.

## One-time (needs you)

1. Add a payment method at https://fly.io/dashboard/nitish-r-g/billing (Fly refuses to create apps without one).

## Deploy

```bash
flyctl apps create atlas-security-demo --org personal
```

Set the Groq key without echoing it (reads the existing `GROQ_API_KEY` environment variable; never printed or committed):

```bash
printf 'GROQ_API_KEY=%s\n' "$GROQ_API_KEY" | flyctl secrets import --app atlas-security-demo --stage
```

```bash
flyctl deploy --remote-only --ha=false
flyctl scale count 1 --yes
```

Non-secret settings (`LLM_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-120b`, `ATLAS_AUDIT_STDOUT=1`) live in `fly.toml`.

## Verify

`GET https://atlas-security-demo.fly.dev/api/health` returns provider/model (no secrets). Then run the presenter checklist in
`docs/PRESENTER.md` against the public URL.

# Hosting on Vercel (current deployment)

Public URL: https://atlas-security-demo.vercel.app (project `atlas-security-demo`, production, Hobby plan).

Serverless means consecutive requests can run in different instances (verified: approvals parked in one request were not found
by the next request in 4/4 trials). Atlas therefore issues a **sealed approval ticket** (AES-256-GCM with `ATLAS_SEAL_SECRET`)
with each approval. The browser returns it to `/api/approve`; the server verifies it, requires the same session cookie, the
10 minute expiry and the same call id, then runs the action through the full policy pipeline. Without a valid ticket the
approval fails closed (404, nothing runs).

Honest limits of this design (no shared database): single use is enforced per instance only, so an owner who replays a ticket
that lands on another instance can repeat a *simulated* send; audit records and rate limits are per instance; the audit shown
in the walkthrough comes from the request that executed the decision. Nothing real can be sent or read.

Environment (Production): `LLM_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-120b`, `ATLAS_AUDIT_STDOUT=1`, `ATLAS_SEAL_SECRET`
(random, sensitive), `GROQ_API_KEY` (sensitive). Redeploy: `vercel deploy --prod` (CLI is not installed in the project).
