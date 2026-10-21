import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LoadingState, { LOADING_VARIANTS, formatElapsed } from "./LoadingState";
import ThinkingState, { THINKING_VARIANTS, type ThinkingStep } from "./ThinkingState";

afterEach(() => vi.useRealTimers());

describe("LoadingState", () => {
  it.each(LOADING_VARIANTS)("renders the %s variant with a status role, label and timer", (variant) => {
    render(<LoadingState variant={variant} label="Fetching" />);
    const s = screen.getByRole("status");
    expect(s.textContent).toContain("Fetching");
    expect(s.textContent).toMatch(/0\.0s/);
    expect(s.querySelectorAll(".bu-cell").length).toBe(9);
  });

  it("circular cells for Dots, square for Drive, and the orbit leaves the centre cell dim", () => {
    const { container, rerender } = render(<LoadingState variant="Dots" />);
    expect(container.querySelectorAll(".bu-cell.round").length).toBe(9);
    rerender(<LoadingState variant="Drive" />);
    expect(container.querySelectorAll(".bu-cell.round").length).toBe(0);
    rerender(<LoadingState variant="Orbit" />);
    expect(container.querySelectorAll<HTMLElement>(".bu-cell")[4].style.animation).toBe("none");
  });

  it("falls back to Drive for an unknown variant and uses a default label", () => {
    render(<LoadingState variant="Nope" />);
    expect(screen.getByRole("status").textContent).toContain("Working");
  });

  it("ticks a real elapsed timer and clears it on unmount", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<LoadingState />);
    act(() => void vi.advanceTimersByTime(2500));
    expect(screen.getByRole("status").textContent).toContain("2.5s");
    unmount();
    expect(clear).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("formats minutes", () => {
    expect(formatElapsed(615)).toBe("1m 1.5s");
  });

  it("Surfer shows a video, and a fallback if it cannot load", () => {
    const { container } = render(<LoadingState variant="Surfer" videoSrc="/x.mp4" />);
    const v = container.querySelector("video")!;
    expect(v.getAttribute("src")).toBe("/x.mp4");
    fireEvent.error(v);
    expect(screen.getByText("Video unavailable")).toBeTruthy();
  });
});

const steps: ThinkingStep[] = [
  { id: "1", text: "Searching the knowledge base", state: "done", kind: "search" },
  { id: "2", text: "Checking a document", state: "running", kind: "check" },
  { id: "3", text: "Validating a request", state: "failed", kind: "validate" },
];

describe("ThinkingState", () => {
  it("renders nothing without real steps", () => {
    const { container } = render(<ThinkingState steps={[]} running />);
    expect(container.firstChild).toBeNull();
  });

  it.each(THINKING_VARIANTS)("shows exactly the given steps in the %s variant", (variant) => {
    const { container } = render(<ThinkingState steps={steps} running variant={variant} />);
    expect(container.querySelectorAll(".tk-line").length).toBe(3);
    expect(container.textContent).toContain("Searching the knowledge base");
    expect(container.querySelector(".tk-list")!.className).toContain(variant.toLowerCase());
  });

  it("is open while running and settles collapsed when finished, with a truthful summary", () => {
    const { rerender } = render(<ThinkingState steps={steps} running />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    rerender(<ThinkingState steps={steps} running={false} elapsedMs={1840} />);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.textContent).toContain("Worked through 3 steps");
    expect(b.textContent).toContain("1 blocked");
    expect(b.textContent).toContain("1.8s");
    expect(document.querySelector(".tk-body")!.hasAttribute("hidden")).toBe(true);
  });

  it("can be expanded by the user and keeps that choice", () => {
    render(<ThinkingState steps={steps} running={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".tk-body")!.hasAttribute("hidden")).toBe(false);
  });

  it("omits elapsed time when unknown rather than inventing it", () => {
    render(<ThinkingState steps={steps} running={false} />);
    expect(screen.getByRole("button").textContent).not.toMatch(/\d+\.\ds/);
  });

  it("shows the latest real step as the title while running", () => {
    render(<ThinkingState steps={steps} running />);
    expect(screen.getByRole("button").textContent).toContain("Validating a request");
  });
});
