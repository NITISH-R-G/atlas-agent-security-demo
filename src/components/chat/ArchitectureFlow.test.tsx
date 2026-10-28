import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { chatReducer, initialChat, type AssistantMessage } from "./chat-state";
import ArchitectureFlow from "./ArchitectureFlow";

function messageWith(security: boolean, tools: Array<{ status: "ok" | "blocked" | "pending"; decision: string }>): AssistantMessage {
  let st = chatReducer(initialChat, { type: "send", userId: "u", assistantId: "a", text: "Read the project update and send a summary to the team.", security, now: 0 });
  st = chatReducer(st, { type: "event", id: "a", event: { type: "model", engine: "scripted", label: "Scripted scenario" } as never });
  tools.forEach((t, i) => {
    st = chatReducer(st, {
      type: "event",
      id: "a",
      event: { type: "tool", view: { callId: `call-${i}`, tool: "send_message", label: "Send message", target: "team@demo-company.example", status: t.status, decision: t.decision, layer: "none", reason: "r", notices: [], evals: [] } } as never,
    });
  });
  return st.messages.find((m): m is AssistantMessage => m.role === "assistant")!;
}

describe("ArchitectureFlow", () => {
  it("shows nothing as used before any request", () => {
    render(<ArchitectureFlow message={undefined} onClose={() => {}} />);
    const svg = screen.getByRole("img");
    expect(svg.getAttribute("aria-label")).toMatch(/Policy engine: Server-side \(Not used yet\)/);
    expect(screen.getByText(/Send a message or run a guided stage/)).toBeTruthy();
  });

  it("does not mark a tool as executed when the server blocked it", () => {
    render(<ArchitectureFlow message={messageWith(true, [{ status: "blocked", decision: "denied" }])} onClose={() => {}} />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toMatch(/Policy engine: 1 stopped \(Stopped\)/);
    expect(label).toMatch(/Tool: Did not run/);
    expect(label).not.toMatch(/Tool: \d+ executed/);
  });

  it("shows a held action as waiting, not as executed", () => {
    render(<ArchitectureFlow message={messageWith(true, [{ status: "pending", decision: "approval_required" }])} onClose={() => {}} />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toMatch(/Policy engine: Held for approval \(Waiting for you\)/);
    expect(label).not.toMatch(/executed/);
  });

  it("labels Security OFF execution as unchecked, never as passed checks", () => {
    render(<ArchitectureFlow message={messageWith(false, [{ status: "ok", decision: "granted" }])} onClose={() => {}} />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toMatch(/Policy engine: Controls off \(Not enforced\)/);
    expect(label).toMatch(/1 executed · unchecked/);
    expect(within(screen.getByRole("region", { name: "Architecture" })).getAllByRole("listitem").length).toBeGreaterThan(6);
  });
});
