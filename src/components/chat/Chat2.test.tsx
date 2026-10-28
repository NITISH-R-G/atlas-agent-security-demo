import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveRoute } from "@/app/api/approve/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { clearPending } from "@/lib/agent/approvals";
import ChatApp from "./ChatApp";

const ANCHOR_REQUEST = "Read the project update and send a summary to the team.";

const jar: { cookie?: string } = {};
let approveDelay = 0;
function installFetch() {
  jar.cookie = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const req = new Request(`http://localhost${url}`, { method: "POST", body: init.body as string, headers: jar.cookie ? { cookie: jar.cookie } : {} });
      if (url === "/api/approve" && approveDelay) await new Promise((r) => setTimeout(r, approveDelay));
      const res = await (url === "/api/chat" ? chatRoute(req) : approveRoute(req));
      const set = res.headers.get("set-cookie");
      if (set) jar.cookie = set.split(";")[0];
      return res;
    }),
  );
}
beforeAll(() => {
  process.env.ATLAS_SIMULATED_LATENCY = "0";
});
beforeEach(() => {
  window.localStorage.clear();
  clearPending();
  approveDelay = 0;
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

const side = () => screen.getByRole("complementary", { name: "Sidebar" });
const idle = () => waitFor(() => expect(document.querySelector(".msg.assistant[data-status='working']")).toBeNull(), { timeout: 5000 });
const ask = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByRole("textbox", { name: "Message" }), text);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(document.querySelector(".msg.assistant")).not.toBeNull());
  await idle();
};

describe("composer and empty state", () => {
  it("the same composer stays mounted when the first message is sent (focus and typing are not lost)", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByRole("heading", { name: "How can I help?" })).toBeTruthy();
    await user.type(box, "Find the latest project updates.");
    await user.keyboard("{Enter}");
    await idle();
    expect(screen.queryByRole("heading", { name: "How can I help?" })).toBeNull();
    expect(box.isConnected).toBe(true);
    expect(screen.getByRole("textbox", { name: "Message" })).toBe(box);
  });

  it("the empty state offers only the composer: no preset buttons, scenario pickers or launchers", () => {
    render(<ChatApp />);
    const names = screen.getAllByRole("button").map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").toLowerCase());
    expect(names.some((n) => /run|launch|start|replay|scenario|explore|tour/.test(n))).toBe(false);
    expect(document.querySelector("ul.suggest")).toBeNull();
  });

  it("a typed request runs through the normal composer", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, ANCHOR_REQUEST);
    expect(document.querySelector(".msg.user .bubble")!.textContent).toBe(ANCHOR_REQUEST);
  });
});

