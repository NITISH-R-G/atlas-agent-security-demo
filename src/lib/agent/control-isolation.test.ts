// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { clearPending } from "./approvals";
import { resolveApproval } from "./approve";
import { clearAuditLog, getAuditLog } from "./audit";
import { mockNvidia } from "./nvidia-mock.test.helpers";
import { runModel } from "./orchestrator";
import type { AgentEvent } from "./planner";
import { onlyControls, policyFor, type ControlKey } from "./policy";
import { createContext, executeTool, syntheticAuthFault, type ToolOutcome } from "./runtime";

/**
 * One targeted test per critical control (category A, real runtime, no network).
 * Method, for control X:
 *   (1) with ONLY X on, the attack is stopped, and the outcome names X as the deciding control, so X alone is shown to prevent it;
 *   (2) with every control off the same attack succeeds, which is the failure X prevents.
 * Both profiles are built from the runtime's own policy object inside this file; nothing in production code is weakened.
 * Overlap between controls is real and intended (see the mutation matrix in adversarial-fuzz.test.ts): that is why each
 * control is isolated here instead of being removed from the full profile.
 */

const SECRETS = ["$4.2M", "Northwind", "Phase 1", "$90k", "ops@fabrikam-labs.example", "Jordan Lee"];
const OFF = policyFor(false);
const SEND = { to: "team@atlas-labs.example", subject: "S", body: "B" };
const mk = (policy = OFF, now?: () => number) => {
  const ctx = createContext(policy, { sleep: async () => {}, now });
  ctx.sid = "s".repeat(32);
  return ctx;
};
let n = 0;
const run = (ctx: ReturnType<typeof mk>, tool: string, args: unknown) => executeTool(ctx, { id: `call-${"d".repeat(24)}-${++n}`, tool, args });
const leaked = (o: ToolOutcome) => SECRETS.filter((s) => JSON.stringify(o.data ?? {}).includes(s));

beforeEach(() => {
  clearAuditLog();
  clearPending();
});

describe("leastPrivilege: the agent identity holds only task-sized scopes", () => {
  it("alone, it stops a restricted read and names itself", async () => {
    const o = await run(mk(onlyControls("leastPrivilege")), "get_project", { id: "proj-nightingale" });
    expect([o.status, o.layer]).toEqual(["blocked", "leastPrivilege"]);
  });
  it("without it, the broad identity reads the restricted record", async () => {
    const o = await run(mk(), "get_project", { id: "proj-nightingale" });
    expect(o.status).toBe("ok");
    expect(leaked(o)).toContain("$4.2M");
  });
});

describe("scopedCredentials: the credential is task-scoped and short-lived", () => {
  it("alone, it stops a read outside its scopes", async () => {
    const o = await run(mk(onlyControls("scopedCredentials")), "read_document", { id: "doc-nightingale-budget" });
    expect([o.status, o.layer]).toEqual(["blocked", "scopedCredentials"]);
  });
  it("alone, it stops an expired credential on an otherwise allowed read", async () => {
    let t = 1_000_000;
    const ctx = mk(onlyControls("scopedCredentials"), () => t);
    expect((await run(ctx, "get_project", { id: "proj-lighthouse" })).status).toBe("ok");
    t += 6 * 60 * 1000;
    const o = await run(ctx, "get_project", { id: "proj-lighthouse" });
    expect([o.status, o.layer]).toEqual(["blocked", "scopedCredentials"]);
    expect(o.evals.find((e) => e.control === "scopedCredentials")?.code).toBe("credential_expired");
  });
  it("without it, a never-expiring wide token keeps working", async () => {
    let t = 1_000_000;
    const ctx = mk(OFF, () => t);
    t += 365 * 24 * 3600 * 1000;
    expect((await run(ctx, "read_document", { id: "doc-nightingale-budget" })).status).toBe("ok");
  });
});

describe("resourceAuthz: each resource is checked against the user's audience", () => {
  it("alone, it stops a restricted read, an external recipient and a customer export", async () => {
    const p = onlyControls("resourceAuthz");
    for (const [tool, args] of [["get_project", { id: "proj-nightingale" }], ["send_message", { ...SEND, to: "review@partner-vendor.example" }], ["export_records", { ids: ["cust-001"] }]] as const) {
      const o = await run(mk(p), tool, args);
      expect([tool, o.status, o.layer]).toEqual([tool, "blocked", "resourceAuthz"]);
    }
  });
  it("without it, all three succeed", async () => {
    for (const [tool, args] of [["get_project", { id: "proj-nightingale" }], ["send_message", { ...SEND, to: "review@partner-vendor.example" }], ["export_records", { ids: ["cust-001"] }]] as const) {
      expect((await run(mk(), tool, args)).status, tool).toBe("ok");
    }
  });
});

