"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * A small guided tour. It highlights real elements (found by selector at the moment each step is shown), dims the rest
 * of the page lightly, and never blocks the page: the overlay ignores pointer events, Escape or Skip always exits, and
 * focus returns to where it was. Steps whose target does not exist are skipped, so the tour never describes something
 * that is not on screen.
 */
export interface TourStep {
  target: string;
  title: string;
  text: string;
}

const PAD = 6;
const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const titleId = useId();
  const [available, setAvailable] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardPos, setCardPos] = useState<{ top?: number; bottom?: number; left: number; width: number }>({ left: 8, width: 320, bottom: 8 });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  // Decide which steps can be shown right now.
  useEffect(() => {
    opener.current = document.activeElement;
    const found = steps.filter((s) => document.querySelector(s.target));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailable(found);
    if (found.length === 0) onClose();
    return () => {
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = available[index];

  const measure = useCallback(() => {
    const el = step ? document.querySelector(step.target) : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardH = cardRef.current?.offsetHeight ?? 150;
    const width = Math.min(340, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const below = r.bottom + PAD + 10;
    const above = r.top - PAD - 10 - cardH;
    if (below + cardH <= vh - 8) setCardPos({ top: below, left, width });
    else if (above >= 8) setCardPos({ top: above, left, width });
    else setCardPos({ bottom: 8, left: Math.max(8, (vw - width) / 2), width });
  }, [step]);

  // Bring the target into view, then keep the highlight attached through scrolling and resizing.
  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    el?.scrollIntoView?.({ block: "center", behavior: reduced() ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
    let raf = 0;
    const again = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const settle = window.setTimeout(again, reduced() ? 0 : 380);
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    const obs = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(again) : null;
    if (el) obs?.observe(el);
    return () => {
      window.clearTimeout(settle);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
      obs?.disconnect();
    };
  }, [step, measure]);

  useEffect(() => {
    if (step) nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  const last = index === available.length - 1;
  const go = useCallback(
    (d: number) => {
      setIndex((i) => Math.max(0, Math.min(available.length - 1, i + d)));
    },
    [available.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!step) return null;
  return (
    <div className="tour" data-reduced={reduced() ? "true" : undefined}>
      {box ? <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden="true" /> : null}
      <div ref={cardRef} className="tour-card" role="dialog" aria-modal="false" aria-labelledby={titleId} style={cardPos}>
        <p className="tour-count">
          {index + 1} / {available.length}
        </p>
        <div aria-live="polite">
          <h3 id={titleId}>{step.title}</h3>
          <p>{step.text}</p>
        </div>
        <div className="tour-actions">
          <button type="button" className="btn ghost small" onClick={onClose}>
            Skip
          </button>
          <span className="tour-spacer" />
          <button type="button" className="btn small" onClick={() => go(-1)} disabled={index === 0}>
            Back
          </button>
          <button ref={nextRef} type="button" className="btn solid small" onClick={() => (last ? onClose() : go(1))}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
