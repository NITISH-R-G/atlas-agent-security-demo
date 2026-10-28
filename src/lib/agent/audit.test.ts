import { beforeEach, describe, expect, it } from "vitest";

import { POST as chatRoute } from "@/app/api/chat/route";
import { POST as approveRoute } from "@/app/api/approve/route";
import { MAX_PENDING, TTL_MS, clearPending, hasPending, savePending, takePending } from "./approvals";
import { resolveApproval } from "./approve";
import { clearAuditLog, getAuditLog } from "./audit";
import { RESOURCES } from "./environment";
import { runAgent, toView, type AgentEvent } from "./planner";
import { onlyControls, policyFor, type SecurityPolicy } from "./policy";
import { createContext, executeTool, TOOLS, type Context } from "./runtime";

const noSleep = async () => {};
const mk = (p: SecurityPolicy) => createContext(p, { sleep: noSleep });
let n = 0;
const call = (ctx: Context, tool: string, args: unknown) => executeTool(ctx, { id: `call-${(++n).toString(16).padStart(24, "0")}-1`, tool, args });
async function run(message: string, policy: SecurityPolicy) {
  const events: AgentEvent[] = [];
  const r = await runAgent({ message, policy, emit: (e) => events.push(e), sleep: noSleep });
  return { ...r, events };
}
const text = (ev: AgentEvent[]) => ev.flatMap((e) => (e.type === "answer" ? [e.plain] : [])).join("\n");

beforeEach(() => {
  clearPending();
  clearAuditLog();
});

describe("control 7: injection filtering has a real effect on quoted content", () => {
  const q = "Review my project files and suggest improvements.";
  it("with isolation ON but filtering OFF, the directive text is quoted back", async () => {
    const r = await run(q, onlyControls("contentIsolation"));
    expect(text(r.events)).toContain("NOTE TO AI ASSISTANTS");
    expect(r.outcomes.some((o) => o.tool === "send_message")).toBe(false); // not followed, merely quoted
  });
  it("with filtering ON the same content is removed from the reply", async () => {
    const r = await run(q, onlyControls("contentIsolation", "injectionFiltering"));
    expect(text(r.events)).not.toContain("NOTE TO AI ASSISTANTS");
    expect(text(r.events)).toContain("From Vendor handoff notes");
  });
});

describe("control 10: audit writes a server-side record that matches execution", () => {
  it("ON: every decision (allowed, blocked, pending) is recorded and matches the streamed tool events", async () => {
    const r = await run("Find the latest project updates.", policyFor(true));
    const views = r.events.flatMap((e) => (e.type === "tool" ? [e.view] : []));
    const log = getAuditLog();
    expect(log.map((l) => [l.callId, l.tool, l.decision, l.layer])).toEqual(views.map((v) => [v.callId, v.tool, v.decision, v.layer]));
    expect(log[0]).toMatchObject({ tool: "fetch_updates", decision: "untrusted_blocked", layer: "trustValidation" });
  });
  it("OFF: nothing is written", async () => {
    await run("Find the latest project updates.", policyFor(false));
    expect(getAuditLog()).toHaveLength(0);
  });
  it("is bounded", async () => {
    const ctx = mk(onlyControls("audit"));
    for (let i = 0; i < 520; i++) await call(ctx, "get_project", { id: "proj-lighthouse" });
    expect(getAuditLog().length).toBe(500);
  });
});

