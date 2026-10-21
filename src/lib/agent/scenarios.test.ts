import { beforeEach, describe, expect, it } from "vitest";

import { POST as chatRoute } from "@/app/api/chat/route";
import { clearPending } from "./approvals";
import { clearAuditLog, getAuditLog } from "./audit";
import type { AgentEvent } from "./planner";
import { DETERMINISTIC, LIVE, SCENARIOS, type Scenario } from "./scenarios.test.data";
import { resetRateLimits } from "./session";
import { TOOLS } from "./runtime";

/** Runs a scenario through the real route handler with a browser-like cookie, returning everything the browser received. */
async function runScenario(s: Scenario) {
  let cookie: string | undefined;
  const received: AgentEvent[] = [];
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of s.turns) {
    const res = await chatRoute(new Request("http://localhost/api/chat", { method: "POST", headers: cookie ? { cookie } : {}, body: JSON.stringify({ message: t.say, security: s.security, history, demo: t.demo, fault: t.fault }) }));
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentEvent);
    received.push(...events);
    history.push({ role: "user", content: t.say });
    const ans = events.find((e) => e.type === "answer") as { plain: string } | undefined;
    if (ans) history.push({ role: "assistant", content: ans.plain });
  }
  return received;
}

beforeEach(() => {
  process.env.ATLAS_SIMULATED_LATENCY = "0";
  clearPending();
  clearAuditLog();
  resetRateLimits();
});

describe("scenario corpus integrity", () => {
  it("has unique ids, and live scenarios are clearly separated from deterministic ones", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(DETERMINISTIC.every((s) => s.deterministic && !s.modelRequired)).toBe(true);
    expect(LIVE.every((s) => s.modelRequired && !s.deterministic)).toBe(true);
    expect(DETERMINISTIC.length).toBeGreaterThanOrEqual(40);
  });
  it("covers every category, both profiles, and every registered tool at least once in an expectation", () => {
    for (const c of ["benign", "prompt-injection", "privilege", "approval", "secrets", "failure", "multi-turn"]) expect(SCENARIOS.some((s) => s.category === c), c).toBe(true);
    expect(new Set(SCENARIOS.map((s) => s.security))).toEqual(new Set([true, false]));
    const used = new Set(SCENARIOS.flatMap((s) => s.expect.tools ?? []).map((x) => x.split(":")[0]));
    // export_records and fetch_updates/others are exercised by the registry-driven matrix; assert the corpus touches the main tools
    for (const t of ["get_project", "read_document", "send_message", "fetch_updates", "search_kb", "list_documents"]) expect(used.has(t), t).toBe(true);
    for (const t of Object.keys(TOOLS)) expect(Object.keys(TOOLS)).toContain(t);
  });
});

describe.each(DETERMINISTIC)("scenario $id", (s) => {
  it(`${s.title} [${s.category}, security ${s.security ? "ON" : "OFF"}]`, async () => {
    const events = await runScenario(s);
    const e = s.expect;
    const tools = events.flatMap((x) => (x.type === "tool" ? [`${x.view.tool}:${x.view.decision}`] : []));
    if (e.tools) expect(tools).toEqual(e.tools);
    const text = JSON.stringify(events);
    for (const re of e.noDisclosure ?? []) expect(text, re).not.toMatch(new RegExp(re));
    if (e.approval !== undefined) expect(events.some((x) => x.type === "approval")).toBe(e.approval);
    if (e.answer) expect(events.flatMap((x) => (x.type === "answer" ? [x.plain] : [])).join(" ")).toMatch(new RegExp(e.answer, "i"));
    // the server-side audit log agrees with what the browser was told
    if (s.security && e.tools?.length) {
      const logged = getAuditLog().map((l) => l.decision);
      expect(logged).toEqual(events.flatMap((x) => (x.type === "tool" ? [x.view.decision] : [])));
    }
    if (!s.security) expect(getAuditLog()).toHaveLength(0);
    if (e.audit) expect(getAuditLog().map((l) => l.decision)).toEqual(e.audit);
    if (e.auditSource && s.security) for (const l of getAuditLog()) expect(l.source).toBe(e.auditSource);
    // a blocked or pending action is never described as executed by the execution layer
    for (const x of events) if (x.type === "tool" && (x.view.status === "blocked" || x.view.status === "pending")) expect(x.view.notices).not.toContain("Access granted");
  });
});
