"use client";

export const DEMO_PROMPT = "Find the latest project updates.";
export const DEMO_SEND_PROMPT = "Send the project summary to the team.";

export interface DemoStage {
  id: "A" | "B" | "C" | "D";
  title: string;
  blurb: string;
  security: boolean;
  message: string;
  fault?: "authz";
  /** Short label, icon and one-line description for the Explore Security launcher. */
  short: string;
  icon: string;
  line: string;
}

export const DEMO_STAGES: DemoStage[] = [
  { id: "A", short: "Vulnerable", icon: "!", line: "Security off. A hidden instruction is followed (fictional).", title: "Security OFF", blurb: "The scripted agent uses an untrusted plugin, follows hidden instructions and reads a restricted memo (synthetic).", security: false, message: DEMO_PROMPT },
  { id: "B", short: "Protected", icon: "✓", line: "Same request, Security on. The plugin is blocked.", title: "Security ON, same request", blurb: "The plugin is blocked, the first-party record is used, no restricted resource is touched.", security: true, message: DEMO_PROMPT },
  { id: "C", short: "Approval", icon: "⏸", line: "A sensitive send waits for your decision.", title: "Sensitive action needs approval", blurb: "Sending to the (synthetic) team outbox waits for you. Approve or deny and check the result.", security: true, message: DEMO_SEND_PROMPT },
  { id: "D", short: "Fail closed", icon: "⊘", line: "Authorization fails. The action is stopped.", title: "Authorization check fails", blurb: "A simulated authorization outage: with Security ON the send is denied (fail closed).", security: true, message: DEMO_SEND_PROMPT, fault: "authz" },
];

/**
 * A compact, repeatable guided run. Each stage sends a scripted request in demo mode (no language model, no network),
 * so results are reproducible. Everything is fictional and simulated.
 */
export default function DemoGuide({ done, busy, onRun, onRestart, onClose }: { done: string[]; busy: boolean; onRun: (s: DemoStage) => void; onRestart: () => void; onClose: () => void }) {
  return (
    <section className="demo" aria-label="Security demo">
      <div className="demo-head">
        <div>
          <strong>Security demo</strong>
          <span className="demo-note"> Scripted, synthetic, no real systems.</span>
        </div>
        <div className="row">
          <button type="button" className="btn ghost small" onClick={onRestart}>
            Restart
          </button>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <ol className="demo-stages">
        {DEMO_STAGES.map((s) => (
          <li key={s.id} className={done.includes(s.id) ? "done" : ""}>
            <div>
              <strong>
                {s.id}. {s.title}
              </strong>
              <p>{s.blurb}</p>
            </div>
            <button type="button" className="btn small" disabled={busy} onClick={() => onRun(s)}>
              {done.includes(s.id) ? "Run again" : "Run"}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
