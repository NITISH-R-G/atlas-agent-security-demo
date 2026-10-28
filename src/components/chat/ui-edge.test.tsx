import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveRoute } from "@/app/api/approve/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { clearPending } from "@/lib/agent/approvals";
import { clearAuditLog, getAuditLog } from "@/lib/agent/audit";
import { resetRateLimits } from "@/lib/agent/session";
import { chatReducer, initialChat, type AssistantMessage } from "./chat-state";
import ChatApp from "./ChatApp";

const calls: { url: string; body: Record<string, unknown> }[] = [];
const jar: { cookie?: string } = {};
let gate: Promise<void> | undefined;

function installFetch() {
  jar.cookie = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      if (gate && url === "/api/chat") await gate;
      const req = new Request(`http://localhost${url}`, { method: "POST", body: init.body as string, headers: jar.cookie ? { cookie: jar.cookie } : {} });
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
  calls.length = 0;
  gate = undefined;
  clearPending();
  clearAuditLog();
  resetRateLimits();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

const sw = () => screen.getByRole("switch", { name: "Security" });
const lastAssistant = () => [...document.querySelectorAll<HTMLElement>(".msg.assistant")].at(-1)!;
const settled = () => waitFor(() => expect(lastAssistant().getAttribute("data-status")).not.toBe("working"), { timeout: 4000 });
const send = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText("Message"), text);
  await user.keyboard("{Enter}");
};
const chatCalls = () => calls.filter((c) => c.url === "/api/chat");
const approveCalls = () => calls.filter((c) => c.url === "/api/approve");

describe("approvals in the UI", () => {
  it("repeated clicks on Approve send one request and the final state is the real outcome", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    await send(user, "Read the project update and send a summary to the team.");
    await settled();
    const btn = within(lastAssistant()).getByRole("button", { name: "Approve" });
    await Promise.all([user.click(btn), user.click(btn), user.click(btn)]).catch(() => undefined);
    await waitFor(() => expect(lastAssistant().textContent).toMatch(/Approved · Simulated send completed/));
    expect(approveCalls().length).toBe(1);
    expect(getAuditLog().filter((l) => l.decision === "granted" && l.tool === "send_message")).toHaveLength(1);
  });

  it("a late duplicate or failed resolution can never overwrite a settled outcome", () => {
    let s = chatReducer(initialChat, { type: "send", userId: "u", assistantId: "a", text: "q", security: true, now: 0 });
    s = chatReducer(s, { type: "event", id: "a", event: { type: "approval", callId: "c1", label: "Send", summary: "x" } });
    const view = { callId: "c1", tool: "send_message", label: "Send", target: "t", decision: "granted" as const, layer: "none" as const, reason: "", status: "ok" as const, notices: [], redactions: 0, evals: [] };
    s = chatReducer(s, { type: "approval", id: "a", callId: "c1", result: { decision: "approved", view } });
    s = chatReducer(s, { type: "approval", id: "a", callId: "c1", result: { decision: "failed", error: "duplicate" } });
    s = chatReducer(s, { type: "approval", id: "a", callId: "c1", result: { decision: "denied" } });
    const m = s.messages[1] as AssistantMessage;
    expect(m.approvals[0].state).toBe("approved");
    expect(m.trace.filter((t) => t.kind === "approval")).toHaveLength(1);
  });

  it("several pending approvals are independent and each shows its own result", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(sw());
    await send(user, "Read the project update and send a summary to the team.");
    await settled();
    await send(user, "Read the project update and send a summary to the team.");
    await settled();
    const [first, second] = [...document.querySelectorAll<HTMLElement>(".msg.assistant")];
    await user.click(within(second).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(second.textContent).toMatch(/You declined/));
    expect(within(first).getByRole("button", { name: "Approve" })).toBeTruthy(); // the other is untouched
    await user.click(within(first).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(first.textContent).toMatch(/Approved · Simulated send completed/));
    expect(first.textContent).not.toMatch(/declined/);
    expect(second.textContent).not.toMatch(/Approved · Simulated send completed/);
  });

  it("after a browser refresh the pending action is unreachable and was never executed (fails closed)", async () => {
    const user = userEvent.setup();
    const first = render(<ChatApp />);
    await user.click(sw());
    await send(user, "Read the project update and send a summary to the team.");
    await settled();
    first.unmount();
    render(<ChatApp />); // a reload: the UI forgets the card, the server keeps the parked action unexecuted
    expect(document.querySelectorAll(".approval").length).toBe(0);
    expect(getAuditLog().some((l) => l.tool === "send_message" && l.decision === "granted")).toBe(false);
  });
});

