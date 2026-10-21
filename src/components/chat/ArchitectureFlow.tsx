"use client";

import { CONTROL_INFO } from "@/lib/agent/controls";
import type { ControlKey } from "@/lib/agent/policy";
import type { AssistantMessage } from "./chat-state";
import { buildWalkthrough } from "./walkthrough-model";

type NodeState = "idle" | "done" | "ok" | "blocked" | "pending" | "off";

interface FlowNode {
  id: string;
  title: string;
  sub: string;
  state: NodeState;
  /** Where the code that makes this decision runs. */
  where: "browser" | "model" | "server";
  detail: string;
  word?: string;
}

const ICON: Record<NodeState, string> = { idle: "○", done: "●", ok: "✓", blocked: "⊘", pending: "⏸", off: "–" };
const STATE_WORD: Record<NodeState, string> = { idle: "Not used yet", done: "Happened", ok: "Passed", blocked: "Stopped", pending: "Waiting for you", off: "Not enforced" };

const NODE_W = 128;
const GAP = 30;
const X0 = 16;
const nodeX = (i: number) => X0 + i * (NODE_W + GAP);

/** Derives the picture strictly from recorded events for the selected reply. Nothing is shown as executed unless the server said so. */
function deriveNodes(m: AssistantMessage | undefined): FlowNode[] {
  const asked = !!m;
  const tools = m?.tools ?? [];
  const ran = tools.filter((t) => t.status === "ok");
  const pending = tools.filter((t) => t.status === "pending");
  const stopped = tools.filter((t) => t.status !== "ok" && t.status !== "pending");
  const audits = m?.trace.filter((t) => t.kind === "audit").length ?? 0;
  const model = m?.trace.find((t) => t.kind === "model");
  const security = !!m?.security;

  const policy: NodeState = tools.length === 0 ? "idle" : !security ? "off" : stopped.length ? "blocked" : pending.length ? "pending" : "ok";
  return [
    { id: "user", title: "You", sub: asked ? "Sent a request" : "Waiting", state: asked ? "done" : "idle", where: "browser", detail: asked ? m!.request : "Ask something, or run a guided stage." },
    { id: "ui", title: "Atlas UI", sub: asked ? `Security ${security ? "ON" : "OFF"}` : "Chat interface", state: asked ? "done" : "idle", where: "browser", detail: "The browser sends the request. Its Security switch is a demo setting and gives it no privileges." },
    {
      id: "model",
      title: model && model.kind === "model" ? (model.engine === "llm" ? "Live model" : model.engine === "scripted" ? "Scripted planner" : "Built-in assistant") : "Model",
      sub: model && model.kind === "model" ? (model.engine === "llm" ? model.label : "No language model") : "Proposes actions",
      state: model ? "done" : "idle",
      where: "model",
      detail: "Proposes tool calls. A proposal is not authorization.",
    },
    {
      id: "policy",
      title: "Policy engine",
      sub: policy === "idle" ? "Server-side" : policy === "off" ? "Controls off" : policy === "blocked" ? `${stopped.length} stopped` : policy === "pending" ? "Held for approval" : "All checks passed",
      state: policy,
      where: "server",
      detail: "Validates every proposed call on the server: trust, allowlist, identity, credentials, resource access, approval.",
    },
    {
      id: "tool",
      title: "Tool",
      sub: ran.length ? `${ran.length} executed${security ? "" : " · unchecked"}` : tools.length ? "Did not run" : "Synthetic data only",
      word: ran.length ? "Executed" : tools.length ? (pending.length && !stopped.length ? "Held" : "Did not run") : undefined,
      state: ran.length ? "ok" : tools.length ? (pending.length && !stopped.length ? "pending" : "blocked") : "idle",
      where: "server",
      detail: "Runs only after the policy engine allows it. Output is filtered before it returns.",
    },
    {
      id: "audit",
      title: "Audit",
      sub: audits ? `${audits} record${audits === 1 ? "" : "s"}` : tools.length ? (security ? "No record" : "Auditing off") : "In memory",
      state: audits ? "ok" : tools.length && !security ? "off" : "idle",
      where: "server",
      detail: "One record per decision when Security is ON. In memory and not durable.",
    },
  ];
}

type Agg = "blocked" | "indeterminate" | "detected" | "allowed" | "not_applicable" | "none";
const RANK: Agg[] = ["blocked", "indeterminate", "detected", "allowed", "not_applicable", "none"];
const AGG_LABEL: Record<Agg, string> = { blocked: "Blocked", indeterminate: "Unknown", detected: "Detected only", allowed: "Passed", not_applicable: "Not enforced", none: "Not reached" };
const AGG_ICON: Record<Agg, string> = { blocked: "⊘", indeterminate: "?", detected: "◉", allowed: "✓", not_applicable: "–", none: "○" };

function controlStates(m: AssistantMessage | undefined): Map<ControlKey, Agg> {
  const out = new Map<ControlKey, Agg>();
  if (!m) return out;
  for (const s of buildWalkthrough(m)) {
    for (const e of s.evals) {
      const cur = out.get(e.control) ?? "none";
      if (RANK.indexOf(e.decision as Agg) < RANK.indexOf(cur)) out.set(e.control, e.decision as Agg);
    }
  }
  return out;
}

