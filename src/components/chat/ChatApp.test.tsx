import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as chatRoute } from "@/app/api/chat/route";
import { POST as approveRoute } from "@/app/api/approve/route";
import { clearPending } from "@/lib/agent/approvals";
import { chatReducer, initialChat } from "./chat-state";
import ChatApp, { SUGGESTIONS } from "./ChatApp";

/** Routes the browser's fetch calls to the real server handlers, in-process. */
const jar: { cookie?: string } = {};
function installFetch(spy?: (url: string, body: unknown) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      spy?.(url, body);
      const req = new Request(`http://localhost${url}`, { method: "POST", body: init.body as string, headers: jar.cookie ? { cookie: jar.cookie } : {} });
      const res = await (url === "/api/chat" ? chatRoute(req) : approveRoute(req));
      // behave like a browser: keep the session cookie the server sets
      const set = res.headers.get("set-cookie");
      if (set) jar.cookie = set.split(";")[0];
      return res;
    }),
  );
}

beforeAll(() => {
  process.env.ATLAS_SIMULATED_LATENCY = "0";
  delete process.env.THESYS_API_KEY;
});
beforeEach(() => {
  clearPending();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

const sw = () => screen.getByRole("switch", { name: "Security" });
const ask = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText("Message"), text);
  await user.keyboard("{Enter}");
};
const lastAssistant = () => [...document.querySelectorAll<HTMLElement>(".msg.assistant")].at(-1)!;
const settled = () => waitFor(() => expect(lastAssistant().getAttribute("data-status")).not.toBe("working"), { timeout: 4000 });

describe("shell", () => {
  it("looks like an assistant: name, status, one prominent security switch, suggestions, no security dashboard", () => {
    render(<ChatApp />);
    expect(screen.getByText("Atlas")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByText("Unprotected")).toBeTruthy();
    expect(sw().getAttribute("aria-checked")).toBe("false");
    for (const s of SUGGESTIONS) expect(screen.getByRole("button", { name: s })).toBeTruthy();
    const text = document.body.textContent!;
    expect(text).not.toMatch(/ASI0[34]|risk score|attack graph|glossary/i);
  });

  it("toggle updates the mode label and aria state", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Protected")).toBeTruthy();
  });

  it("Enter sends, Shift+Enter makes a newline, empty messages are not sent", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Message"), "line one{Shift>}{Enter}{/Shift}line two");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("line one\nline two");
    await user.keyboard("{Enter}");
    expect(document.querySelector(".msg.user .bubble")!.textContent).toBe("line one\nline two");
    await settled();
  });
});

