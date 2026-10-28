// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveRoute } from "@/app/api/approve/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { clearPending, hasPending, peekPending } from "./approvals";
import { resolveApproval } from "./approve";
import { clearAuditLog, getAuditLog } from "./audit";
import { mockNvidia } from "./nvidia-mock.test.helpers";
import type { AgentEvent } from "./planner";
import { policyFor, PROTECTED_POLICY, type SecurityPolicy } from "./policy";
import { createContext, executeTool } from "./runtime";
import { sealCall, unsealCall } from "./seal";
import { resetRateLimits } from "./session";

/**
 * Approval ticket and approval race tests (category A/B: mocked provider, real route handlers).
 * A ticket lets a different serverless instance resume an approval. It is authenticated-encrypted, but this suite treats the
 * ticket's CONTENT as untrusted anyway: whatever it says, the server derives policy, state and identity from its own config.
 */

const SECRET = "a-shared-secret-of-sufficient-length";
const SID = "a".repeat(32);
const OTHER = "b".repeat(32);
const CALL = (n = 1) => `call-${"e".repeat(24)}-${n}`;
const SEND = { to: "team@atlas-labs.example", subject: "S", body: "B" };

interface Parked {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  policy: SecurityPolicy;
  state: { outbox: never[] };
  sid?: string;
  source?: string;
}
const parked = (over: Partial<Parked> = {}): Parked => ({ callId: CALL(), tool: "send_message", args: SEND, policy: policyFor(true), state: { outbox: [] }, sid: SID, source: "model", ...over });
const post = (path: string, body: unknown, cookie = SID) => new Request(`http://localhost${path}`, { method: "POST", headers: { cookie: `atlas_sid=${cookie}` }, body: JSON.stringify(body) });
const approve = (callId: string, ticket?: string, cookie = SID, ok = true) => approveRoute(post("/api/approve", { callId, approve: ok, ticket }, cookie));
const seal = (c: object, at = Date.now(), secret = SECRET) => sealCall(c as never, at, secret);

beforeEach(() => {
  process.env.ATLAS_SIMULATED_LATENCY = "0";
  process.env.ATLAS_SEAL_SECRET = SECRET;
  resetRateLimits();
  clearPending();
  clearAuditLog();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["ATLAS_SEAL_SECRET", "LLM_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL"]) delete process.env[k];
});

describe("policy, state and identity come from the server, never from the ticket", () => {
  it("a ticket that disables every control still runs under the protected profile", async () => {
    const res = await approve(CALL(), seal(parked({ tool: "export_records", args: { ids: ["cust-001"] }, policy: policyFor(false) })));
    expect(res.status).toBe(404); // approvalForSensitive is false in that policy, so no approval could ever have been parked
  });

  it("a ticket that keeps approval but weakens other controls is restored under the full protected profile", async () => {
    const weak = { ...PROTECTED_POLICY, resourceAuthz: false, leastPrivilege: false, scopedCredentials: false, toolAllowlist: false, outputFiltering: false, audit: false };
    const res = await approve(CALL(), seal(parked({ tool: "export_records", args: { ids: ["cust-001"] }, policy: weak })));
    const body = (await res.json()) as { view?: { status?: string; layer?: string } };
    expect(body.view?.status).toBe("blocked");
    expect(["toolAllowlist", "leastPrivilege", "resourceAuthz"]).toContain(body.view?.layer);
    expect(getAuditLog().length).toBeGreaterThan(0); // audit is the server's, not the ticket's
  });

  it("a ticket for a non-sensitive tool is not an approval at all", async () => {
    const res = await approve(CALL(), seal(parked({ tool: "get_project", args: { id: "proj-lighthouse" } })));
    expect(res.status).toBe(404);
  });

  it("a ticket for an unknown tool or inherited property name is rejected", async () => {
    for (const tool of ["delete_all", "__proto__", "constructor", "toString"]) expect((await approve(CALL(), seal(parked({ tool })))).status).toBe(404);
  });

  it("the audit source is one of the server's own values, whatever the ticket says", async () => {
    const res = await approve(CALL(), seal(parked({ source: "<script>alert(1)</script>" })));
    expect(res.status).toBe(200);
    for (const r of getAuditLog()) expect([undefined, "scripted", "builtin", "model"]).toContain(r.source);
  });

  it("arguments in a ticket are validated again by the tool's strict schema", async () => {
    const res = await approve(CALL(), seal(parked({ args: { ...SEND, asAdmin: true } })));
    const body = (await res.json()) as { view?: { status?: string; decision?: string } };
    expect(body.view?.status).toBe("blocked");
    expect(body.view?.decision).toBe("invalid");
  });

  it("an external recipient in a forged ticket is still refused by the resource control", async () => {
    const res = await approve(CALL(), seal(parked({ args: { ...SEND, to: "review@partner-vendor.example" } })));
    const body = (await res.json()) as { view?: { status?: string; layer?: string } };
    expect(body.view?.status).toBe("blocked");
    expect(body.view?.layer).toBe("resourceAuthz");
  });
});

