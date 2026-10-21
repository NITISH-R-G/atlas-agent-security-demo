import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAuditLog, getAuditLog, setAuditStdout } from "./audit";
import { resolveApproval } from "./approve";
import { runAgent } from "./planner";
import { policyFor } from "./policy";
import { createContext, executeTool } from "./runtime";

describe("audit stdout opt-in", () => {
  afterEach(() => {
    setAuditStdout(false);
    vi.restoreAllMocks();
  });
  const run = async () => {
    clearAuditLog();
    const ctx = createContext(policyFor(true), { sleep: async () => {} });
    await executeTool(ctx, { id: "call-0123456789abcdef01234567-1", tool: "read_document", args: { id: "doc-comp-bands" } });
  };
  it("prints one data-free JSON line per decision only when enabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run();
    expect(log).not.toHaveBeenCalled();
    setAuditStdout(true);
    await run();
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/^\[audit\] \{/);
    const rec = JSON.parse(line.replace("[audit] ", ""));
    expect(rec).toMatchObject({ tool: "read_document", target: "doc-comp-bands", decision: "denied", layer: "leastPrivilege" });
    expect(line).not.toMatch(/scopes|token|L3:|\$\d/i); // ids are logged, never document contents or credentials
    expect(Object.keys(rec).sort()).toEqual(["at", "callId", "decision", "layer", "target", "tool"]);
  });
});

describe("denied approvals are audited and never executed", () => {
  it("records the refusal and leaves the outbox empty", async () => {
    clearAuditLog();
    const events: { type: string; callId?: string }[] = [];
    const r = await runAgent({ message: "Send the project summary to the team.", policy: policyFor(true), emit: (e) => events.push(e as never), sleep: async () => {} });
    const id = events.find((e) => e.type === "approval")!.callId!;
    expect(await resolveApproval(id, false)).toMatchObject({ ok: true, decision: "denied" });
    expect(r.ctx.state.outbox).toHaveLength(0);
    expect(getAuditLog().map((l) => l.decision)).toEqual(["granted", "approval_required", "denied"]);
  });
});