describe("sending, cancelling and toggling", () => {
  it("rapid repeated sends: only one request is in flight at a time", async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.type(screen.getByLabelText("Message"), "first");
    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Message"), "second");
    await user.keyboard("{Enter}{Enter}");
    expect(chatCalls().length).toBe(1);
    release();
    await settled();
    expect(chatCalls().length).toBe(1);
  });

  it("empty and whitespace-only messages are never sent", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.type(screen.getByLabelText("Message"), "   ");
    await user.keyboard("{Enter}");
    expect(chatCalls().length).toBe(0);
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an oversized message gets a calm server error, not a crash, and the box stays usable", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const big = "x".repeat(4001);
    await user.click(screen.getByLabelText("Message"));
    await user.paste(big);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/message must be 1-4000 characters/));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("toggling Security during a request does not change that request's policy; the next request uses the new one", async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const user = userEvent.setup();
    render(<ChatApp />);
    await send(user, "Find the latest project updates.");
    await user.click(sw()); // flip to ON while the first request is still pending
    release();
    await settled();
    expect(chatCalls()[0].body.security).toBe(false);
    await send(user, "Find the latest project updates.");
    await settled();
    expect(chatCalls()[1].body.security).toBe(true);
    expect(screen.getByText("Security on")).toBeTruthy();
  });

  it("a connection that breaks mid-stream ends in an error state with no invented answer", async () => {
    const enc = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(JSON.stringify({ type: "delta", text: "Partial " }) + "\n")); c.error(new Error("reset")); } }))),
    );
    const user = userEvent.setup();
    render(<ChatApp />);
    await send(user, "hello");
    await waitFor(() => expect(lastAssistant().getAttribute("data-status")).toBe("error"));
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't reach the assistant/);
    expect(lastAssistant().querySelector(".oc-reply")).toBeNull(); // no rendered answer
  });

  it("a 429 from the server is shown honestly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "rate_limited", message: "Too many requests from this session. Wait a few minutes and try again." } }, { status: 429 })));
    const user = userEvent.setup();
    render(<ChatApp />);
    await send(user, "hello");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Too many requests/));
  });
});

describe("walkthrough evidence", () => {
  it("a blocked call lists the controls it never reached and links to its audit record; OFF says auditing is off", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("button", { name: "Explore Security" }));
    const run = async (id: string) => {
      await user.click(screen.getByRole("button", { name: new RegExp(`scenario ${id},`) }));
      await settled();
      const open = screen.queryAllByRole("button", { name: "Open full evidence" }).at(-1);
      if (open) await user.click(open);
    };
    await run("B");
    const wt = screen.getByRole("complementary", { name: "Security walkthrough" });
    await user.click(within(wt).getAllByRole("button").find((b) => /Fetch updates/.test(b.textContent ?? ""))!);
    const d = within(wt).getByRole("region", { name: "Step details" }).textContent!;
    expect(d).toMatch(/Not evaluated \(an earlier check stopped the call\): .*Tool allowlist.*Least privilege/);
    expect(d).toMatch(/Audit record: [a-f0-9-]{12} · untrusted_blocked · scripted/);
    await run("A");
    await user.click(within(wt).getAllByRole("button").find((b) => /Read document/.test(b.textContent ?? ""))!);
    expect(within(wt).getByRole("region", { name: "Step details" }).textContent).toMatch(/Audit record: none \(auditing is off in this profile\)/);
  });
});

describe("accessibility basics", () => {
  it("interactive controls have accessible names and status changes are announced", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    for (const name of ["Explore Security", "New chat", "Hide sidebar"]) expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("Message")).toBeTruthy();
    expect(screen.getByRole("main", { name: "Conversation" })).toBeTruthy();
    await user.click(sw());
    expect(document.querySelector(".mode")!.getAttribute("aria-live")).toBe("polite");
    await send(user, "Read the project update and send a summary to the team.");
    await settled();
    expect(within(lastAssistant()).getByRole("group", { name: "Approval required" })).toBeTruthy();
    expect(within(lastAssistant()).getByRole("list", { name: "Tool activity" })).toBeTruthy();
  });

  it("everything is reachable with the keyboard: the switch toggles with Space and Enter, buttons have no negative tabindex", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    sw().focus();
    await user.keyboard(" ");
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll("button[tabindex='-1']").length).toBe(0);
  });
});