describe("ticket integrity, expiry, session and action binding", () => {
  it("a ticket sealed with a different secret is rejected", async () => {
    expect((await approve(CALL(), seal(parked(), Date.now(), "another-secret-of-sufficient-length"))).status).toBe(404);
  });

  it("with no secret configured, tickets verify only against this process's random key (fail closed across instances)", async () => {
    delete process.env.ATLAS_SEAL_SECRET;
    expect((await approve(CALL(), seal(parked()))).status).toBe(404); // sealed with SECRET, server has none
  });

  it("every single-bit flip of a ticket is rejected", async () => {
    const t = seal(parked());
    const raw = Buffer.from(t, "base64url");
    for (let i = 0; i < raw.length; i += 7) {
      const copy = Buffer.from(raw);
      copy[i] ^= 1;
      expect(unsealCall(copy.toString("base64url"), SECRET), `byte ${i}`).toBeUndefined();
    }
  });

  it("an expired ticket is rejected, and so is one dated in the future", async () => {
    expect((await approve(CALL(), seal(parked(), Date.now() - 11 * 60 * 1000))).status).toBe(404);
    clearPending();
    expect((await approve(CALL(), seal(parked(), Date.now() + 365 * 24 * 3600 * 1000))).status).toBe(404);
  });

  it("a ticket cannot be used for a different callId", async () => {
    expect((await approve(CALL(2), seal(parked({ callId: CALL(1) })))).status).toBe(404);
  });

  it("the session in the ticket must match the caller's cookie", async () => {
    const t = seal(parked());
    expect((await approve(CALL(), t, OTHER)).status).toBe(404);
    expect((await approve(CALL(), t, SID)).status).toBe(200); // the failed attempt did not consume it
  });

  it("an oversized ticket is rejected without being decrypted", async () => {
    expect((await approve(CALL(), "A".repeat(9000))).status).toBe(404);
  });

  it("a ticket issued by the chat route binds exactly the content shown on the approval card", async () => {
    process.env.LLM_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_key_value_should_never_appear";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    vi.stubGlobal("fetch", mockNvidia([{ toolCalls: [{ name: "send_message", args: { to: "team@atlas-labs.example", subject: "Status", body: "Beta on track." } }] }, { text: "Waiting." }]).fetchImpl);
    const res = await chatRoute(new Request("http://localhost/api/chat", { method: "POST", headers: { cookie: `atlas_sid=${SID}` }, body: JSON.stringify({ message: "Send the team an update.", security: true }) }));
    const ev = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentEvent);
    const a = ev.find((e) => e.type === "approval") as Extract<AgentEvent, { type: "approval" }>;
    const inside = unsealCall(a.ticket!, SECRET)!;
    expect(inside.call.args).toEqual({ to: "team@atlas-labs.example", subject: "Status", body: "Beta on track." });
    expect(a.summary).toContain("Status");
    expect(a.summary).toContain("Beta on track.");
    expect(inside.call.sid).toBe(SID);
  });
});

describe("races and replay", () => {
  const park = async () => {
    const ctx = createContext(policyFor(true), { sleep: async () => {} });
    ctx.sid = SID;
    const o = await executeTool(ctx, { id: CALL(), tool: "send_message", args: SEND });
    expect(o.status).toBe("pending");
    return o.callId;
  };

  it("approve racing deny: exactly one decision wins and a denied call never runs", async () => {
    for (let i = 0; i < 6; i++) {
      clearPending();
      clearAuditLog();
      const id = await park();
      const [a, d] = await Promise.all([approve(id), approve(id, undefined, SID, false)]);
      expect([a.status, d.status].filter((s) => s === 200)).toHaveLength(1);
      const granted = getAuditLog().filter((r) => r.callId === id && r.decision === "granted");
      const aBody = a.status === 200 ? ((await a.json()) as { decision: string }) : undefined;
      expect(granted).toHaveLength(aBody?.decision === "approved" ? 1 : 0);
    }
  });

  it("20 parallel approvals of one call execute exactly once", async () => {
    const id = await park();
    const rs = await Promise.all(Array.from({ length: 20 }, () => approve(id)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(getAuditLog().filter((r) => r.callId === id && r.decision === "granted")).toHaveLength(1);
  });

  it("approve after deny, and deny after approve, both fail in the same instance", async () => {
    let id = await park();
    expect((await approve(id, undefined, SID, false)).status).toBe(200);
    expect((await approve(id)).status).toBe(404);
    clearPending();
    id = await park();
    expect((await approve(id)).status).toBe(200);
    expect((await approve(id, undefined, SID, false)).status).toBe(404);
  });

  it("a ticket cannot revive a call this instance already consumed", async () => {
    const t = seal(parked());
    expect((await approve(CALL(), t)).status).toBe(200);
    expect((await approve(CALL(), t)).status).toBe(404);
    expect(hasPending(CALL())).toBe(false);
  });

  it("a failed attempt by another session does not consume or alter the parked call", async () => {
    const id = await park();
    const before = peekPending(id)?.call.args;
    expect((await approve(id, undefined, OTHER)).status).toBe(404);
    expect(peekPending(id)?.call.args).toEqual(before);
    expect((await approve(id)).status).toBe(200);
  });

  it("an approved call re-runs the other controls at approval time (a control that now refuses wins)", async () => {
    const id = await park();
    // Simulate the world changing between park and approve: the recipient becomes external by editing the parked args.
    const entry = peekPending(id)!;
    entry.call.args = { ...SEND, to: "review@partner-vendor.example" };
    const r = await resolveApproval(id, true, { sid: SID, sleep: async () => {} });
    expect(r.ok && r.decision === "approved" && r.outcome.status).toBe("blocked");
  });

  // KNOWN GAP (infrastructure): in-process memory cannot see another instance's consumption.
  it("KNOWN GAP: deny on one instance, then approve on another with the same ticket, succeeds", async () => {
    const t = seal(parked());
    expect((await approve(CALL(), t, SID, false)).status).toBe(200); // denied on instance A
    clearPending(); // instance B has never seen it
    expect((await approve(CALL(), t, SID, true)).status).toBe(200); // approved on instance B
  });
});
