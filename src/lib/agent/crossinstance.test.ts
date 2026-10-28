// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { POST as approveRoute } from "@/app/api/approve/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { clearPending } from "./approvals";
import { clearAuditLog } from "./audit";
import type { AgentEvent } from "./planner";
import { resetRateLimits } from "./session";

function browser() {
  let cookie: string | undefined;
  const call = async (path: string, body: unknown) => {
    const res = await (path === "/api/chat" ? chatRoute : approveRoute)(new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: cookie ? { cookie } : {} }));
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  };
  const park = async () => {
    const res = await call("/api/chat", { message: "Send the project summary to the team.", security: true, demo: true });
    const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentEvent);
    return events.find((e) => e.type === "approval") as { callId: string; ticket?: string };
  }
  return { call, park };
}

/** Simulates "another serverless instance": the process-local stores are empty. */
const newInstance = () => clearPending();

beforeEach(() => {
  process.env.ATLAS_SIMULATED_LATENCY = "0";
  process.env.ATLAS_SEAL_SECRET = "test-secret-for-sealing-0123456789";
  clearPending();
  clearAuditLog();
  resetRateLimits();
});

describe("approvals across serverless instances", () => {
  it("issues a ticket, and a different instance can resolve it for the owning session", async () => {
    const b = browser();
    const a = await b.park();
    expect(a.ticket).toBeTruthy();
    newInstance();
    const r = await b.call("/api/approve", { callId: a.callId, approve: true, ticket: a.ticket });
    expect(r.status).toBe(200);
    expect((await r.json()).view).toMatchObject({ tool: "send_message", target: "team@atlas-labs.example", status: "ok" });
  });

  it("denial works across instances and executes nothing", async () => {
    const b = browser();
    const a = await b.park();
    newInstance();
    const r = await b.call("/api/approve", { callId: a.callId, approve: false, ticket: a.ticket });
    expect((await r.json()).decision).toBe("denied");
  });

  it("another session cannot use a ticket it obtained", async () => {
    const owner = browser();
    const a = await owner.park();
    const other = browser();
    await other.park();
    newInstance();
    const r = await other.call("/api/approve", { callId: a.callId, approve: true, ticket: a.ticket });
    expect(r.status).toBe(404);
  });

  it("rejects tampered tickets, tickets for another call id, and tickets sealed with another secret", async () => {
    const b = browser();
    const a = await b.park();
    const second = await b.park();
    newInstance();
    const tampered = a.ticket!.slice(0, -4) + (a.ticket!.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect((await b.call("/api/approve", { callId: a.callId, approve: true, ticket: tampered })).status).toBe(404);
    expect((await b.call("/api/approve", { callId: a.callId, approve: true, ticket: second.ticket })).status).toBe(404);
    process.env.ATLAS_SEAL_SECRET = "a-different-secret-0123456789abc";
    expect((await b.call("/api/approve", { callId: a.callId, approve: true, ticket: a.ticket })).status).toBe(404);
  });

  it("a ticket cannot be replayed on the same instance", async () => {
    const b = browser();
    const a = await b.park();
    newInstance();
    expect((await b.call("/api/approve", { callId: a.callId, approve: true, ticket: a.ticket })).status).toBe(200);
    expect((await b.call("/api/approve", { callId: a.callId, approve: true, ticket: a.ticket })).status).toBe(404);
  });

  it("without any ticket an unknown call id still fails closed", async () => {
    const b = browser();
    const a = await b.park();
    newInstance();
    expect((await b.call("/api/approve", { callId: a.callId, approve: true })).status).toBe(404);
  });
});