type Branch = "allow" | "deny" | "approval" | "unavailable";
const BRANCHES: { id: Branch; icon: string; label: string; cls: string }[] = [
  { id: "allow", icon: "✓", label: "Allow", cls: "ok" },
  { id: "deny", icon: "⊘", label: "Deny", cls: "blocked" },
  { id: "approval", icon: "⏸", label: "Approval required", cls: "pending" },
  { id: "unavailable", icon: "!", label: "Authorization unavailable", cls: "blocked" },
];

/** Which outcomes the server actually produced for this reply. */
function takenBranches(m: AssistantMessage | undefined): Set<Branch> {
  const out = new Set<Branch>();
  if (!m) return out;
  for (const t of m.tools) {
    const failClosed = (t.evals ?? []).some((e) => e.control === "failClosed" && e.decision === "blocked");
    if (failClosed) out.add("unavailable");
    else if (t.status === "ok") out.add("allow");
    else if (t.status === "pending") out.add("approval");
    else out.add("deny");
  }
  return out;
}

export default function ArchitectureFlow({ message, onClose, embedded = false }: { message: AssistantMessage | undefined; onClose?: () => void; embedded?: boolean }) {
  const taken = takenBranches(message);
  const nodes = deriveNodes(message);
  const states = controlStates(message);
  const keys = Object.keys(CONTROL_INFO) as ControlKey[];
  const width = X0 * 2 + nodes.length * NODE_W + (nodes.length - 1) * GAP;
  const summary = nodes.map((n) => `${n.title}: ${n.sub} (${STATE_WORD[n.state]})`).join(". ");

  return (
    <section className={`arch${embedded ? " embedded" : ""}`} aria-label="Architecture">
      {embedded ? null : (
      <div className="arch-head">
        <div>
          <h2>How a request is decided</h2>
          <p className="arch-sub">{message ? "Lit from the real events of the selected reply." : "Send a message or run a guided stage to light up the path."} The model proposes; the server decides.</p>
        </div>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Close architecture
        </button>
      </div>
      )}
      <svg className="arch-svg" viewBox={`0 0 ${width} 150`} role="img" aria-label={summary}>
        <defs>
          <marker id="arch-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" className="arch-arrow-head" />
          </marker>
        </defs>
        <rect x={nodeX(3) - 10} y="6" width={NODE_W * 3 + GAP * 2 + 20} height="132" rx="18" className="arch-zone" />
        <text x={nodeX(3) + 4} y="22" className="arch-zone-label">
          SERVER · TRUST BOUNDARY
        </text>
        {nodes.slice(0, -1).map((n, i) => {
          const next = nodes[i + 1];
          const x1 = nodeX(i) + NODE_W;
          const x2 = nodeX(i + 1);
          const reached = next.state !== "idle";
          const halt = n.id === "policy" && (next.state === "blocked" || next.state === "pending");
          return (
            <g key={n.id}>
              <line x1={x1} y1="80" x2={halt ? x1 + GAP / 2 - 3 : x2 - 2} y2="80" className={`arch-link${reached ? " live" : ""}${halt ? ` halt ${next.state}` : ""}`} markerEnd={halt ? undefined : "url(#arch-arrow)"} />
              {halt ? (
                <g className={`arch-stop ${next.state}`}>
                  <line x1={x1 + GAP / 2 + 1} y1="68" x2={x1 + GAP / 2 + 1} y2="92" />
                </g>
              ) : null}
            </g>
          );
        })}
        {nodes.map((n, i) => (
          <g key={n.id} className={`arch-node ${n.state} ${n.where}`} transform={`translate(${nodeX(i)} 46)`}>
            <rect width={NODE_W} height="68" rx="14" />
            <text x="12" y="23" className="arch-ico">
              {ICON[n.state]}
            </text>
            <text x="30" y="23" className="arch-title">
              {n.title}
            </text>
            <text x="12" y="44" className="arch-subtext">
              {n.sub.length > 21 ? `${n.sub.slice(0, 20)}…` : n.sub}
            </text>
            <text x="12" y="59" className="arch-state">
              {n.word ?? STATE_WORD[n.state]}
            </text>
          </g>
        ))}
      </svg>
      <ol className="arch-steps" aria-hidden="true">
        {nodes.map((n) => (
          <li key={n.id} className={`step ${n.state}`}>
            <span className="step-ico">{ICON[n.state]}</span>
            <span className="step-txt">
              <strong>{n.title}</strong> <em>{n.sub}</em>
            </span>
            <span className="step-state">{n.word ?? STATE_WORD[n.state]}</span>
          </li>
        ))}
      </ol>
      <ul className="arch-branches" aria-label="Possible server outcomes">
        {BRANCHES.map((b) => (
          <li key={b.id} className={`branch ${taken.has(b.id) ? `taken ${b.cls}` : "idle"}`}>
            <span aria-hidden="true">{b.icon}</span> {b.label} <span className="branch-state">{message ? (taken.has(b.id) ? "Happened" : "Not taken") : "Possible"}</span>
          </li>
        ))}
      </ul>
      <ul className="arch-notes">
        {nodes.map((n) => (
          <li key={n.id}>
            <strong>{n.title}.</strong> {n.detail}
          </li>
        ))}
      </ul>
      <h3 className="arch-h3">Controls on the server path {message ? "(this reply)" : ""}</h3>
      <ul className="arch-controls">
        {keys.map((k) => {
          const a = states.get(k) ?? "none";
          return (
            <li key={k} className={`ctl ${a}`} title={CONTROL_INFO[k].purpose}>
              <span aria-hidden="true">{AGG_ICON[a]}</span> {CONTROL_INFO[k].name} <span className="ctl-state">{message ? AGG_LABEL[a] : "Part of the design"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
