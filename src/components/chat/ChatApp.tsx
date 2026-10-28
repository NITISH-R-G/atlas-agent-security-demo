"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sendApproval, streamChat } from "@/lib/agent/client";
import { chatReducer, initialChat, type AssistantMessage, type ChatAction } from "./chat-state";
import { MessageList } from "./Messages";
import Sidebar, { isNarrow, type Conversation } from "./Sidebar";
import Walkthrough from "./Walkthrough";

/** The Security setting is remembered in this browser. A fresh browser starts with it on. */
export const SECURITY_KEY = "atlas.security";
const readSecurity = (): boolean => {
  try {
    return window.localStorage.getItem(SECURITY_KEY) !== "off";
  } catch {
    return true;
  }
};

const uid = () => Math.random().toString(36).slice(2, 10);

export default function ChatApp() {
  const [firstId] = useState(uid);
  const [convs, setConvs] = useState<Conversation[]>(() => [{ id: firstId, state: initialChat }]);
  const [activeId, setActiveId] = useState(firstId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [security, setSecurity] = useState(true);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<{ open: boolean; messageId?: string }>({ open: false });
  const [deciding, setDeciding] = useState<ReadonlySet<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const chatConvs = convs;
  const active = chatConvs.find((c) => c.id === activeId) ?? chatConvs[0];
  const state = active.state;
  const dispatchTo = useCallback((cid: string, action: ChatAction) => setConvs((all) => all.map((c) => (c.id === cid ? { ...c, state: chatReducer(c.state, action) } : c))), []);

  const working = convs.some((c) => c.state.messages.some((m) => m.role === "assistant" && m.status === "working"));

  useEffect(() => {
    // Viewport is only known after hydration: start with the drawer closed on phones (server renders it open).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isNarrow()) setSidebarOpen(false);
    setSecurity(readSecurity());
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
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  // Ctrl or Cmd + K opens search, like the chat products people already know.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSidebarOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 30);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeIfNarrow = () => {
    if (isNarrow()) setSidebarOpen(false);
  };

  /** Sends one request through the real server and resolves when the reply has finished. Returns the assistant message id. */
  const send = useCallback(
    async (raw: string, opts: { security?: boolean } = {}): Promise<string | undefined> => {
      const message = raw.trim();
      if (!message || working) return undefined;
      const mode = opts.security ?? security;
      const cid = activeId;
      // Recent plain-text turns only; tool results are never resent, and the server re-validates everything.
      const history: { role: "user" | "assistant"; content: string }[] = [];
      for (const m of state.messages) {
        if (m.role === "user") history.push({ role: "user", content: m.text.slice(0, 1500) });
        else if (m.role === "assistant" && m.answer?.plain) history.push({ role: "assistant", content: m.answer.plain.slice(0, 1500) });
      }
      history.splice(0, Math.max(0, history.length - 10));
      const assistantId = uid();
      const ctl = new AbortController();
      abortRef.current = ctl;
      dispatchTo(cid, { type: "send", userId: uid(), assistantId, text: message, security: mode, now: Date.now() });
      setText("");
      const result = await streamChat({ message, security: mode, history }, { signal: ctl.signal, onEvent: (event) => dispatchTo(cid, { type: "event", id: assistantId, event }) });
      if (abortRef.current === ctl) abortRef.current = null;
      if (result.ok) dispatchTo(cid, { type: "end", id: assistantId, status: "done", now: Date.now() });
      else if (result.code === "cancelled") dispatchTo(cid, { type: "end", id: assistantId, status: "stopped", now: Date.now() });
      else dispatchTo(cid, { type: "end", id: assistantId, status: "error", error: result.message, now: Date.now() });
      setPanel((p) => (p.open ? { open: true, messageId: assistantId } : p));
      return assistantId;
    },
    [security, working, state.messages, activeId, dispatchTo],
  );

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    abortRef.current?.abort();
    setPanel((p) => ({ open: p.open }));
    setText("");
    setQuery("");
    // An empty conversation is reused instead of stacking blank entries in the history.
    if (state.messages.length === 0) dispatchTo(active.id, { type: "clear" });
    else {
      const id = uid();
      setConvs((all) => [...all, { id, state: initialChat }]);
      setActiveId(id);
    }
    closeIfNarrow();
    window.setTimeout(() => taRef.current?.focus(), 30);
  };

  const pick = (id: string) => {
    if (id !== activeId) {
      setActiveId(id);
      setPanel((p) => ({ open: p.open }));
    }
    closeIfNarrow();
  };

  const rename = (id: string, name: string) => setConvs((all) => all.map((c) => (c.id === id ? { ...c, name } : c)));

  const remove = (id: string) => {
    if (id === activeId) abortRef.current?.abort();
    const left = convs.filter((c) => c.id !== id);
    if (left.length === 0) {
      const fresh = uid();
      setConvs([{ id: fresh, state: initialChat }]);
      setActiveId(fresh);
    } else {
      setConvs((all) => all.filter((c) => c.id !== id));
      if (id === activeId) setActiveId(left[left.length - 1].id);
    }
    setPanel((p) => ({ open: p.open }));
  };

  const toggleSecurity = () => {
    const next = !security;
    setSecurity(next);
    try {
      window.localStorage.setItem(SECURITY_KEY, next ? "on" : "off");
    } catch {
      /* the setting still applies to this page */
    }
    if (active.state.messages.length > 0) dispatchTo(active.id, { type: "mode", id: uid(), security: next });
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
    setDeciding((s) => new Set(s).add(callId));
    const r = await sendApproval(callId, approve, owner.approvals.find((a) => a.callId === callId)?.ticket);
    resolving.current.delete(callId);
    setDeciding((s) => {
      const n = new Set(s);
      n.delete(callId);
      return n;
    });
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

  const composer = (
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
          <span aria-hidden="true" className="stop-ico" />
        </button>
      ) : (
        <button type="submit" className="send" disabled={!text.trim()} aria-label="Send message">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 16V4M5 9l5-5 5 5" />
          </svg>
        </button>
      )}
    </form>
  );

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
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        onNew={newChat}
        onPick={pick}
        onRename={rename}
        onDelete={remove}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen ? <div className="scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="shell" data-empty={empty ? "true" : undefined}>
        <header className="bar">
          <div className="who">
            <button type="button" className="icon-btn menu" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-expanded={sidebarOpen} aria-controls="atlas-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <svg className="ico" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M3.5 6h13M3.5 10h9M3.5 14h13" />
              </svg>
            </button>
            <span className="name">Atlas assistant</span>
            <span className={`dot${working ? " busy" : ""}`} aria-hidden="true" />
            <span className="state">{working ? "Working" : "Ready"}</span>
          </div>
          <div className="right">
            <div className="sec">
              <span className={`mode ${security ? "on" : "off"}`} aria-live="polite">
                <span className="mode-ico" aria-hidden="true">
                  {security ? "✓" : "!"}
                </span>
                {security ? "Security on" : "Security off"}
              </span>
              <button type="button" role="switch" aria-checked={security} aria-label="Security" aria-describedby="security-help" className={`switch${security ? " on" : ""}`} onClick={toggleSecurity}>
                <span className="knob" />
              </button>
              <span id="security-help" className="sr-only">
                When on, the server checks who is signed in and where each tool comes from before it acts. When off, those checks are not applied.
              </span>
            </div>
          </div>
        </header>

        <main className={empty ? "hero" : "thread"} aria-label="Conversation">
            {empty ? (
              <>
                <h1>How can I help?</h1>
              </>
            ) : (
              <div className="log">
                <MessageList messages={state.messages} deciding={deciding} onDecide={(callId, approve) => void decide(active.id, callId, approve)} onEvidence={openEvidence} />
                <div ref={endRef} />
              </div>
            )}
        </main>
        <div className="dock">
            {composer}
            <p className="fineprint">Atlas can make mistakes. Check important information.</p>
          </div>
      </div>

      {panel.open ? <Walkthrough message={evidenceMessage} onClose={() => setPanel({ open: false })} /> : null}
    </div>
  );
}
