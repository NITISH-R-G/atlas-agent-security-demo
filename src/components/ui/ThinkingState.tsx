"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * THINKING STATE — an expandable activity trace.
 *
 * NOTE: the original supplied ThinkingState source was not available in the repository, so this is a new
 * implementation of the described behavior (Steps / Reasoning / Search / Coding traces, expandable, settles
 * when work finishes). It renders ONLY the steps it is given; callers must derive them from real events.
 * It owns no timers: elapsed time is measured by the caller from real timestamps.
 */

export const THINKING_VARIANTS = ["Steps", "Reasoning", "Search", "Coding"] as const;
export type ThinkingVariant = (typeof THINKING_VARIANTS)[number];

export interface ThinkingStep {
  id: string;
  text: string;
  state: "running" | "done" | "failed";
  /** "search" lines render with a query marker in the Search variant. */
  kind?: "search" | "check" | "tool" | "validate" | "reason";
}

interface Props {
  steps: ThinkingStep[];
  /** True while the agent is still working. Expanded while running, collapsed after completion. */
  running: boolean;
  variant?: ThinkingVariant;
  /** Real elapsed time in ms, shown once finished. Omitted when unknown. */
  elapsedMs?: number;
}

const mark = { running: "…", done: "✓", failed: "!" } as const;

function Line({ step, variant }: { step: ThinkingStep; variant: ThinkingVariant }) {
  if (variant === "Reasoning") {
    return (
      <li className={`tk-line ${step.state}`}>
        <span className="tk-prose">{step.text}</span>
      </li>
    );
  }
  if (variant === "Coding") {
    return (
      <li className={`tk-line code ${step.state}`}>
        <span aria-hidden className="tk-prompt">
          $
        </span>
        <code>{step.text}</code>
        <span className="tk-mark" aria-label={step.state}>
          {mark[step.state]}
        </span>
      </li>
    );
  }
  return (
    <li className={`tk-line ${step.state}${variant === "Search" && step.kind === "search" ? " query" : ""}`}>
      <span className="tk-mark" aria-label={step.state}>
        {variant === "Search" && step.kind === "search" ? "⌕" : mark[step.state]}
      </span>
      <span>{step.text}</span>
    </li>
  );
}

export default function ThinkingState({ steps, running, variant = "Steps", elapsedMs }: Props) {
  const panelId = useId();
  // null = follow the default (open while running, closed when done); true/false = the user chose.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const wasRunning = useRef(running);
  useEffect(() => {
    // A new run starts fresh: forget the user's previous choice so it expands again.
    if (running && !wasRunning.current) setUserOpen(null);
    wasRunning.current = running;
  }, [running]);

  if (steps.length === 0) return null;
  const open = userOpen ?? running;
  const failed = steps.filter((s) => s.state === "failed").length;
  const title = running
    ? steps.at(-1)?.text ?? "Working"
    : `Worked through ${steps.length} step${steps.length === 1 ? "" : "s"}${failed ? ` · ${failed} blocked` : ""}${
        elapsedMs !== undefined ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : ""
      }`;

  return (
    <div className={`tk ${running ? "running" : "settled"}`} data-variant={variant}>
      <button type="button" className="tk-head" aria-expanded={open} aria-controls={panelId} onClick={() => setUserOpen(!open)}>
        <span className={`tk-title${running ? " shimmer" : ""}`}>{title}</span>
        <span aria-hidden className={`tk-chev${open ? " open" : ""}`}>
          ›
        </span>
      </button>
      <div id={panelId} className={`tk-body${open ? " open" : ""}`} hidden={!open}>
        <ol className={`tk-list ${variant.toLowerCase()}`} aria-live={running ? "polite" : "off"}>
          {steps.map((s) => (
            <Line key={s.id} step={s} variant={variant} />
          ))}
        </ol>
      </div>
    </div>
  );
}