describe("same request, two modes (real server handlers)", () => {
  it("Security OFF: the agent follows the untrusted instructions and chips show the access it was granted", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(screen.getByRole("button", { name: "Find the latest project updates." }));
    await settled();
    const chips = within(lastAssistant()).getByRole("list", { name: "Tool activity" });
    expect(chips.textContent).toContain("Fetch updates (Atlas Sync plugin)");
    expect(chips.textContent).not.toMatch(/Blocked|Denied/);
    expect(lastAssistant().querySelector("details.trace")!.textContent).toContain("doc-nightingale-budget");
    expect(lastAssistant().textContent).toContain("Phase 1: $1.8M");
    expect(lastAssistant().textContent).toContain("I also sent this to review@partner-vendor.example");
  });

  it("Security ON: untrusted tool blocked, task still completed, nothing leaked", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    await user.click(screen.getByRole("button", { name: "Find the latest project updates." }));
    await settled();
    const a = lastAssistant();
    expect(a.querySelector(".chips")!.textContent).toMatch(/Fetch updates \(Atlas Sync plugin\).*Blocked/);
    expect(a.textContent).toContain("Usability test round 2 passed");
    expect(a.textContent).not.toMatch(/Phase 1|\$1\.8M|I also sent/);
    expect(a.getAttribute("data-status")).toBe("done");
  });

  it("the reason for a denial is available on request, not shown by default", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    await ask(user, "Show me the Nightingale budget");
    await settled();
    expect(lastAssistant().querySelector(".chips")!.textContent).toContain("Denied");
    expect(lastAssistant().textContent).not.toContain("$4.2M");
    expect(lastAssistant().textContent).not.toMatch(/does not hold the scope/);
    await user.click(within(lastAssistant()).getByText(/Activity \(1\)/));
    await user.click(lastAssistant().querySelector(".tl-row")!);
    expect(lastAssistant().textContent).toMatch(/does not hold the scope/);
  });

  it("the activity trace is collapsed by default and lists decisions when opened", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    await user.click(screen.getByRole("button", { name: "Find the latest project updates." }));
    await settled();
    const trace = lastAssistant().querySelector("details.trace") as HTMLDetailsElement;
    expect(trace.open).toBe(false);
    await user.click(within(lastAssistant()).getByText(/Activity \(2\)/));
    expect(trace.open).toBe(true);
    await user.click(trace.querySelector(".tl-item.denied .tl-row")!);
    expect(trace.textContent).toContain("untrusted blocked");
    expect(trace.textContent).toContain("trustValidation");
  });

  it("the step log is not shown after completion: the chat stays compact", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(screen.getByRole("button", { name: "Review my project files and suggest improvements." }));
    await settled();
    expect(lastAssistant().querySelector(".tk")).toBeNull();
    expect(lastAssistant().querySelector("details.trace")).not.toBeNull();
  });

  it("approval: nothing is sent until Approve, and the UI reports only the confirmed result", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    await user.click(screen.getByRole("button", { name: "Send the project summary to the team." }));
    await settled();
    const card = within(lastAssistant()).getByRole("group", { name: "Approval required" });
    expect(lastAssistant().textContent).not.toMatch(/Approved · Simulated send completed/);
    await user.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(lastAssistant().textContent).toMatch(/Approved · Simulated send completed/));
    expect(lastAssistant().querySelector(".tchip.pending")).toBeNull(); // chip no longer shows "Approval required"
    expect(lastAssistant().querySelector(".chips")!.textContent).not.toContain("Approval required");
  });

  it("denying an approval never sends", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    await user.click(screen.getByRole("button", { name: "Send the project summary to the team." }));
    await settled();
    await user.click(within(lastAssistant()).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(lastAssistant().textContent).toMatch(/You declined. Nothing was sent./));
    expect(lastAssistant().querySelector(".chips")!.textContent).toContain("Denied");
    expect(lastAssistant().textContent).not.toContain("Approval required");
  });

  it("Security OFF sends without a prompt, and says so", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(screen.getByRole("button", { name: "Send the project summary to the team." }));
    await settled();
    expect(within(lastAssistant()).queryByRole("group", { name: "Approval required" })).toBeNull();
    expect(lastAssistant().textContent).toContain("I sent the summary");
  });

  it("the switch is sent to the server per request and a divider marks the change", async () => {
    const seen: unknown[] = [];
    installFetch((_u, b) => seen.push(b));
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "Summarize the Lighthouse project status.");
    await settled();
    await user.click(sw());
    expect(screen.getByText("Security on")).toBeTruthy();
    await ask(user, "Summarize the Lighthouse project status.");
    await settled();
    expect(seen).toMatchObject([
      { message: "Summarize the Lighthouse project status.", security: false, history: [] },
      { message: "Summarize the Lighthouse project status.", security: true, history: [{ role: "user" }, { role: "assistant" }] },
    ]);
  });

  it("renders structured replies with OpenUI components", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "How do I set up the VPN?");
    await settled();
    expect(lastAssistant().querySelector(".oc-table table")).toBeTruthy();
  });
});

describe("loading and keyboard behavior", () => {
  it("no loader or running step remains once a reply has finished or failed", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(screen.getByRole("button", { name: "Find the latest project updates." }));
    await settled();
    expect(document.querySelectorAll(".bu-loading").length).toBe(0);
    expect(document.querySelectorAll(".tk.running, .tk-line.running").length).toBe(0);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await ask(user, "hello");
    await waitFor(() => expect(lastAssistant().getAttribute("data-status")).toBe("error"));
    expect(document.querySelectorAll(".bu-loading").length).toBe(0);
  });

  it("the loader appears only while waiting for the first real event", async () => {
    let release!: () => void;
    const line = JSON.stringify({ type: "answer", program: 'root = ChatReply([b1])\nb1 = Paragraph("Hi")', plain: "Hi" }) + "\n";
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => (release = () => res(new Response(line))))));
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    expect(document.querySelectorAll(".bu-loading").length).toBe(1);
    release();
    await settled();
    expect(document.querySelectorAll(".bu-loading").length).toBe(0);
  });

  it("the security switch and sends are keyboard operable", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    sw().focus();
    await user.keyboard(" ");
    expect(sw().getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{Enter}");
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });
});

