"use client";

import { useState } from "react";

import { CONTROL_INFO } from "@/lib/agent/controls";
import type { AssistantMessage } from "./chat-state";
import { DECISION_LABEL, EFFECT_LABEL, buildWalkthrough, type StepOutcome } from "./walkthrough-model";

const OUTCOME_LABEL: Record<StepOutcome, string> = {
  info: "Info",
  allowed: "Allowed",
  blocked: "Blocked",
  pending: "Waiting",
  detected: "Detected",
  indeterminate: "Indeterminate",
  failed: "Failed",
};

const GLYPH: Record<StepOutcome, string> = { info: "•", allowed: "✓", blocked: "⊘", pending: "…", detected: "◉", indeterminate: "?", failed: "!" };

export default function Walkthrough({ message, onClose }: { message: AssistantMessage | undefined; onClose: () => void }) {
  const [picked, setPicked] = useState<{ messageId?: string; stepId: string } | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const steps = message ? buildWalkthrough(message) : [];
  const selectedId = picked && picked.messageId === message?.id ? picked.stepId : (steps.find((s) => s.outcome === "blocked" || s.outcome === "pending")?.id ?? steps[0]?.id);
  const selected = steps.find((s) => s.id === selectedId);

  return (
    <aside className="wt" aria-label="Security walkthrough">
      <div className="wt-head">
        <h2>Security walkthrough</h2>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      {!message ? (
        <p className="wt-empty">Send a message. This panel will list the checks that actually ran for it.</p>
      ) : (
        <>
          <p className="wt-sub">
            Follows the real execution of the selected reply. Security was <strong>{message.security ? "ON" : "OFF"}</strong> for it. The browser only sends the setting; the server turns it into a fixed policy.
          </p>
          <ol className="wt-steps">
            {steps.map((s) => (
              <li key={s.id}>
                <button type="button" className={`wt-step ${s.outcome}${s.id === selectedId ? " sel" : ""}`} aria-current={s.id === selectedId ? "step" : undefined} onClick={() => { setPicked({ messageId: message.id, stepId: s.id }); setWhy(null); }}>
                  <span className="wt-glyph" aria-hidden="true">
                    {GLYPH[s.outcome]}
                  </span>
                  <span className="wt-title">{s.title}</span>
                  <span className="wt-tag">{OUTCOME_LABEL[s.outcome]}</span>
                </button>
              </li>
            ))}
          </ol>
          {selected ? (
            <section className="wt-detail" aria-label="Step details">
              <h3>{selected.title}</h3>
              <p className="wt-text">{selected.detail}</p>
              {selected.principal ? (
                <dl className="tl-detail">
                  {selected.action ? (
                    <>
                      <dt>Permission needed</dt>
                      <dd>{selected.action}</dd>
                    </>
                  ) : null}
                  <dt>Acting as</dt>
                  <dd>{selected.principal}</dd>
                  <dt>Tool source</dt>
                  <dd>{selected.source}</dd>
                </dl>
              ) : null}
              {selected.evals.length ? (
                <ul className="wt-evals">
                  {selected.evals.map((e, i) => {
                    const info = CONTROL_INFO[e.control];
                    return (
                      <li key={`${e.control}-${i}`} className={`ev ${e.decision}`}>
                        <div className="ev-top">
                          <strong>{info.name}</strong>
                          <span className="wt-tag">{DECISION_LABEL[e.decision]}</span>
                        </div>
                        <p className="ev-purpose">{info.purpose}</p>
                        <dl>
                          <dt>Stage</dt>
                          <dd>{info.stage}</dd>
                          <dt>Reason code</dt>
                          <dd>
                            <code>{e.code}</code>
                          </dd>
                          <dt>Evidence</dt>
                          <dd>{e.evidence}</dd>
                          <dt>Effect</dt>
                          <dd>{EFFECT_LABEL[e.effect]}</dd>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {selected.notEvaluated?.length ? <p className="wt-text">Not evaluated (an earlier check stopped the call): {selected.notEvaluated.join(", ")}.</p> : null}
              {selected.kind === "tool" ? <p className="wt-text">Audit record: {selected.auditRef ?? "none (auditing is off in this profile)"}</p> : null}
              {selected.kind === "audit" ? <pre className="wt-audit">{selected.detail}</pre> : null}
              {selected.why && (selected.outcome === "blocked" || selected.outcome === "pending") ? (
                <div>
                  <button type="button" className="why" aria-expanded={why === selected.id} onClick={() => setWhy(why === selected.id ? null : selected.id)}>
                    Why was this blocked?
                  </button>
                  {why === selected.id ? (
                    <p className="wt-why">
                      {selected.why}
                      {selected.blockedBy ? ` Decided by: ${selected.blockedBy}.` : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}
