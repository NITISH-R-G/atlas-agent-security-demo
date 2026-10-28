"use client";

import { useState } from "react";

import ArchitectureFlow from "./ArchitectureFlow";
import type { AssistantMessage, ChatMessage } from "./chat-state";
import { DEMO_STAGES, type DemoStage } from "./DemoGuide";
import { MessageList } from "./Messages";
import Tour, { type TourStep } from "./Tour";

export const TOUR_STEPS: TourStep[] = [
  { target: '[data-tour="security"]', title: "Security mode", text: "On: the server enforces policy before any tool runs." },
  { target: '[data-tour="tool-activity"]', title: "Agent action", text: "The model proposes actions. The server decides whether they run." },
  { target: '[data-tour="denied"]', title: "Policy decision", text: "This request was stopped by the server's policy before it ran." },
  { target: '[data-tour="approval"]', title: "Human approval", text: "Sensitive actions pause until you decide." },
  { target: '[data-tour="activity"]', title: "Evidence", text: "Open Activity to see the recorded decision and outcome." },
];

type Tab = "replay" | "architecture";

export default function ExploreSecurity({
  messages,
  stageRuns,
  busy,
  onRun,
  onDecide,
  deciding,
  onEvidence,
  onBack,
  startTour,
}: {
  messages: ChatMessage[];
  /** stage id -> assistant message id of its latest run */
  stageRuns: Record<string, string>;
  busy: boolean;
  onRun: (s: DemoStage) => Promise<void>;
  onDecide: (callId: string, approve: boolean) => void;
  deciding: ReadonlySet<string>;
  onEvidence: (id: string) => void;
  onBack: () => void;
  startTour: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("replay");
  const [pick, setPick] = useState<string>("C");
  const [touring, setTouring] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const msgFor = (id: string) => messages.find((m): m is AssistantMessage => m.role === "assistant" && m.id === stageRuns[id]);

  const beginTour = async () => {
    setTab("replay");
    setPreparing(true);
    try {
      // Real scenarios, run by the real server, give the tour real things to point at.
      await startTour();
    } finally {
      setPreparing(false);
    }
    // Let the freshly rendered replies lay out before the tour measures them.
    window.setTimeout(() => setTouring(true), 60);
  };

  return (
    <section className="explore" aria-label="Explore Security">
      <div className="ex-head">
        <button type="button" className="btn ghost small" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to chat
        </button>
        <h2>Explore Security</h2>
        <button type="button" className="btn small" onClick={beginTour} disabled={busy || preparing}>
          {preparing ? "Preparing…" : "Take the tour"}
        </button>
      </div>
      <p className="ex-sub">Four scripted scenarios on fictional data. The server makes every decision; nothing leaves the app.</p>

      <ul className="ex-cards">
        {DEMO_STAGES.map((s) => {
          const ran = !!stageRuns[s.id];
          return (
            <li key={s.id} className={`ex-card${ran ? " ran" : ""}`}>
              <span className={`ex-ico s-${s.id}`} aria-hidden="true">
                {s.icon}
              </span>
              <div className="ex-txt">
                <strong>
                  {s.id} · {s.short}
                </strong>
                <span>{s.line}</span>
              </div>
              <button
                type="button"
                className="btn small"
                aria-label={`${ran ? "Replay" : "Run"} scenario ${s.id}, ${s.short}`}
                disabled={busy || preparing}
                onClick={() => {
                  setPick(s.id);
                  void onRun(s);
                }}
              >
                {ran ? "Replay" : "Run"}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="ex-tabs" role="tablist" aria-label="Explore views">
        <button type="button" role="tab" id="tab-replay" aria-selected={tab === "replay"} aria-controls="panel-explore" className={tab === "replay" ? "on" : ""} onClick={() => setTab("replay")}>
          Replay
        </button>
        <button type="button" role="tab" id="tab-arch" aria-selected={tab === "architecture"} aria-controls="panel-explore" className={tab === "architecture" ? "on" : ""} onClick={() => setTab("architecture")}>
          Architecture
        </button>
      </div>

      <div id="panel-explore" role="tabpanel" aria-labelledby={tab === "replay" ? "tab-replay" : "tab-arch"} className="ex-panel">
        {tab === "replay" ? (
          messages.length === 0 ? (
            <p className="ex-empty">Run a scenario to replay it here.</p>
          ) : (
            <div className="log">
              <MessageList messages={messages} deciding={deciding} onDecide={onDecide} onEvidence={onEvidence} />
            </div>
          )
        ) : (
          <>
            <div className="ex-pills" role="group" aria-label="Scenario to visualize">
              {DEMO_STAGES.map((s) => (
                <button key={s.id} type="button" className={`pill${pick === s.id ? " on" : ""}`} aria-pressed={pick === s.id} onClick={() => setPick(s.id)}>
                  {s.id} · {s.short}
                  {stageRuns[s.id] ? "" : " (not run)"}
                </button>
              ))}
            </div>
            <ArchitectureFlow message={msgFor(pick)} embedded />
          </>
        )}
      </div>
      {touring ? <Tour steps={TOUR_STEPS} onClose={() => setTouring(false)} /> : null}
    </section>
  );
}