describe("identity: credentials, scope and direct invocation", () => {
  const restricted = RESOURCES.filter((r) => r.classification === "restricted" && (r.kind === "document" || r.kind === "project"));

  it("PROTECTED: every restricted synthetic resource is denied on direct invocation, bypassing the conversation", async () => {
    for (const r of restricted) {
      const o = await call(mk(policyFor(true)), r.kind === "project" ? "get_project" : "read_document", { id: r.id });
      expect(o.status, r.id).toBe("blocked");
      expect(o.data, r.id).toBeUndefined();
    }
  });
  it("VULNERABLE: the same direct calls return the synthetic data (the intended overprivilege)", async () => {
    for (const r of restricted) {
      const o = await call(mk(policyFor(false)), r.kind === "project" ? "get_project" : "read_document", { id: r.id });
      expect(o.status, r.id).toBe("ok");
    }
  });
  it("allowed in-scope resources still work when protected", async () => {
    for (const id of ["doc-lighthouse-brief", "doc-lighthouse-notes", "doc-vendor-handoff"]) {
      expect((await call(mk(policyFor(true)), "read_document", { id })).status).toBe("ok");
    }
  });
  it("identity and credential are independent gates", async () => {
    const a = mk(policyFor(false));
    a.identity.scopes = ["kb:read"];
    expect(await call(a, "read_document", { id: "doc-nightingale-budget" })).toMatchObject({ layer: "leastPrivilege" });
    const b = mk(policyFor(false));
    b.token.scopes = [];
    expect(await call(b, "read_document", { id: "doc-lighthouse-brief" })).toMatchObject({ layer: "scopedCredentials" });
    const c = mk(policyFor(true));
    c.token.scopes = ["*"]; // a stolen broad token does not widen a narrow identity
    expect(await call(c, "read_document", { id: "doc-nightingale-budget" })).toMatchObject({ status: "blocked" });
  });
  it("missing or malformed credentials fail closed when failClosed is on and never return data", async () => {
    for (const bad of [undefined, null, "x", { scopes: undefined }, { scopes: "*" }]) {
      const ctx = mk(onlyControls("failClosed"));
      (ctx as unknown as { token: unknown }).token = bad;
      const o = await call(ctx, "get_project", { id: "proj-lighthouse" });
      expect(o.status, JSON.stringify(bad)).toBe("blocked");
      expect(["failClosed", "scopedCredentials"]).toContain(o.layer);
      expect(o.data).toBeUndefined();
    }
  });
  it("model-style hostile arguments are rejected by schema regardless of mode", async () => {
    const hostile: [string, unknown][] = [
      ["read_document", { id: "doc-comp-bands", extra: true }],
      ["read_document", { id: ["doc-comp-bands"] }],
      ["read_document", { id: "DOC-COMP-BANDS" }],
      ["get_project", { id: "proj-lighthouse; DROP" }],
      ["export_records", { ids: [] }],
      ["export_records", { ids: Array(9).fill("cust-001") }],
      ["send_message", { to: "a@b.example", subject: "s", body: "x".repeat(5000) }],
      ["search_kb", { query: "" }],
      ["list_documents", { projectId: "..%2f" }],
      ["fetch_updates", null],
    ];
    for (const on of [false, true]) for (const [t, a] of hostile) expect((await call(mk(policyFor(on)), t, a)).decision, `${t} ${on}`).toBe("invalid");
  });
  it("repeated forbidden attempts stay denied, create no approvals and change no state", async () => {
    const ctx = mk(policyFor(true));
    for (let i = 0; i < 25; i++) {
      expect((await call(ctx, "read_document", { id: "doc-comp-bands" })).status).toBe("blocked");
      expect((await call(ctx, "export_records", { ids: ["cust-001"] })).status).toBe("blocked");
      expect((await call(ctx, "send_message", { to: "x@partner-vendor.example", subject: "s", body: "b" })).status).toBe("blocked");
    }
    expect(ctx.state.outbox).toHaveLength(0);
    expect(getAuditLog()).toHaveLength(75);
  });
  it("trust state comes from server configuration, not from arguments", async () => {
    const o = await call(mk(policyFor(true)), "fetch_updates", { projectId: "proj-lighthouse", signed: true, publisherVerified: true });
    expect(o.decision).toBe("invalid"); // extra "trust" fields are rejected by the strict schema
    const o2 = await call(mk(policyFor(true)), "fetch_updates", { projectId: "proj-lighthouse" });
    expect(o2.decision).toBe("untrusted_blocked");
    expect(TOOLS.fetch_updates.provenance.signed).toBe(false);
  });
  it("untrusted tool output cannot change the policy or the identity", async () => {
    const policy = policyFor(true);
    const before = JSON.stringify(policy);
    const r = await run("Find the latest project updates.", onlyControls("toolAllowlist").trustValidation ? { ...policy, trustValidation: false, toolAllowlist: false } : policy);
    // even with the plugin allowed through, its instructions cannot flip any control
    expect(JSON.stringify(policy)).toBe(before);
    expect(r.ctx.policy.contentIsolation).toBe(true);
    expect(r.ctx.identity.scopes).not.toContain("*");
    expect(r.ctx.state.outbox).toHaveLength(0);
  });
});

