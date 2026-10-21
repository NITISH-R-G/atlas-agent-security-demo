"use client";

import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Ported from the supplied Beautiful UI source with its API preserved
 * (label, variant, videoSrc). Tailwind utilities became plain classes in
 * chat.css; the cell patterns, timings and timer are unchanged.
 *
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 *   Surfer — the Drive loader paired with a video below (loads a remote
 *            file only when this variant is used)
 *
 * The elapsed timer starts when the component mounts, so mount it only
 * while the operation is actually running. Reduced motion freezes the grid
 * (see chat.css); the timer still ticks and is cleared on unmount.
 * ───────────────────────────────────────────────────────── */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3),
    c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

export const LOADING_VARIANTS = ["Drive", "Dots", "Orbit", "Surfer"] as const;
export type LoadingVariant = (typeof LOADING_VARIANTS)[number];

const PATTERNS: Record<string, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

function LoaderGrid({ delays, dur, round }: { delays: (number | null)[]; dur: number; round: boolean }) {
  return (
    <span aria-hidden className="bu-grid">
      {delays.map((delay, index) => (
        <span
          key={index}
          className={`bu-cell${round ? " round" : ""}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function formatElapsed(ds: number) {
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

function useElapsed() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  return formatElapsed(ds);
}

export default function LoadingState({
  label,
  variant = "Drive",
  videoSrc = "https://95dnc2a95qgwt9ff.public.blob.vercel-storage.com/subway-surfers-min.mp4",
}: {
  label?: string;
  variant?: string;
  videoSrc?: string;
}) {
  const elapsed = useElapsed();
  const surfer = variant === "Surfer";
  const resolvedLabel = label ?? (surfer ? "Subway surfing" : "Working");
  const [videoOk, setVideoOk] = useState(true);
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive;

  const labelEl = <span className="bu-label">{resolvedLabel}</span>;
  const elapsedEl = <span className="bu-elapsed">{elapsed}</span>;

  if (surfer) {
    return (
      <div role="status" className="bu-loading surfer">
        <div className="bu-row">
          <LoaderGrid {...PATTERNS.Drive} />
          {labelEl}
          {elapsedEl}
        </div>
        <div className="bu-video">
          <div className="bu-video-frame">
            {videoOk ? (
              <video src={videoSrc} autoPlay muted loop playsInline onError={() => setVideoOk(false)} />
            ) : (
              <div className="bu-video-fallback">
                <LoaderGrid {...PATTERNS.Drive} />
                <span>Video unavailable</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="bu-loading">
      <div className="bu-row">
        <LoaderGrid delays={delays} dur={dur} round={round} />
        {labelEl}
        {elapsedEl}
      </div>
    </div>
  );
}
