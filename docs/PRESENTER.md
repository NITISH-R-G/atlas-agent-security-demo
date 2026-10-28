# Presenter guide

One sentence to keep: **the AI suggests, Atlas checks, and the action is allowed, held for approval, or blocked.**

Live: https://atlas-security-demo.vercel.app · Exact prompts, expected results and what to inspect: [PRESENTER-PROMPTS.md](PRESENTER-PROMPTS.md) · Plain-language docs: [Level 1](01-understand-atlas.md)

## Before you start (2 minutes)

1. Open the site and check `/api/health` shows the provider (it never shows keys).
2. Check the top-bar switch says **Security on**. A fresh browser starts that way.
3. Send one ordinary message so the server is warm, then **New chat**.

## The story (about 4 minutes)

1. **Opening.** "AI assistants can now take actions. Who decides whether those actions are allowed?"
2. **Identity.** Type the first prompt in Story 1 of the prompts file. Denied, with a reason. Type the administrator claim: same answer. "Saying who you are does not change who you are; the server knows."
3. **Evidence.** Open **Activity**, then a row: who the agent acted as, where the tool came from, which check decided. Keep **Full Evidence** closed unless asked.
4. **The comparison.** Switch Security off, **New chat**, repeat: the restricted record is returned. Switch back on.
5. **Supply chain.** Story 2: the unverified plugin is rejected and the answer comes from the verified record. Off: the plugin's text steers the agent.
6. **Close.** "The AI suggests, Atlas checks, and the action is allowed, held, or blocked."

## Say these out loud

- Everything is fictional; messages go to an in-memory list on the server.
- Access and plugin requests are answered by fixed server rules, so they repeat. Other chat can use a live model, and the reply tag says which.
- The Security switch compares two server policy profiles. It is not a login and not a production security boundary.
- Atlas does not stop every attack and has not been independently penetration tested.

## If something goes wrong

See the fallback list in [PRESENTER-PROMPTS.md](PRESENTER-PROMPTS.md).

## Where the detail lives

[Level 3](03-engineering-details.md), [SECURITY.md](SECURITY.md) and the [coverage matrix](SECURITY-COVERAGE.md). Do not narrate those live.