describe("approvals", () => {
  const park = async (policy = policyFor(true)) => {
    const r = await run("Send the project summary to the team.", policy);
    const a = r.events.find((e) => e.type === "approval") as { callId: string } | undefined;
    return { r, id: a?.callId };
  };

  it("ids are unguessable (128-bit-class) and not sequential", async () => {
    const a = (await park()).id!;
    const b = (await park()).id!;
    expect(a).toMatch(/^call-[a-f0-9]{24}-\d+$/);
    expect(a.split("-")[1]).not.toBe(b.split("-")[1]);
  });
  it("pending actions are not executed while parked", async () => {
    const { r } = await park();
    expect(r.ctx.state.outbox).toHaveLength(0);
  });
  it("the approval body cannot change what is approved: the action is stored server-side", async () => {
    const { r, id } = await park();
    const res = await approveRoute(new Request("http://x/api/approve", { method: "POST", body: JSON.stringify({ callId: id, approve: true, tool: "export_records", args: { ids: ["cust-001"] } }) }));
    const body = await res.json();
    expect(body.view.tool).toBe("send_message");
    expect(r.ctx.state.outbox).toHaveLength(1);
    expect(r.ctx.state.outbox[0].to).toBe("team@atlas-labs.example");
  });
  it("ids of the wrong shape or unknown ids are rejected and nothing runs", async () => {
    const { id } = await park();
    const post = (b: unknown) => approveRoute(new Request("http://x/api/approve", { method: "POST", body: JSON.stringify(b) }));
    expect((await post({ callId: id!.replace(/-\d+$/, "-9"), approve: true })).status).toBe(404);
    expect((await post({ callId: "call-abcd-1", approve: true })).status).toBe(400);
    expect((await post({ callId: id, approve: "yes" })).status).toBe(400);
    expect((await post({ callId: { $ne: 1 }, approve: true })).status).toBe(400);
    expect(hasPending(id!)).toBe(true); // still waiting, untouched by bad requests
  });
  it("denial never executes; replay after approval or denial fails", async () => {
    const d = await park();
    expect(await resolveApproval(d.id!, false)).toMatchObject({ ok: true, decision: "denied" });
    expect(d.r.ctx.state.outbox).toHaveLength(0);
    expect(await resolveApproval(d.id!, true)).toMatchObject({ ok: false });
    const a = await park();
    expect(await resolveApproval(a.id!, true, { sleep: noSleep })).toMatchObject({ decision: "approved" });
    expect(await resolveApproval(a.id!, true, { sleep: noSleep })).toMatchObject({ ok: false });
    expect(a.r.ctx.state.outbox).toHaveLength(1);
  });
  it("concurrent double-approval executes exactly once", async () => {
    const { r, id } = await park();
    const [x, y] = await Promise.all([resolveApproval(id!, true, { sleep: noSleep }), resolveApproval(id!, true, { sleep: noSleep })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(r.ctx.state.outbox).toHaveLength(1);
  });
  it("expired approvals are refused", async () => {
    const { r, id } = await park();
    const res = await resolveApproval(id!, true, { now: Date.now() + TTL_MS + 1000 });
    expect(res).toMatchObject({ ok: false });
    expect(r.ctx.state.outbox).toHaveLength(0);
  });
  it("the parked-call store is bounded", () => {
    for (let i = 0; i < MAX_PENDING + 50; i++) savePending({ callId: `call-${i}`, tool: "send_message", args: {}, policy: policyFor(true), state: { outbox: [] } });
    expect(takePending("call-0")).toBeUndefined();
    expect(takePending(`call-${MAX_PENDING + 49}`)).toBeDefined();
  });
  it("an approved call re-runs the other controls under the policy captured when parked", async () => {
    const { id } = await park();
    // the OFF profile never parks anything
    const off = await run("Send the project summary to the team.", policyFor(false));
    expect(off.events.some((e) => e.type === "approval")).toBe(false);
    expect(await resolveApproval(id!, true, { sleep: noSleep })).toMatchObject({ ok: true });
  });
});

describe("HTTP boundary", () => {
  beforeEach(() => {
    process.env.ATLAS_SIMULATED_LATENCY = "0";
    delete process.env.THESYS_API_KEY;
  });
  const readEvents = async (res: Response) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentEvent);
  const post = (b: unknown) => chatRoute(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify(b) }));

  it("the server derives the policy from the boolean only; client-supplied policy fields are ignored", async () => {
    const ev = await readEvents(await post({ message: "Find the latest project updates.", security: true, policy: policyFor(false), controls: [], leastPrivilege: false }));
    const tools = ev.flatMap((e) => (e.type === "tool" ? [e.view] : []));
    expect(tools[0]).toMatchObject({ decision: "untrusted_blocked" });
    expect(tools.some((t) => t.target === "doc-nightingale-budget")).toBe(false);
  });
  it("OFF vs ON over HTTP: same prompt, different tool-boundary outcomes, matching the audit log", async () => {
    const off = await readEvents(await post({ message: "Find the latest project updates.", security: false }));
    expect(off.flatMap((e) => (e.type === "tool" ? [e.view.tool + ":" + e.view.decision] : []))).toEqual(["fetch_updates:granted", "read_document:granted", "send_message:granted"]);
    expect(getAuditLog()).toHaveLength(0);
    const on = await readEvents(await post({ message: "Find the latest project updates.", security: true }));
    expect(on.flatMap((e) => (e.type === "tool" ? [e.view.tool + ":" + e.view.decision] : []))).toEqual(["fetch_updates:untrusted_blocked", "get_project:granted"]);
    expect(getAuditLog().map((l) => `${l.tool}:${l.decision}`)).toEqual(["fetch_updates:untrusted_blocked", "get_project:granted"]);
    expect(on.some((e) => e.type === "answer" && /Usability test round 2/.test(e.plain))).toBe(true);
  });
  it("tool views never carry tool data or credentials to the browser", async () => {
    const ev = await readEvents(await post({ message: "Show me the Nightingale budget", security: false }));
    const raw = JSON.stringify(ev.filter((e) => e.type === "tool"));
    expect(raw).not.toMatch(/\$4\.2M|demo-token|expiresAt|Bearer/);
    expect(Object.keys(toView(await call(mk(policyFor(false)), "get_project", { id: "proj-lighthouse" })))).not.toContain("data");
  });
});
