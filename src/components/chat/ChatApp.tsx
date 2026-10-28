"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sendApproval, streamChat } from "@/lib/agent/client";
import { chatReducer, initialChat, type AssistantMessage, type ChatAction, type ChatState } from "./chat-state";
import { DEMO_STAGES, type DemoStage } from "./DemoGuide";
import ExploreSecurity from "./ExploreSecurity";
import { MessageList } from "./Messages";
import Walkthrough from "./Walkthrough";

export const ANCHOR_REQUEST = "Read the project update and send a summary to the team.";

export const SUGGESTIONS = [
  ANCHOR_REQUEST,
  "Find the latest project updates.",
  "Review my project files and suggest improvements.",
  "Summarize this document.",
  "Prepare a report from these notes.",
];

const uid = () => Math.random().toString(36).slice(2, 10);
const EXPLORE_ID = "explore";

interface Conversation {
  id: string;
  state: ChatState;
}

const matches = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
const isNarrow = () => matches("(max-width: 859px)");

const titleOf = (c: Conversation) => {
  const first = c.state.messages.find((m) => m.role === "user");
  return first && first.role === "user" ? (first.text.length > 38 ? `${first.text.slice(0, 37)}…` : first.text) : "Untitled chat";
};

function Sidebar({
  open,
  convs,
  activeId,
  exploring,
  onNew,
  onPick,
  onExplore,
  onClose,
}: {
  open: boolean;
  convs: Conversation[];
  activeId: string;
  exploring: boolean;
  onNew: () => void;
  onPick: (id: string) => void;
  onExplore: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // On a phone the sidebar is a drawer: move focus into it when it opens, and let Escape dismiss it.
  useEffect(() => {
    if (open && isNarrow()) ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);
  return (
    <aside ref={ref} className="side" id="atlas-sidebar" aria-label="Sidebar" data-open={open} aria-hidden={open ? undefined : true} inert={!open}>
      <div className="side-top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            A
          </span>
          <span className="name">Atlas</span>
        </div>
        <button type="button" className="icon-btn side-close" aria-label="Close sidebar" onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <button type="button" className="newchat" onClick={onNew}>
        <span aria-hidden="true">＋</span> New chat
      </button>
      <nav aria-label="Conversations" className="side-section">
        <p className="side-label">Recent</p>
        <ul className="hist">
          {[...convs].reverse().map((c) => (
            <li key={c.id}>
              <button type="button" className="hist-item" aria-current={c.id === activeId && !exploring ? "true" : undefined} onClick={() => onPick(c.id)}>
                {titleOf(c)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="side-section side-tools">
        <button type="button" className="side-btn" aria-pressed={exploring} onClick={onExplore}>
          <span aria-hidden="true">◈</span> Explore Security
        </button>
      </div>
      <p className="side-foot">A ChatGPT-inspired agent interface for exploring server-side AI security. Fictional data only. Not affiliated with OpenAI.</p>
    </aside>
  );
}

export default function ChatApp() {
  const [firstId] = useState(uid);
  const [convs, setConvs] = useState<Conversation[]>(() => [
    { id: firstId, state: initialChat },
    { id: EXPLORE_ID, state: initialChat },
  ]);
  const [activeId, setActiveId] = useState(firstId);
  const [view, setView] = useState<"chat" | "explore">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [security, setSecurity] = useState(false);
  const [text, setText] = useState("");
  const [panel, setPanel] = useState<{ open: boolean; messageId?: string }>({ open: false });
  const [stageRuns, setStageRuns] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const chatConvs = convs.filter((c) => c.id !== EXPLORE_ID);
  const explore = convs.find((c) => c.id === EXPLORE_ID)!;
  const active = chatConvs.find((c) => c.id === activeId) ?? chatConvs[0];
  const state = active.state;
  const dispatchTo = useCallback((cid: string, action: ChatAction) => setConvs((all) => all.map((c) => (c.id === cid ? { ...c, state: chatReducer(c.state, action) } : c))), []);

  const working = convs.some((c) => c.state.messages.some((m) => m.role === "assistant" && m.status === "working"));

  useEffect(() => {
    // Viewport is only known after hydration: start with the drawer closed on phones (server renders it open).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isNarrow()) setSidebarOpen(false);
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [state]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    // An empty box never needs a measured height; clearing it avoids a stale tall box if the first measure ran before layout settled.
    if (text === "") {
      ta.style.height = "";
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [text]);

  const closeIfNarrow = () => {
    if (isNarrow()) setSidebarOpen(false);
  };

  /** Sends one request through the real server and resolves when the reply has finished. Returns the assistant message id. */
  const send = useCallback(
    async (raw: string, opts: { security?: boolean; demo?: boolean; fault?: "authz"; cid?: string; stage?: string } = {}): Promise<string | undefined> => {
      const message = raw.trim();
      if (!message || working) return undefined;
      const mode = opts.security ?? security;
      const cid = opts.cid ?? activeId;
      // Recent plain-text turns only; tool results are never resent, and the server re-validates everything.
      const history: { role: "user" | "assistant"; content: string }[] = [];
      if (cid !== EXPLORE_ID) {
        for (const m of state.messages) {
          if (m.role === "user") history.push({ role: "user", content: m.text.slice(0, 1500) });
          else if (m.role === "assistant" && m.answer?.plain) history.push({ role: "assistant", content: m.answer.plain.slice(0, 1500) });
        }
        history.splice(0, Math.max(0, history.length - 10));
      }
      const assistantId = uid();
      const ctl = new AbortController();
      abortRef.current = ctl;
      dispatchTo(cid, { type: "send", userId: uid(), assistantId, text: message, security: mode, now: Date.now() });
      if (opts.stage) setStageRuns((r) => ({ ...r, [opts.stage as string]: assistantId }));
      setText("");
      const result = await streamChat({ message, security: mode, history, demo: opts.demo, fault: opts.fault }, { signal: ctl.signal, onEvent: (event) => dispatchTo(cid, { type: "event", id: assistantId, event }) });
      if (abortRef.current === ctl) abortRef.current = null;
      if (result.ok) dispatchTo(cid, { type: "end", id: assistantId, status: "done", now: Date.now() });
      else if (result.code === "cancelled") dispatchTo(cid, { type: "end", id: assistantId, status: "stopped", now: Date.now() });
      else dispatchTo(cid, { type: "end", id: assistantId, status: "error", error: result.message, now: Date.now() });
      setPanel((p) => (p.open ? { open: true, messageId: assistantId } : p));
      return assistantId;
    },
    [security, working, state.messages, activeId, dispatchTo],
  );

  const runStage = async (s: DemoStage) => {
    setSecurity(s.security);
    await send(s.message, { security: s.security, demo: true, fault: s.fault, cid: EXPLORE_ID, stage: s.id });
  };

  /** Gives the tour real things to point at: a blocked request and a pending approval, both produced by the real server. */
  const prepareTour = async () => {
    const hasBlocked = explore.state.messages.some((m) => m.role === "assistant" && m.tools.some((t) => t.status === "blocked"));
    const hasPending = explore.state.messages.some((m) => m.role === "assistant" && m.approvals.some((a) => a.state === "pending"));
    if (!hasBlocked) await runStage(DEMO_STAGES[1]);
    if (!hasPending) await runStage(DEMO_STAGES[2]);
  };

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    abortRef.current?.abort();
    setView("chat");
    setPanel((p) => ({ open: p.open }));
    setText("");
    // An empty conversation is reused instead of stacking blank entries in the history.
    if (state.messages.length === 0) dispatchTo(active.id, { type: "clear" });
    else {
      const id = uid();
      setConvs((all) => [...all.filter((c) => c.id !== EXPLORE_ID), { id, state: initialChat }, all.find((c) => c.id === EXPLORE_ID)!]);
      setActiveId(id);
    }
    closeIfNarrow();
    taRef.current?.focus();
  };

  const pick = (id: string) => {
    setView("chat");
    if (id !== activeId) {
      setActiveId(id);
      setPanel((p) => ({ open: p.open }));
    }
    closeIfNarrow();
  };

  const toggleSecurity = () => {
    const next = !security;
    setSecurity(next);
    const cid = view === "explore" ? EXPLORE_ID : active.id;
    const target = convs.find((c) => c.id === cid)!;
    if (target.state.messages.length > 0) dispatchTo(cid, { type: "mode", id: uid(), security: next });
  };

  const resolving = useRef(new Set<string>());
  const decide = async (cid: string, callId: string, approve: boolean) => {
    if (resolving.current.has(callId)) return; // repeated clicks while a decision is in flight are ignored
    resolving.current.add(callId);
    const owner = convs.find((c) => c.id === cid)?.state.messages.find((m) => m.role === "assistant" && m.approvals.some((a) => a.callId === callId));
    if (!owner || owner.role !== "assistant") {
      resolving.current.delete(callId);
      return;
    }
    const r = await sendApproval(callId, approve, owner.approvals.find((a) => a.callId === callId)?.ticket);
    resolving.current.delete(callId);
    dispatchTo(cid, {
      type: "approval",
      id: owner.id,
      callId,
      result: r.ok ? (r.decision === "approved" ? { decision: "approved", view: r.view, audit: r.audit } : { decision: "denied", audit: r.audit }) : { decision: "failed", error: r.message },
    });
  };

  const openEvidence = (id: string) => setPanel({ open: true, messageId: id });
  const evidenceMessage = (() => {
    const all = convs.flatMap((c) => c.state.messages).filter((m): m is AssistantMessage => m.role === "assistant");
    return all.find((m) => m.id === panel.messageId) ?? all.at(-1);
  })();

  const empty = state.messages.length === 0;
  const exploring = view === "explore";

  return (
    <div
      className={`app${sidebarOpen ? " side-open" : ""}${panel.open ? " wt-open" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && sidebarOpen && isNarrow()) setSidebarOpen(false);
      }}
    >
      <Sidebar
        open={sidebarOpen}
        convs={chatConvs}
        activeId={active.id}
        exploring={exploring}
        onNew={newChat}
        onPick={pick}
        onExplore={() => {
          setView(exploring ? "chat" : "explore");
          closeIfNarrow();
        }}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen ? <div className="scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="shell">
        <header className="bar">
          <div className="who">
            <button type="button" className="icon-btn menu" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-expanded={sidebarOpen} aria-controls="atlas-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <span aria-hidden="true">☰</span>
            </button>
            <span className="name">Atlas assistant</span>
            <span className={`dot${working ? " busy" : ""}`} aria-hidden="true" />
            <span className="state">{working ? "Working" : "Ready"}</span>
          </div>
          <div className="right">
            <div className="sec" data-tour="security">
              <span className={`mode ${security ? "on" : "off"}`} aria-live="polite">
                <span className="mode-ico" aria-hidden="true">
                  {security ? "✓" : "!"}
                </span>
                {security ? "Protected" : "Unprotected"}
              </span>
              <button type="button" role="switch" aria-checked={security} aria-label="Security" className={`switch${security ? " on" : ""}`} onClick={toggleSecurity}>
                <span className="knob" />
              </button>
            </div>
          </div>
        </header>

        {exploring ? (
          <main className="thread" aria-label="Explore Security">
            <ExploreSecurity
              messages={explore.state.messages}
              stageRuns={stageRuns}
              busy={working}
              onRun={runStage}
              onDecide={(callId, approve) => void decide(EXPLORE_ID, callId, approve)}
              onEvidence={openEvidence}
              onBack={() => setView("chat")}
              startTour={prepareTour}
            />
          </main>
        ) : (
          <>
            <main className="thread" aria-label="Conversation">
              {empty ? (
                <div className="empty">
                  <div className="logo big" aria-hidden="true">
                    A
                  </div>
                  <h1>How can I help?</h1>
                  <p>The AI suggests. Atlas checks. The action is allowed, held for approval, or blocked. Try the first request below, or open Explore Security.</p>
                  <ul className="suggest">
                    {SUGGESTIONS.map((s) => (
                      <li key={s}>
                        <button type="button" onClick={() => send(s)}>
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="log">
                  <MessageList messages={state.messages} onDecide={(callId, approve) => void decide(active.id, callId, approve)} onEvidence={openEvidence} />
                  <div ref={endRef} />
                </div>
              )}
            </main>

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <textarea
                ref={taRef}
                rows={1}
                value={text}
                placeholder="Message Atlas"
                aria-label="Message"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(text);
                  }
                }}
              />
              {working ? (
                <button type="button" className="send stop" onClick={stop} aria-label="Stop generating">
                  ■
                </button>
              ) : (
                <button type="submit" className="send" disabled={!text.trim()} aria-label="Send message">
                  ↑
                </button>
              )}
            </form>
            <p className="fineprint">
              Atlas runs on fictional data and simulated actions.{" "}
              <button type="button" className="linkish" onClick={() => setView("explore")}>
                Explore Security
              </button>
            </p>
          </>
        )}
      </div>

      {panel.open ? <Walkthrough message={evidenceMessage} onClose={() => setPanel({ open: false })} /> : null}
    </div>
  );
}