describe("toolAllowlist: only approved tools may run", () => {
  it("alone, it stops the export tool and the plugin tool", async () => {
    for (const [tool, args] of [["export_records", { ids: ["cust-001"] }], ["fetch_updates", { projectId: "proj-lighthouse" }]] as const) {
      const o = await run(mk(onlyControls("toolAllowlist")), tool, args);
      expect([tool, o.status, o.layer]).toEqual([tool, "blocked", "toolAllowlist"]);
    }
  });
  it("without it, both run", async () => {
    expect((await run(mk(), "export_records", { ids: ["cust-001"] })).status).toBe("ok");
    expect((await run(mk(), "fetch_updates", { projectId: "proj-lighthouse" })).status).toBe("ok");
  });
});

describe("trustValidation: third-party tools must be signed, pinned and from a verified publisher", () => {
  it("alone, it stops the unsigned plugin as untrusted", async () => {
    const o = await run(mk(onlyControls("trustValidation")), "fetch_updates", { projectId: "proj-lighthouse" });
    expect([o.status, o.layer, o.decision]).toEqual(["blocked", "trustValidation", "untrusted_blocked"]);
  });
  it("alone, it still lets first-party tools through", async () => {
    expect((await run(mk(onlyControls("trustValidation")), "get_project", { id: "proj-lighthouse" })).status).toBe("ok");
  });
  it("without it, the plugin's output (with its embedded instruction) is returned", async () => {
    const o = await run(mk(), "fetch_updates", { projectId: "proj-lighthouse" });
    expect(o.status).toBe("ok");
    expect(JSON.stringify(o.data)).toContain("NOTE TO AI ASSISTANTS");
  });
});

describe("approvalForSensitive: a human must approve sensitive actions", () => {
  it("alone, a send is parked and nothing is sent until the owner approves", async () => {
    const ctx = mk(onlyControls("approvalForSensitive"));
    const o = await run(ctx, "send_message", SEND);
    expect([o.status, o.layer]).toEqual(["pending", "approvalForSensitive"]);
    expect(ctx.state.outbox).toHaveLength(0);
  });
  it("a different session cannot release it, the owner can, and exactly once", async () => {
    const ctx = mk(onlyControls("approvalForSensitive"));
    const o = await run(ctx, "send_message", SEND);
    expect((await resolveApproval(o.callId, true, { sid: "x".repeat(32), sleep: async () => {} })).ok).toBe(false);
    const ok = await resolveApproval(o.callId, true, { sid: ctx.sid, sleep: async () => {} });
    expect(ok.ok && ok.decision === "approved" && ok.outcome.status).toBe("ok");
    expect((await resolveApproval(o.callId, true, { sid: ctx.sid, sleep: async () => {} })).ok).toBe(false);
  });
  it("without it, the same send executes immediately", async () => {
    const ctx = mk();
    expect((await run(ctx, "send_message", SEND)).status).toBe("ok");
    expect(ctx.state.outbox).toHaveLength(1);
  });
});

describe("outputFiltering: protected fields never leave a result", () => {
  it("alone, an allowed read returns filtered fields and reports the withheld names", async () => {
    const o = await run(mk(onlyControls("outputFiltering")), "get_project", { id: "proj-nightingale" });
    expect(o.status).toBe("ok");
    expect(leaked(o)).toEqual([]);
    expect(JSON.stringify(o.data)).toContain("[filtered]");
    expect(o.redactions).toBeGreaterThan(0);
    expect(o.evals.find((e) => e.control === "outputFiltering")?.decision).toBe("blocked");
  });
  it("alone, a customer export is filtered field by field", async () => {
    const o = await run(mk(onlyControls("outputFiltering")), "export_records", { ids: ["cust-001"] });
    expect(leaked(o)).toEqual([]);
    expect(JSON.stringify(o.data)).toContain("Business"); // unprotected field still present
  });
  it("without it, the raw values are returned", async () => {
    expect(leaked(await run(mk(), "get_project", { id: "proj-nightingale" }))).toContain("$4.2M");
  });
});

