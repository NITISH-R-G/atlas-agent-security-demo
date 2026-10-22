# Architecture diagrams

Seven single-concept diagrams (two beginner diagrams, five engineering diagrams). The SVG files are the editable sources (open them in any editor, or edit `build.mjs`, which generates them). PNG exports are in `exports/` at 1920x1080 and 3840x2160 (`@2x`), and copies for slides are in [`assets/reference/`](../../assets/reference).

```bash
node docs/architecture/build.mjs        # regenerate the SVG sources
cd video && node export-diagrams.mjs    # re-render the PNG exports
```

Every element carries `data-step` (reveal order) and `data-id`. The video pipeline (`video/diagram-page.mjs`) uses them to draw each diagram step by step; opened on its own, an SVG shows the finished diagram.

Colors mean the same everywhere: green allowed or recorded, red denied or failed, amber pending approval, cyan model or tool activity, indigo server enforcement, gray inactive.

| Diagram | Teaches | Confirmed by the implementation or tests | Conceptual or simplified |
|---|---|---|---|
| [simple-flow](simple-flow.svg) | You, AI, Atlas checks, allowed or blocked (beginner) | the same pipeline as the engineering diagrams below, expressed in plain words | deliberately omits every individual check |
| [safe-stop](safe-stop.svg) | A check that cannot run stops the action (beginner) | demo stage D and the fail-closed control | the failure is simulated |
| [architecture-overview](architecture-overview.svg) | Who does what: the model only proposes; the server decides, executes and records | `src/app/api/chat/route.ts`, planners in `planner.ts` and `orchestrator.ts`, `executeTool` in `runtime.ts`, seven tools and fictional resources in `environment.ts`, `approvals.ts`, `audit.ts`; only the Groq call leaves the server | The dashed "trust boundary" is an explanatory frame around our server code, not a network boundary; layout is simplified |
| [request-lifecycle](request-lifecycle.svg) | One tool call from request to recorded outcome, with allow and deny paths | Check order in `executeTool`; audit record fields (tool, target, decision, layer, source); the live denial of `read_document` on `doc-comp-bands` (least privilege, scope `doc:hr:read` missing) | The checks are shown as one box; with Security OFF most are not enforced |
| [approval-lifecycle](approval-lifecycle.svg) | A sensitive action is parked, a person decides, the server re-validates and re-checks | `approvals.ts` (parked call, 10 minute TTL, session binding), `approve.ts` (re-runs the pipeline), `seal.ts` (AES-256-GCM ticket), `hardening.test.ts` and `crossinstance.test.ts` | Single use is enforced per server instance only (documented limitation) |
| [security-mode-comparison](security-mode-comparison.svg) | The same scripted request under OFF and ON | Scripted scenarios A and B (`planner.ts`, `scenarios.test.ts`, `Walkthrough.test.tsx`) | Scripted behaviour, not the live model; OFF is a controlled weakness for demonstration |
| [fail-closed-flow](fail-closed-flow.svg) | A required check that cannot complete stops the action | Demo stage D (`fault: "authz"`), the `failClosed` control in `policy.ts` and `controls.ts`, tests in `controls.test.ts` and `Walkthrough.test.tsx` | The authorization dependency is a simulated fault; it is not a real service or a real infrastructure outage |