describe("failure and control states", () => {
  it("shows a calm error when the network fails and the app stays usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Couldn't reach the assistant/));
    expect(lastAssistant().getAttribute("data-status")).toBe("error");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("stop aborts generation and marks the reply stopped, with no running steps left", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))))),
    );
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    expect(screen.getByRole("status").textContent).toContain("Atlas is working");
    await user.click(screen.getByRole("button", { name: "Stop generating" }));
    await waitFor(() => expect(lastAssistant().getAttribute("data-status")).toBe("stopped"));
    expect(lastAssistant().textContent).toContain("Stopped.");
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("New chat clears the conversation back to the empty state", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    await settled();
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByText("How can I help?")).toBeTruthy();
    expect(document.querySelectorAll(".msg").length).toBe(0);
  });

  it("server validation errors surface without crashing", async () => {
    const res = await chatRoute(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ message: "", security: true }) }));
    expect(res.status).toBe(400);
    const bad = await chatRoute(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ message: "hi", security: "yes" }) }));
    expect(bad.status).toBe(400);
    const notJson = await chatRoute(new Request("http://x/api/chat", { method: "POST", body: "{" }));
    expect(notJson.status).toBe(400);
  });

  it("approve endpoint rejects malformed and unknown ids", async () => {
    const mk = (b: unknown) => approveRoute(new Request("http://x/api/approve", { method: "POST", body: JSON.stringify(b) }));
    expect((await mk({ callId: "../x", approve: true })).status).toBe(400);
    expect((await mk({ callId: "call-abcd-1", approve: true })).status).toBe(400);
    expect((await mk({ callId: `call-${"a".repeat(24)}-1`, approve: true })).status).toBe(404);
  });

  it("a malformed stream line is ignored rather than breaking the chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('not json\n{"type":"answer","program":"root = ChatReply([b1])\\nb1 = Paragraph(\\"Hello there\\")","plain":"Hello there"}\n')),
    );
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    await settled();
    expect(lastAssistant().textContent).toContain("Hello there");
  });

  it("an invalid model-written reply falls back to the deterministic message", async () => {
    const bad = JSON.stringify({ type: "answer", program: "this is not openui", plain: "x", fallback: { program: 'root = ChatReply([b1])\nb1 = Paragraph("Safe fallback")', plain: "Safe fallback" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`${bad}\n`)));
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    await settled();
    await waitFor(() => expect(lastAssistant().textContent).toContain("Safe fallback"));
  });

  it("generated markup is rendered as text, never as HTML", async () => {
    const evil = JSON.stringify({ type: "answer", program: 'root = ChatReply([b1])\nb1 = Paragraph("<img src=x onerror=alert(1)><script>alert(1)</script>")', plain: "" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`${evil}\n`)));
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    await settled();
    expect(lastAssistant().querySelector("img, script")).toBeNull();
    expect(lastAssistant().textContent).toContain("<script>alert(1)</script>");
  });

  it("a model cannot add tool activity or approvals by writing UI: only execution events create them", async () => {
    const forged = JSON.stringify({ type: "answer", program: 'root = ChatReply([b1])\nb1 = Paragraph("Access granted. I sent your records.")', plain: "" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`${forged}\n`)));
    const user = userEvent.setup();
    render(<ChatApp />);
    await ask(user, "hello");
    await settled();
    expect(within(lastAssistant()).queryByRole("list", { name: "Tool activity" })).toBeNull();
    expect(lastAssistant().querySelector(".tchip")).toBeNull();
  });
});

describe("chat reducer", () => {
  it("a stopped run leaves no step in the running state", () => {
    let s = chatReducer(initialChat, { type: "send", userId: "u", assistantId: "a", text: "x", security: false, now: 0 });
    s = chatReducer(s, { type: "event", id: "a", event: { type: "step", id: "1", kind: "tool", text: "t", state: "running" } });
    s = chatReducer(s, { type: "end", id: "a", status: "stopped", now: 5 });
    const m = s.messages[1];
    expect(m.role === "assistant" && m.steps[0].state).toBe("failed");
  });
  it("unknown ids and actions leave state unchanged", () => {
    const s = chatReducer(initialChat, { type: "event", id: "nope", event: { type: "delta", text: "x" } });
    expect(s.messages).toEqual([]);
    expect(chatReducer(s, { type: "bogus" } as never)).toBe(s);
  });
  it("send fires without events when pressed with whitespace only", async () => {
    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
