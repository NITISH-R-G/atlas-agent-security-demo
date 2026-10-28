"use client";

import { useEffect, useRef, useState } from "react";

import type { ChatState } from "./chat-state";

export interface Conversation {
  id: string;
  state: ChatState;
  /** Set when the person renames the chat. Otherwise the title comes from the first message. */
  name?: string;
}

const matches = (q: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
export const isNarrow = () => matches("(max-width: 859px)");

export const titleOf = (c: Conversation) => {
  if (c.name) return c.name;
  const first = c.state.messages.find((m) => m.role === "user");
  return first && first.role === "user" ? (first.text.length > 38 ? `${first.text.slice(0, 37)}…` : first.text) : "Untitled chat";
};

/** Real search over this browser tab's conversations: title, your messages and Atlas's replies. */
export function searchable(c: Conversation): string {
  const parts = [titleOf(c)];
  for (const m of c.state.messages) {
    if (m.role === "user") parts.push(m.text);
    else if (m.role === "assistant" && m.answer?.plain) parts.push(m.answer.plain);
  }
  return parts.join("\n").toLowerCase();
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="ico" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  newChat: "M4 16l1-4 8.5-8.5a1.8 1.8 0 012.5 2.5L7.5 14.5 4 16zM12 5l3 3",
  search: "M9 15a6 6 0 100-12 6 6 0 000 12zM17 17l-3.5-3.5",
  explore: "M10 2.5l6 2.5v4.5c0 3.8-2.4 6.6-6 8-3.6-1.4-6-4.2-6-8V5l6-2.5zM7.5 10l2 2 3.5-4",
  panel: "M3.5 4.5h13v11h-13zM8 4.5v11",
  more: "M4.5 10h.01M10 10h.01M15.5 10h.01",
  close: "M5 5l10 10M15 5L5 15",
};

export default function Sidebar({
  open,
  convs,
  activeId,
  exploring,
  query,
  onQuery,
  searchRef,
  onNew,
  onPick,
  onRename,
  onDelete,
  onExplore,
  onClose,
}: {
  open: boolean;
  convs: Conversation[];
  activeId: string;
  exploring: boolean;
  query: string;
  onQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onNew: () => void;
  onPick: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExplore: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // On a phone the sidebar is a drawer: move focus into it when it opens.
  useEffect(() => {
    if (open && isNarrow()) ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  // An open options menu closes on Escape or a click elsewhere, and focus returns to its button.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ref.current?.querySelector<HTMLElement>(`[data-menu-for="${menu}"]`)?.focus();
        setMenu(null);
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.(".hist-menu") && !t.closest?.(".hist-more")) setMenu(null);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menu]);

  const q = query.trim().toLowerCase();
  const shown = [...convs].reverse().filter((c) => !q || searchable(c).includes(q));

  const commit = () => {
    if (renaming && draft.trim()) onRename(renaming, draft.trim().slice(0, 80));
    setRenaming(null);
  };

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
          <Icon d={ICONS.close} />
        </button>
        <button type="button" className="icon-btn side-collapse" aria-label="Collapse sidebar" onClick={onClose}>
          <Icon d={ICONS.panel} />
        </button>
      </div>

      <button type="button" className="side-btn" onClick={onNew}>
        <Icon d={ICONS.newChat} />
        <span>New chat</span>
      </button>

      <div className="search">
        <Icon d={ICONS.search} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              onQuery("");
            }
          }}
        />
        <kbd className="kbd" aria-hidden="true">
          Ctrl K
        </kbd>
      </div>

      <button type="button" className="side-btn" aria-pressed={exploring} onClick={onExplore}>
        <Icon d={ICONS.explore} />
        <span>Explore Security</span>
      </button>

      <nav aria-label="Conversations" className="side-section hist-wrap">
        <p className="side-label" title="Conversations are kept in this browser tab only. Nothing is saved to an account.">
          This session
        </p>
        <ul className="hist">
          {shown.map((c) => {
            const title = titleOf(c);
            return (
              <li key={c.id} className={`hist-row${c.id === activeId && !exploring ? " current" : ""}`}>
                {renaming === c.id ? (
                  <input
                    className="rename"
                    value={draft}
                    autoFocus
                    aria-label={`Rename ${title}`}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="hist-item" aria-current={c.id === activeId && !exploring ? "true" : undefined} onClick={() => onPick(c.id)}>
                    {title}
                  </button>
                )}
                {renaming === c.id ? null : (
                  <button type="button" className="hist-more" data-menu-for={c.id} aria-label={`Options for ${title}`} aria-haspopup="menu" aria-expanded={menu === c.id} onClick={() => setMenu(menu === c.id ? null : c.id)}>
                    <Icon d={ICONS.more} />
                  </button>
                )}
                {menu === c.id ? (
                  <ul className="hist-menu" role="menu" aria-label={`Options for ${title}`}>
                    <li role="none">
                      <button
                        type="button"
                        role="menuitem"
                        autoFocus
                        onClick={() => {
                          setDraft(title);
                          setRenaming(c.id);
                          setMenu(null);
                        }}
                      >
                        Rename
                      </button>
                    </li>
                    <li role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setMenu(null);
                          onDelete(c.id);
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 ? <p className="side-note">No chats match “{query.trim()}”.</p> : null}
        {!q ? <p className="side-note">Kept in this browser tab only.</p> : null}
      </nav>

      <p className="side-foot">Fictional data and simulated actions. Not affiliated with OpenAI.</p>
    </aside>
  );
}