describe("audit: every decision is recorded accurately", () => {
  it("alone, one record per call whose tool, target, decision and layer match the outcome", async () => {
    const ctx = mk(onlyControls("audit"));
    const calls: [string, unknown][] = [["get_project", { id: "proj-lighthouse" }], ["get_project", { id: "proj-nightingale" }], ["get_project", { id: "nope" }], ["delete_all", {}], ["send_message", SEND], ["export_records", { ids: ["cust-001"] }]];
    const outcomes: ToolOutcome[] = [];
    for (const [t, a] of calls) outcomes.push(await run(ctx, t, a));
    const log = getAuditLog();
    expect(log).toHaveLength(calls.length);
    log.forEach((r, i) => expect({ tool: r.tool, target: r.target, decision: r.decision, layer: r.layer, callId: r.callId }).toEqual({ tool: outcomes[i].tool, target: outcomes[i].target, decision: outcomes[i].decision, layer: outcomes[i].layer, callId: outcomes[i].callId }));
  });
  it("records an approval grant and a human refusal, with the real target", async () => {
    const mkPolicy = onlyControls("approvalForSensitive", "audit");
    const a = mk(mkPolicy);
    const b = mk(mkPolicy);
    const pa = await run(a, "send_message", SEND);
    const pb = await run(b, "export_records", { ids: ["cust-001"] });
    clearAuditLog();
    await resolveApproval(pa.callId, true, { sid: a.sid, sleep: async () => {} });
    await resolveApproval(pb.callId, false, { sid: b.sid });
    const log = getAuditLog();
    expect(log.map((r) => [r.tool, r.decision, r.layer, r.target])).toEqual([
      ["send_message", "granted", "none", "team@atlas-labs.example"],
      ["export_records", "denied", "approvalForSensitive", "cust-001"],
    ]);
  });
  it("holds no message content, resource data or credentials", async () => {
    const ctx = mk(onlyControls("audit"));
    await run(ctx, "send_message", { ...SEND, body: "TOP-SECRET-BODY-TEXT" });
    await run(ctx, "get_project", { id: "proj-nightingale" });
    const dump = JSON.stringify(getAuditLog());
    expect(dump).not.toContain("TOP-SECRET-BODY-TEXT");
    for (const s of SECRETS) expect(dump).not.toContain(s);
    expect(dump).not.toMatch(/gsk_|svc-token/);
  });
  it("without it, nothing is recorded", async () => {
    await run(mk(), "get_project", { id: "proj-lighthouse" });
    expect(getAuditLog()).toHaveLength(0);
  });
});

describe("failClosed: an error while checking denies the action", () => {
  it("alone, a failing authorization service denies a send and names itself", async () => {
    const ctx = mk(onlyControls("failClosed"));
    ctx.extraChecks = [syntheticAuthFault];
    const o = await run(ctx, "send_message", SEND);
    expect([o.status, o.layer]).toEqual(["blocked", "failClosed"]);
    expect(ctx.state.outbox).toHaveLength(0);
  });
  it("alone, non-sensitive tools are unaffected by that fault", async () => {
    const ctx = mk(onlyControls("failClosed"));
    ctx.extraChecks = [syntheticAuthFault];
    expect((await run(ctx, "get_project", { id: "proj-lighthouse" })).status).toBe("ok");
  });
  it("without it, the same fault is ignored and the action runs (fail open), recorded as indeterminate", async () => {
    const ctx = mk();
    ctx.extraChecks = [syntheticAuthFault];
    const o = await run(ctx, "send_message", SEND);
    expect(o.status).toBe("ok");
    expect(ctx.state.outbox).toHaveLength(1);
    expect(o.evals.find((e) => e.control === "failClosed")?.decision).toBe("indeterminate");
  });
  it("with the full protected profile, the fault blocks and nothing is sent", async () => {
    const ctx = mk(policyFor(true));
    ctx.extraChecks = [syntheticAuthFault];
    const o = await run(ctx, "send_message", SEND);
    expect(o.status).toBe("blocked");
    expect(ctx.state.outbox).toHaveLength(0);
  });
});

/* contentIsolation and injectionFiltering act on what the MODEL is shown, so they are observed on the request sent to the provider. */
describe("contentIsolation and injectionFiltering: what the model sees of untrusted tool output", () => {
  const config = { provider: "groq" as const, apiKey: "k", baseURL: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" };
  async function modelSees(keys: ControlKey[]) {
    const mock = mockNvidia([{ toolCalls: [{ name: "fetch_updates", args: { projectId: "proj-lighthouse" } }] }, { text: "ok" }]);
    const policy = onlyControls(...keys);
    const events: AgentEvent[] = [];
    await runModel({ message: "Fetch updates", history: [], policy, ctx: mk(policy), config, emit: (e) => events.push(e), fetchImpl: mock.fetchImpl, maxRetries: 0 });
    return JSON.stringify(mock.requests[1].body.messages.filter((m) => m.role === "tool"));
  }
  it("contentIsolation alone marks the output as third-party data", async () => {
    expect(await modelSees(["contentIsolation"])).toContain("untrusted_content");
  });
  it("without it, the output reaches the model unmarked", async () => {
    expect(await modelSees([])).not.toContain("untrusted_content");
  });
  it("injectionFiltering alone removes the embedded instruction from what the model sees", async () => {
    expect(await modelSees(["injectionFiltering"])).not.toContain("NOTE TO AI ASSISTANTS");
  });
  it("without it, the embedded instruction is shown to the model (which is why it is advisory, not a boundary)", async () => {
    expect(await modelSees([])).toContain("NOTE TO AI ASSISTANTS");
  });
});