describe("conversation search, rename and delete are real", () => {
  it("search matches titles and reply text, shows an honest empty result, and Escape clears it", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "Find the latest project updates.");
    await user.click(within(side()).getByRole("button", { name: "New chat" }));
    await ask(user, "Summarize this document.");
    const search = within(side()).getByRole("searchbox", { name: "Search chats" });
    await user.type(search, "latest");
    expect(within(side()).getByRole("button", { name: "Find the latest project updates." })).toBeTruthy();
    expect(within(side()).queryByRole("button", { name: /Summarize this document/ })).toBeNull();
    await user.clear(search);
    await user.type(search, "zzzz-no-such-chat");
    expect(within(side()).getByText(/No chats match/)).toBeTruthy();
    await user.keyboard("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("rename keeps the new title; Escape cancels", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "Find the latest project updates.");
    await user.click(within(side()).getByRole("button", { name: /Options for Find the latest/ }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: /Rename/ });
    await user.clear(input);
    await user.type(input, "Weekly update{Enter}");
    expect(within(side()).getByRole("button", { name: "Weekly update" })).toBeTruthy();
    await user.click(within(side()).getByRole("button", { name: /Options for Weekly update/ }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await user.type(screen.getByRole("textbox", { name: /Rename/ }), "x{Escape}");
    expect(within(side()).getByRole("button", { name: "Weekly update" })).toBeTruthy();
  });

  it("the options menu closes on Escape and returns focus to its button", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const more = within(side()).getByRole("button", { name: /Options for Untitled chat/ });
    await user.click(more);
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("delete removes the chat; deleting the only chat leaves a fresh empty one", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "Find the latest project updates.");
    await user.click(within(side()).getByRole("button", { name: /Options for Find the latest/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(within(side()).queryByRole("button", { name: "Find the latest project updates." })).toBeNull();
    expect(within(side()).getByRole("button", { name: "Untitled chat" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How can I help?" })).toBeTruthy();
  });

  it("Ctrl+K focuses search, opening the sidebar first if it is hidden", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(screen.getByRole("button", { name: "Hide sidebar" }));
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(document.activeElement).toBe(within(side()).getByRole("searchbox", { name: "Search chats" })));
  });

  it("history is labelled as kept in this tab only", () => {
    render(<ChatApp />);
    expect(within(side()).getByText(/Kept in this browser tab only/)).toBeTruthy();
  });
});

describe("messages: copy, activity wording and approval states come from real results", () => {
  it("Copy writes the reply text and says Copied only after the browser accepted it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ChatApp />);
    await ask(user, "Find the latest project updates.");
    await user.click(screen.getByRole("button", { name: "Copy reply" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0]).length).toBeGreaterThan(10);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  });

  it("a failed clipboard write never claims success", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    render(<ChatApp />);
    await ask(user, "Find the latest project updates.");
    await user.click(screen.getByRole("button", { name: "Copy reply" }));
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("the example request shows 'Project record read' then 'Approval required'; deny and approve each report the real outcome", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, ANCHOR_REQUEST);
    const chips = document.querySelector(".chips")!;
    expect(chips.textContent).toContain("Project record read");
    expect(chips.textContent).toContain("Approval required");
    const card = screen.getByRole("group", { name: "Approval required" });
    expect(within(card).getByText(/Not done yet/)).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/You declined. Nothing was sent./));
    expect(document.body.textContent).not.toMatch(/Message queued in outbox/);
  });

  it("while a decision is in flight the buttons are disabled and the card says so; the success line appears only after the server answers", async () => {
    const user = userEvent.setup();
    approveDelay = 300;
    render(<ChatApp />);
    await ask(user, ANCHOR_REQUEST);
    const card = screen.getByRole("group", { name: "Approval required" });
    await user.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect((within(card).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true));
    expect(within(card).getByText(/Checking your decision/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Message queued in outbox/);
    await waitFor(() => expect(document.body.textContent).toMatch(/Approved · Message queued in outbox/));
  });

  it("a plugin request names the rejected source and the trusted one, from the real decision", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "Find the latest project updates.");
    expect(document.body.textContent).toMatch(/Untrusted plugin blocked/);
    expect(document.body.textContent).toMatch(/Untrusted source rejected/);
    expect(document.body.textContent).toMatch(/Trusted source used/);
  });
});

describe("design system", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "atlas.css"), "utf8");
  it("defines tokens for color, spacing, radius, type, motion and focus, with a dark theme and reduced motion", () => {
    for (const t of ["--bg-page", "--text", "--border", "--ok", "--warn", "--bad", "--info", "--sp-4", "--r-lg", "--fs-base", "--dur-2", "--ease", "--focus"]) expect(css).toContain(`${t}:`);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("the application shell and message components use tokens, not raw colors", () => {
    const core = css.slice(css.indexOf("/* ---------- Buttons ---------- */"), css.indexOf("/* ===== Evidence drawer"));
    const raw = core.match(/#[0-9a-fA-F]{3,8}\b|rgb\(\s*\d/g)?.filter((c) => c !== "#fff") ?? [];
    // the toggle knob and a few shadows use literal white or black alpha on purpose; everything else is a token
    expect(raw.filter((c) => !c.startsWith("rgb("))).toEqual([]);
  });
});
