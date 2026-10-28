"use client";

import { Renderer } from "@openuidev/react-lang";
import { useEffect, useRef, useState } from "react";

import { chatLibrary } from "@/lib/agent/library";
import type { ToolView } from "@/lib/agent/planner";
import LoadingState from "@/components/ui/LoadingState";
import ThinkingState, { type ThinkingVariant } from "@/components/ui/ThinkingState";
import type { AssistantMessage, ChatMessage } from "./chat-state";

function variantFor(m: AssistantMessage): ThinkingVariant {
  const search = m.steps.filter((s) => s.kind === "search").length;
  return search > 0 && search >= m.steps.length / 2 ? "Search" : "Steps";
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export type ToolKind = "ok" | "pending" | "denied" | "error";

/** One icon and a state word per tool, derived only from the server's decision for that call. */
export function toolState(t: ToolView): { icon: string; word: string; kind: ToolKind } {
  if (t.status === "ok") return { icon: "✓", word: "", kind: "ok" };
  if (t.status === "pending") return { icon: "⏸", word: "Approval required", kind: "pending" };
  if (t.status === "error") return { icon: "!", word: "Unavailable", kind: "error" };
  return { icon: "⊘", word: t.decision === "untrusted_blocked" ? "Blocked" : "Denied", kind: "denied" };
}

/** The short sentence shown for a step. It names what happened, never what was merely proposed. */
export function activityPhrase(t: ToolView): string {
  const failClosed = (t.evals ?? []).some((e) => e.control === "failClosed" && e.decision === "blocked");
  if (failClosed) return "Security check unavailable";
  const s = toolState(t).kind;
  const by: Record<string, [string, string]> = {
    get_project: ["Project record read", "Project record blocked"],
    read_document: ["Document read", "Restricted document blocked"],
    list_documents: ["Project files listed", "Project files blocked"],
    search_kb: ["Knowledge base searched", "Knowledge base blocked"],
    fetch_updates: ["Plugin updates fetched", "Untrusted plugin blocked"],
    send_message: ["Message queued in outbox", "Send blocked"],
    export_records: ["Records exported", "Export blocked"],
  };
  const pair = by[t.tool];
  if (s === "pending") return "Approval required";
  if (s === "error") return `${t.label}: unavailable`;
  if (!pair) return s === "ok" ? t.label : `${t.label}: blocked`;
  return s === "ok" ? pair[0] : pair[1];
}

function ToolChips({ tools }: { tools: ToolView[] }) {
  return (
    <ul className="chips" aria-label="Tool activity" data-tour="tool-activity">
      {tools.map((t) => {
        const s = toolState(t);
        const failClosed = (t.evals ?? []).some((e) => e.control === "failClosed" && e.decision === "blocked");
        return (
          <li key={t.callId} className="chip-row" data-tour={s.kind === "denied" ? "denied" : undefined}>
            <span className={`tchip ${s.kind}`} data-state={t.status} title={`${t.label}${t.target !== "-" ? ` · ${t.target}` : ""}`}>
              <span className="ticon" aria-hidden="true">
                {failClosed ? "!" : s.icon}
              </span>
              <span className="tname">{activityPhrase(t)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function outcomeLine(t: ToolView): string {
  if (t.status === "ok") return "Executed";
  if (t.status === "pending") return "Not executed · waiting for approval";
  if (t.status === "error") return "Not executed · result unavailable";
  return "Not executed";
}

function Activity({ m, onEvidence }: { m: AssistantMessage; onEvidence: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (m.tools.length === 0) return null;
  const blocked = m.tools.filter((t) => t.status === "blocked" || t.status === "error").length;
  const pending = m.tools.filter((t) => t.status === "pending").length;
  return (
    <details className="trace" data-tour="activity">
      <summary>
        Activity ({m.tools.length})
        <span className="trace-sum">
          {blocked ? ` · ${blocked} blocked` : ""}
          {pending ? ` · ${pending} waiting` : ""}
        </span>
      </summary>
      <ol className="tl">
        {m.tools.map((t) => {
          const s = toolState(t);
          const isOpen = open === t.callId;
          return (
            <li key={t.callId} className={`tl-item ${s.kind}`}>
              <button type="button" className="tl-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.callId)}>
                <span className="ticon" aria-hidden="true">
                  {s.icon}
                </span>
                <span className="tl-name">
                  {t.label}
                  {t.target !== "-" ? <span className="ttarget"> {t.target}</span> : null}
                </span>
                <span className="tl-out">{s.kind === "ok" ? "Allowed" : s.word}</span>
              </button>
              {isOpen ? (
                <dl className="tl-detail">
                  <dt>Proposed</dt>
                  <dd>
                    {t.tool}
                    {t.target !== "-" ? ` on ${t.target}` : ""}
                  </dd>
                  <dt>Acting as</dt>
                  <dd>{t.principal}</dd>
                  <dt>Tool source</dt>
                  <dd>{t.source}</dd>
                  <dt>Server decision</dt>
                  <dd>
                    {t.decision.replace(/_/g, " ")}
                    {t.layer !== "none" ? ` · ${t.layer}` : ""}
                  </dd>
                  <dt>Why</dt>
                  <dd>{t.reason}</dd>
                  <dt>Outcome</dt>
                  <dd>{outcomeLine(t)}</dd>
                </dl>
              ) : null}
            </li>
          );
        })}
      </ol>
      <button type="button" className="linkish" onClick={() => onEvidence(m.id)}>
        Open full evidence
      </button>
    </details>
  );
}

function ApprovalCard({ item, deciding, onDecide }: { item: AssistantMessage["approvals"][number]; deciding: boolean; onDecide: (callId: string, approve: boolean) => void }) {
  if (item.state === "pending") {
    return (
      <div className="approval" role="group" aria-label="Approval required" data-tour="approval" aria-busy={deciding}>
        <div className="approval-text">
          <strong>Approval required</strong>
          <p className="approval-what">{item.summary}</p>
          <p className="approval-note">{deciding ? "Checking your decision with the server…" : "Not done yet. It runs only if you approve."}</p>
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={deciding} onClick={() => onDecide(item.callId, false)}>
            Deny
          </button>
          <button type="button" className="btn solid" disabled={deciding} onClick={() => onDecide(item.callId, true)}>
            Approve
          </button>
        </div>
      </div>
    );
  }
  // The result line states only what the execution layer confirmed.
  const ok = item.state === "approved" && item.view?.status === "ok";
  const text =
    item.state === "denied"
      ? "You declined. Nothing was sent."
      : item.state === "failed"
        ? `${item.error ?? "That didn't go through."} Nothing was run.`
        : ok
          ? "Approved · Message queued in outbox"
          : "Approved, but the action was still blocked by policy. Nothing was sent.";
  const icon = ok ? "✓" : item.state === "failed" ? "!" : "⊘";
  return (
    <p className={`approval-result ${ok ? "ok" : "no"}`} role="status">
      <span aria-hidden="true">{icon}</span> {text}
    </p>
  );
}

function AnswerView({ m }: { m: AssistantMessage }) {
  const [validFor, setValidFor] = useState<{ program: string; ok: boolean } | null>(null);
  if (!m.answer && !m.streamed) return null;
  // Text still streaming from the model is plain text; the final reply is rendered through OpenUI.
  if (!m.answer) {
    return (
      <div className="answer streaming" aria-live="polite">
        <p className="oc-p">{m.streamed}</p>
      </div>
    );
  }
  const candidate = m.answer.program;
  const modelAnswer = !!m.answer?.fallback;
  // A model-written program that fails to parse falls back to the deterministic message.
  const useFallback = modelAnswer && validFor?.program === candidate && !validFor.ok;
  const program = useFallback ? m.answer!.fallback!.program : candidate;
  return (
    <div className="answer" aria-live="polite">
      <Renderer
        response={program}
        library={chatLibrary}
        isStreaming={false}
        onParseResult={(r) => {
          if (modelAnswer && !useFallback) setValidFor((v) => (v?.program === candidate && v.ok === !!r?.root ? v : { program: candidate, ok: !!r?.root }));
        }}
      />
    </div>
  );
}

/** Copies the reply as plain text. The button says so only after the browser reports success. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1800);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" className="act" onClick={copy} aria-label={done ? "Copied" : "Copy reply"}>
      <span aria-hidden="true">{done ? "✓" : "⧉"}</span>
      <span className="act-text">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function AssistantBubble({ m, deciding, onDecide, onEvidence }: { m: AssistantMessage; deciding: ReadonlySet<string>; onDecide: (callId: string, approve: boolean) => void; onEvidence: (id: string) => void }) {
  const working = m.status === "working";
  const elapsed = m.endedAt ? m.endedAt - m.startedAt : undefined;
  const src = m.trace.find((t) => t.kind === "model");
  const plain = m.answer?.plain;
  return (
    <div className="msg assistant" data-status={m.status}>
      <div className="body">
        {working && m.steps.length === 0 && !m.answer && !m.streamed ? <LoadingState variant="Dots" label="Atlas is working" /> : null}
        {working ? <ThinkingState steps={m.steps} running variant={variantFor(m)} elapsedMs={undefined} /> : null}
        {m.tools.length > 0 ? <ToolChips tools={m.tools} /> : null}
        <AnswerView m={m} />
        {m.approvals.map((a) => (
          <ApprovalCard key={a.callId} item={a} deciding={deciding.has(a.callId)} onDecide={onDecide} />
        ))}
        {m.status === "stopped" ? <p className="muted-line">Stopped.</p> : null}
        {m.error ? (
          <p role="alert" className="err">
            <span aria-hidden="true">! </span>
            {m.error}
          </p>
        ) : null}
        {!working ? <Activity m={m} onEvidence={onEvidence} /> : null}
        {!working && elapsed !== undefined && m.tools.length === 0 && m.steps.length > 0 ? <span className="muted-line">{(elapsed / 1000).toFixed(1)}s</span> : null}
        {!working ? (
          <div className="msg-foot">
            {src && src.kind === "model" ? (
              <p className={`src-tag ${src.engine}`} data-engine={src.engine}>
                <span className="src-dot" aria-hidden="true" />
                {src.engine === "scripted" ? "Rule-based reply · no language model" : src.engine === "llm" ? `Model reply · ${src.label}` : "Built-in assistant · no language model"}
              </p>
            ) : null}
            {plain ? <CopyButton text={plain} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  deciding,
  onDecide,
  onEvidence,
}: {
  messages: ChatMessage[];
  deciding?: ReadonlySet<string>;
  onDecide: (callId: string, approve: boolean) => void;
  onEvidence: (id: string) => void;
}) {
  const none = EMPTY_SET;
  return (
    <>
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="msg user">
            <div className="bubble">{m.text}</div>
          </div>
        ) : m.role === "mode" ? (
          <p key={m.id} className="divider">
            Security {m.security ? "on" : "off"}
          </p>
        ) : (
          <AssistantBubble key={m.id} m={m} deciding={deciding ?? none} onDecide={onDecide} onEvidence={onEvidence} />
        ),
      )}
    </>
  );
}
