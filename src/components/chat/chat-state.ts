import type { AuditView } from "@/lib/agent/approve";
import type { ControlEval } from "@/lib/agent/controls";
import type { AgentEvent, ToolView } from "@/lib/agent/planner";

export interface ApprovalItem {
  callId: string;
  label: string;
  summary: string;
  ticket?: string;
  /** Only "approved" with a confirming view means the action actually ran. */
  state: "pending" | "approved" | "denied" | "failed";
  view?: ToolView;
  error?: string;
}

export interface StepItem {
  id: string;
  kind: "search" | "check" | "tool" | "validate" | "reason";
  text: string;
  state: "running" | "done" | "failed";
}

/** The walkthrough follows these entries, which are recorded only from real execution events. */
export type TraceItem =
  | { kind: "model"; engine: "llm" | "scripted" | "deterministic"; label: string; note?: string }
  | { kind: "tool"; view: ToolView }
  | { kind: "content"; source: string; found: number; evals: ControlEval[] }
  | { kind: "audit"; record: AuditView }
  | { kind: "approval"; callId: string; outcome: "approved" | "denied" | "failed"; text: string };

export interface AssistantMessage {
  id: string;
  role: "assistant";
  status: "working" | "stopped" | "done" | "error";
  /** Security mode in effect when this reply ran. */
  security: boolean;
  /** The request that produced this reply (shown as the first walkthrough step). */
  request: string;
  steps: StepItem[];
  tools: ToolView[];
  approvals: ApprovalItem[];
  trace: TraceItem[];
  streamed: string;
  answer?: { program: string; plain: string; fallback?: { program: string; plain: string } };
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "mode"; security: boolean }
  | AssistantMessage;

export interface ChatState {
  messages: ChatMessage[];
}

export type ApprovalResolution =
  | { decision: "approved"; view: ToolView; audit?: AuditView }
  | { decision: "denied"; audit?: AuditView }
  | { decision: "failed"; error: string };

export type ChatAction =
  | { type: "send"; userId: string; assistantId: string; text: string; security: boolean; now: number }
  | { type: "mode"; id: string; security: boolean }
  | { type: "event"; id: string; event: AgentEvent }
  | { type: "end"; id: string; status: "done" | "stopped" | "error"; error?: string; now: number }
  | { type: "approval"; id: string; callId: string; result: ApprovalResolution }
  | { type: "clear" };

export const initialChat: ChatState = { messages: [] };

const mapAssistant = (s: ChatState, id: string, f: (m: AssistantMessage) => AssistantMessage): ChatState => ({
  messages: s.messages.map((m) => (m.role === "assistant" && m.id === id ? f(m) : m)),
});

const upsertTool = (trace: TraceItem[], view: ToolView): TraceItem[] => {
  const i = trace.findIndex((t) => t.kind === "tool" && t.view.callId === view.callId);
  return i >= 0 ? trace.map((t, j) => (j === i ? { kind: "tool", view } : t)) : [...trace, { kind: "tool", view }];
};

export function chatReducer(state: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case "send":
      return {
        messages: [
          ...state.messages,
          { id: a.userId, role: "user", text: a.text },
          { id: a.assistantId, role: "assistant", status: "working", security: a.security, request: a.text, steps: [], tools: [], approvals: [], trace: [], streamed: "", startedAt: a.now },
        ],
      };
    case "mode":
      return { messages: [...state.messages, { id: a.id, role: "mode", security: a.security }] };
    case "event":
      return mapAssistant(state, a.id, (m): AssistantMessage => {
        const e = a.event;
        switch (e.type) {
          case "step": {
            const i = m.steps.findIndex((s) => s.id === e.id);
            const item: StepItem = { id: e.id, kind: e.kind, text: e.text, state: e.state };
            return { ...m, steps: i >= 0 ? m.steps.map((s, j) => (j === i ? item : s)) : [...m.steps, item] };
          }
          case "tool":
            return { ...m, tools: [...m.tools.filter((t) => t.callId !== e.view.callId), e.view], trace: upsertTool(m.trace, e.view) };
          case "approval":
            return { ...m, approvals: [...m.approvals, { callId: e.callId, label: e.label, summary: e.summary, ticket: e.ticket, state: "pending" }] };
          case "delta":
            return { ...m, streamed: m.streamed + e.text };
          case "answer":
            return { ...m, answer: { program: e.program, plain: e.plain, fallback: e.fallback }, streamed: "" };
          case "content":
            return { ...m, trace: [...m.trace, { kind: "content", source: e.source, found: e.found, evals: e.evals }] };
          case "audit":
            return { ...m, trace: [...m.trace, { kind: "audit", record: e.record }] };
          case "model":
            return { ...m, trace: [...m.trace, { kind: "model", engine: e.engine, label: e.label, note: e.note }] };
          case "error":
            return { ...m, error: e.message };
          default:
            return m;
        }
      });
    case "end":
      return mapAssistant(state, a.id, (m) => ({
        ...m,
        status: a.status === "done" && m.error ? "error" : a.status,
        error: a.error ?? m.error,
        endedAt: a.now,
        // A stopped run must not leave steps pretending to still be in progress.
        steps: m.steps.map((s) => (s.state === "running" ? { ...s, state: "failed" } : s)),
      }));
    case "approval":
      return mapAssistant(state, a.id, (m): AssistantMessage => {
        const r = a.result;
        const current = m.approvals.find((p) => p.callId === a.callId);
        if (!current || current.state !== "pending") return m; // late duplicate or unknown id: never overwrite a settled outcome
        let trace = m.trace;
        if (r.decision === "approved") trace = upsertTool(trace, r.view);
        if (r.decision !== "failed" && r.audit) trace = [...trace, { kind: "audit", record: r.audit }];
        trace = [
          ...trace,
          {
            kind: "approval",
            callId: a.callId,
            outcome: r.decision,
            text: r.decision === "approved" ? (r.view.status === "ok" ? "You approved; the server re-checked the action and ran it." : "You approved, but the server still blocked it.") : r.decision === "denied" ? "You declined; the action was not executed." : `Approval failed: ${r.error}`,
          },
        ];
        return {
          ...m,
          trace,
          // The chip must show the resolved outcome, not the stale "Approval required".
          tools: m.tools.map((t) =>
            t.callId !== a.callId
              ? t
              : r.decision === "approved"
                ? r.view
                : r.decision === "denied"
                  ? { ...t, decision: "denied" as const, status: "blocked" as const, reason: "You declined this action.", notices: ["Declined"] }
                  : t,
          ),
          approvals: m.approvals.map((p) =>
            p.callId !== a.callId
              ? p
              : r.decision === "approved"
                ? { ...p, state: "approved", view: r.view }
                : r.decision === "denied"
                  ? { ...p, state: "denied" }
                  : { ...p, state: "failed", error: r.error },
          ),
        };
      });
    case "clear":
      return initialChat;
    default:
      return state;
  }
}
