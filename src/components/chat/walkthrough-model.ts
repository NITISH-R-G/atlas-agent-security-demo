import { CONTROL_INFO, type ControlEval, type EvalDecision } from "@/lib/agent/controls";
import type { ControlKey } from "@/lib/agent/policy";
import type { AssistantMessage, TraceItem } from "./chat-state";

/** The pre-execution pipeline, in order. Used to say which controls a blocked call never reached. */
const PIPELINE: ControlKey[] = ["trustValidation", "toolAllowlist", "leastPrivilege", "scopedCredentials", "resourceAuthz"];

export type StepKind = "request" | "engine" | "tool" | "content" | "approval" | "audit" | "reply";
export type StepOutcome = "info" | "allowed" | "blocked" | "pending" | "detected" | "indeterminate" | "failed";

export interface WalkStep {
  id: string;
  kind: StepKind;
  title: string;
  outcome: StepOutcome;
  detail: string;
  evals: ControlEval[];
  /** For tool steps: who the action ran as, and where the tool comes from. */
  principal?: string;
  source?: string;
  /** For blocked tool calls: the reason shown by "Why was this blocked?". */
  why?: string;
  /** The control that prevented the action, if any. */
  blockedBy?: string;
  /** Controls that belong to the pipeline but were not reached for this call (an earlier check stopped it). */
  notEvaluated?: string[];
  /** Linkage to the audit record for this call, when auditing was on. */
  auditRef?: string;
}

export const DECISION_LABEL: Record<EvalDecision, string> = {
  allowed: "Evaluated, allowed",
  blocked: "Evaluated, blocked",
  detected: "Detected, not blocked",
  not_applicable: "Not enforced",
  indeterminate: "Indeterminate",
};

export const EFFECT_LABEL = { prevented: "Prevented", detected: "Detected only", documented: "Documented", none: "No effect" } as const;

/** Outcome of a set of evaluations, without calling a detection a prevention. */
export function outcomeOf(evals: ControlEval[], pending = false): StepOutcome {
  if (pending) return "pending";
  if (evals.some((e) => e.decision === "blocked")) return "blocked";
  if (evals.some((e) => e.decision === "indeterminate")) return "indeterminate";
  if (evals.some((e) => e.decision === "detected")) return "detected";
  return "allowed";
}

/**
 * Builds the walkthrough strictly from recorded trace items (real execution events). Nothing is inferred from
 * the assistant's natural-language answer.
 */
export function buildWalkthrough(m: AssistantMessage): WalkStep[] {
  const steps: WalkStep[] = [
    { id: "request", kind: "request", title: "You asked", outcome: "info", detail: `${m.request} (Security ${m.security ? "ON" : "OFF"})`, evals: [] },
  ];
  for (const t of m.trace as TraceItem[]) {
    if (t.kind === "model") {
      steps.push({ id: `engine-${steps.length}`, kind: "engine", title: t.label, outcome: "info", detail: t.note ?? (t.engine === "llm" ? "The model proposes; the server decides whether each tool call may run." : "Tools are selected by deterministic code, not a model."), evals: [] });
    } else if (t.kind === "tool") {
      const v = t.view;
      const evals = v.evals ?? [];
      const blockedEval = evals.find((e) => e.decision === "blocked");
      const audit = m.trace.find((x): x is Extract<TraceItem, { kind: "audit" }> => x.kind === "audit" && x.record.callId === v.callId && x.record.decision === v.decision);
      const reached = new Set(evals.map((e) => e.control));
      const stopped = v.status === "blocked" && v.decision !== "invalid" && v.layer !== "approvalForSensitive";
      steps.push({
        id: `tool-${v.callId}`,
        kind: "tool",
        title: `${v.label}${v.target !== "-" ? ` → ${v.target}` : ""}`,
        outcome: v.status === "pending" ? "pending" : v.status === "error" ? "failed" : v.decision === "invalid" ? "blocked" : outcomeOf(evals),
        detail: v.status === "ok" ? "Executed after the checks below." : v.status === "pending" ? "Held until you decide." : v.reason,
        evals,
        principal: v.principal,
        source: v.source,
        why: v.status === "ok" ? undefined : v.reason,
        blockedBy: blockedEval ? CONTROL_INFO[blockedEval.control].name : v.decision === "invalid" ? "Argument validation (platform)" : undefined,
        notEvaluated: stopped ? PIPELINE.filter((c) => !reached.has(c)).map((c) => CONTROL_INFO[c].name) : undefined,
        auditRef: audit ? `${audit.record.callId.slice(-12)} · ${audit.record.decision}${audit.record.source ? ` · ${audit.record.source}` : ""}` : undefined,
      });
    } else if (t.kind === "content") {
      steps.push({
        id: `content-${steps.length}`,
        kind: "content",
        title: `Untrusted content: ${t.source}`,
        outcome: outcomeOf(t.evals),
        detail: t.found > 0 ? `${t.found} instruction-like line(s) found by a heuristic scan.` : "Heuristic scan found no instruction-like text (not a guarantee).",
        evals: t.evals,
        why: outcomeOf(t.evals) === "blocked" ? "Retrieved content is treated as data, so instructions inside it cannot direct the agent." : undefined,
        blockedBy: t.evals.find((e) => e.decision === "blocked") ? CONTROL_INFO[t.evals.find((e) => e.decision === "blocked")!.control].name : undefined,
      });
    } else if (t.kind === "approval") {
      steps.push({ id: `approval-${t.callId}`, kind: "approval", title: "Your approval decision", outcome: t.outcome === "approved" ? "allowed" : t.outcome === "denied" ? "blocked" : "failed", detail: t.text, evals: [] });
    }
  }
  const audits = m.trace.filter((t): t is Extract<TraceItem, { kind: "audit" }> => t.kind === "audit");
  if (audits.length) {
    steps.push({
      id: "audit",
      kind: "audit",
      title: `Audit events (${audits.length}, in-memory, not durable)`,
      outcome: "info",
      detail: audits.map((a) => `${a.record.tool} → ${a.record.target}: ${a.record.decision}${a.record.layer !== "none" ? ` (${a.record.layer})` : ""} [${a.record.callId.slice(-6)}${a.record.source ? ` · ${a.record.source}` : ""}]`).join("\n"),
      evals: [],
    });
  }
  if (m.answer) steps.push({ id: "reply", kind: "reply", title: "Reply", outcome: "info", detail: "The reply is rendered from the server's confirmed results.", evals: [] });
  return steps;
}
