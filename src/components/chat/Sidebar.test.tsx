import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveRoute } from "@/app/api/approve/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { clearPending } from "@/lib/agent/approvals";
import ChatApp from "./ChatApp";

const jar: { cookie?: string } = {};
function installFetch() {
  jar.cookie = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const req = new Request(`http://localhost${url}`, { method: "POST", body: init.body as string, headers: jar.cookie ? { cookie: jar.cookie } : {} });
      const res = await (url === "/api/chat" ? chatRoute(req) : approveRoute(req));
      const set = res.headers.get("set-cookie");
      if (set) jar.cookie = set.split(";")[0];
      return res;
    }),
  );
}
function narrow(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })),
  );
}

beforeAll(() => {
  process.env.ATLAS_SIMULATED_LATENCY = "0";
});
beforeEach(() => {
  window.localStorage.clear();
  clearPending();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("sidebar and conversation history", () => {
  it("starts with a sidebar containing New chat, search and history, and nothing else", () => {
    render(<ChatApp />);
    const side = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(side).getByRole("button", { name: "New chat" })).toBeTruthy();
    expect(within(side).queryByRole("button", { name: /explore/i })).toBeNull();
    expect(within(side).getByRole("button", { name: "Untitled chat" })).toBeTruthy();
  });

  it("the menu button collapses and restores the sidebar and reports its state", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const menu = screen.getByRole("button", { name: "Hide sidebar" });
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    await user.click(menu);
    expect(screen.getByRole("button", { name: "Show sidebar" }).getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("atlas-sidebar")?.getAttribute("aria-hidden")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(document.getElementById("atlas-sidebar")?.getAttribute("aria-hidden")).toBeNull();
  });

  it("New chat keeps the previous conversation in history and switching restores it", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Find the latest project updates.");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("button", { name: "Find the latest project updates." }).getAttribute("aria-current")).toBe("true"));
    await user.click(screen.getByRole("button", { name: "New chat" }));
    const side = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(side).getByRole("button", { name: "Untitled chat" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How can I help?" })).toBeTruthy();
    await user.click(within(side).getByRole("button", { name: "Find the latest project updates." }));
    expect(screen.queryByRole("heading", { name: "How can I help?" })).toBeNull();
    expect(screen.getAllByText("Find the latest project updates.").length).toBeGreaterThan(0);
  });

  it("an empty conversation is reused instead of stacking blank entries", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getAllByRole("button", { name: "Untitled chat" })).toHaveLength(1);
  });
});

describe("composer keyboard behavior", () => {
  it("Shift+Enter inserts a newline and Enter sends", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    await user.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box.value).toBe("line one\nline two");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(box.value).toBe("");
  });
});

describe("phone layout behavior", () => {
  it("starts with the drawer closed on a narrow viewport and Escape dismisses it", async () => {
    narrow(true);
    const user = userEvent.setup();
    render(<ChatApp />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
  });

  it("choosing an action in the drawer closes it, and Security stays operable in the top bar", async () => {
    narrow(true);
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(await screen.findByRole("button", { name: "Show sidebar" }));
    await user.click(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Security" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await user.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("does not auto-open the evidence sheet over the conversation on a narrow viewport", async () => {
    narrow(true);
    const user = userEvent.setup();
    render(<ChatApp />);
    await screen.findByRole("button", { name: "Show sidebar" });
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Find the latest project updates.");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelector(".msg.assistant")?.getAttribute("data-status")).toBe("done"), { timeout: 4000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy());
    expect(screen.queryByRole("complementary", { name: "Security walkthrough" })).toBeNull();
  });
});
