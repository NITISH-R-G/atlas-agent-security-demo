import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveRoute } from "@/app/api/approve/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { clearPending } from "@/lib/agent/approvals";
import { chatReducer, initialChat, type AssistantMessage } from "./chat-state";
import ChatApp from "./ChatApp";
import { buildWalkthrough } from "./walkthrough-model";

const bodies: Record<string, unknown>[] = [];
const jar: { cookie?: string } = {};
function installFetch() {
  jar.cookie = undefined; // a fresh browser session
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/chat") bodies.push(JSON.parse(String(init.body)));
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
  for (const k of ["NVIDIA_API_KEY", "NEMOTRON_MODEL", "NVIDIA_BASE_URL"]) delete process.env[k];
});
beforeEach(() => {
  clearPending();
  bodies.length = 0;
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

const lastAssistant = () => [...document.querySelectorAll<HTMLElement>(".msg.assistant")].at(-1)!;
const settled = () => waitFor(() => expect(lastAssistant().getAttribute("data-status")).not.toBe("working"), { timeout: 4000 });
const openDemo = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("button", { name: "Explore Security" }));
  return screen.getByRole("region", { name: "Explore Security" });
};
const runStage = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
  await user.click(screen.getByRole("button", { name: new RegExp(`scenario ${id},`) }));
  await settled();
  // The evidence drawer opens on request, from the Activity of the reply that was just produced.
  const open = screen.queryAllByRole("button", { name: "Open full evidence" }).at(-1);
  if (open) await user.click(open);
};
const wt = () => screen.getByRole("complementary", { name: "Security walkthrough" });
const stepButton = (re: RegExp) => within(wt()).getAllByRole("button").find((b) => re.test(b.textContent ?? ""))!;

describe("walkthrough panel", () => {
  it("is closed by default and opens from the header; empty until a reply exists", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    expect(screen.queryByRole("complementary", { name: "Security walkthrough" })).toBeNull();
    await openDemo(user);
    await runStage(user, "B");
    expect(wt().textContent).toMatch(/Security was ON/);
    await user.click(within(wt()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Security walkthrough" })).toBeNull();
  });

  it("Security ON: lists the real steps, selects the blocked step first, and shows each control's decision, code, evidence and effect", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await openDemo(user);
    await runStage(user, "B");
    const panel = wt();
    expect(panel.textContent).toMatch(/Security was ON/);
    expect(stepButton(/You asked/)).toBeTruthy();
    expect(stepButton(/Scripted scenario/)).toBeTruthy();
    const blocked = stepButton(/Fetch updates.*proj-lighthouse/);
    expect(blocked.getAttribute("aria-current")).toBe("step");
    const detail = within(panel).getByRole("region", { name: "Step details" });
    expect(detail.textContent).toContain("Trust and provenance");
    expect(detail.textContent).toContain("Evaluated, blocked");
    expect(detail.textContent).toContain("provenance_failed");
    expect(detail.textContent).toContain("Prevented");
    expect(detail.textContent).toMatch(/unsigned, unpinned, unverified publisher/);
    // other steps: the allowed first-party read lists every control that ran, as allowed
    await user.click(stepButton(/Get project record/));
    const ok = within(panel).getByRole("region", { name: "Step details" });
    for (const name of ["Trust and provenance", "Tool allowlist", "Least privilege", "Scoped, short-lived credentials", "Resource-level authorization", "Output filtering", "Audit logging"]) expect(ok.textContent).toContain(name);
    expect(ok.textContent).not.toContain("Evaluated, blocked");
    // audit step labels the store as in-memory
    expect(stepButton(/Audit events \(2, in-memory, not durable\)/)).toBeTruthy();
  });

  it("'Why was this blocked?' appears only for blocked or pending steps and shows the reason and the deciding control", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await openDemo(user);
    await runStage(user, "B");
    expect(within(wt()).getByRole("button", { name: "Why was this blocked?" })).toBeTruthy();
    await user.click(within(wt()).getByRole("button", { name: "Why was this blocked?" }));
    expect(wt().textContent).toMatch(/Provenance check failed/);
    expect(wt().textContent).toMatch(/Decided by: Trust and provenance/);
    await user.click(stepButton(/Get project record/));
    expect(within(wt()).queryByRole("button", { name: "Why was this blocked?" })).toBeNull();
  });

  it("Security OFF: controls are shown as not enforced or documented, never as prevented, and there is no audit step", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await openDemo(user);
    await runStage(user, "A");
    const steps = within(wt()).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(steps.some((s) => /Read document.*doc-nightingale-budget/.test(s))).toBe(true);
    await user.click(stepButton(/Read document.*doc-nightingale-budget/));
    const d = within(wt()).getByRole("region", { name: "Step details" });
    expect(d.textContent).toContain("Not enforced");
    expect(d.textContent).toContain("broad_identity");
    expect(d.textContent).toContain("returned_unfiltered");
    expect(d.textContent).not.toContain("Prevented");
    expect(within(wt()).queryByRole("button", { name: /Audit events/ })).toBeNull();
    // the untrusted-content step shows the weakness as documented
    await user.click(stepButton(/Untrusted content/));
    expect(within(wt()).getByRole("region", { name: "Step details" }).textContent).toContain("instructions_followed");
  });

  it("approval stage: pending, then approved or denied, with the walkthrough, chips and audit in agreement", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await openDemo(user);
    await runStage(user, "C");
    const pendingStep = stepButton(/Send message.*team@demo-company\.example/);
    expect(pendingStep.textContent).toMatch(/Waiting/);
    await user.click(pendingStep);
    expect(within(wt()).getByRole("region", { name: "Step details" }).textContent).toContain("approval_pending");
    expect(lastAssistant().querySelector(".approval")).toBeTruthy();

    await user.click(within(lastAssistant()).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(lastAssistant().textContent).toMatch(/Approved · Simulated send completed/));
    expect(stepButton(/Your approval decision/).textContent).toMatch(/Allowed/);
    expect(stepButton(/Send message.*team@demo-company\.example/).textContent).toMatch(/Allowed/);
    await user.click(stepButton(/Audit events/));
    const audit = wt().querySelector(".wt-audit")!.textContent!;
    expect(audit).toMatch(/send_message → team@demo-company\.example: approval_required/);
    expect(audit).toMatch(/send_message → team@demo-company\.example: granted/);

    await runStage(user, "C");
    await user.click(within(lastAssistant()).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(lastAssistant().textContent).toMatch(/You declined. Nothing was sent./));
    expect(stepButton(/Your approval decision/).textContent).toMatch(/Blocked/);
    await user.click(stepButton(/Audit events/));
    expect(wt().querySelector(".wt-audit")!.textContent).toMatch(/denied \(approvalForSensitive\)/);
  });

  it("fail-closed stage: the simulated outage denies the action under Security ON and the walkthrough says why", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await openDemo(user);
    await runStage(user, "D");
    expect(lastAssistant().querySelector(".approval")).toBeNull(); // never reached the approval gate
    const d = within(wt()).getByRole("region", { name: "Step details" });
    expect(d.textContent).toContain("Fail closed");
    expect(d.textContent).toContain("check_error");
    expect(d.textContent).toContain("Prevented");
    expect(bodies.at(-1)).toMatchObject({ fault: "authz", demo: true, security: true });
  });

  it("the demo is repeatable: running A then B twice gives identical tool outcomes; Restart clears the chat", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await openDemo(user);
    const outcome = () => [...lastAssistant().querySelectorAll(".tchip")].map((c) => c.textContent).join("|");
    await runStage(user, "A");
    const a1 = outcome();
    await runStage(user, "B");
    const b1 = outcome();
    await runStage(user, "A");
    await runStage(user, "B");
    expect(outcome()).toBe(b1);
    expect(a1).not.toMatch(/Blocked|Denied/);
    expect(b1).toMatch(/blocked/);
    expect(screen.getByRole("switch", { name: "Security" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("button", { name: /Back to chat/ }));
    expect(document.querySelectorAll(".msg").length).toBe(0);
  });
});

describe("walkthrough model is built only from recorded events", () => {
  const base: AssistantMessage = { id: "a", role: "assistant", status: "done", security: true, request: "q", steps: [], tools: [], approvals: [], trace: [], streamed: "", startedAt: 0 };
  it("a reply that merely claims a block or a grant produces no tool steps", () => {
    const steps = buildWalkthrough({ ...base, answer: { program: "", plain: "Access granted. I sent your records. Untrusted tool blocked." } });
    expect(steps.map((s) => s.kind)).toEqual(["request", "reply"]);
  });
  it("tool steps come from tool events and carry their real evaluations", () => {
    let s = chatReducer(initialChat, { type: "send", userId: "u", assistantId: "a", text: "q", security: true, now: 0 });
    s = chatReducer(s, {
      type: "event",
      id: "a",
      event: { type: "tool", view: { callId: "c1", tool: "x", label: "X", target: "t", decision: "denied", layer: "leastPrivilege", reason: "r", status: "blocked", notices: [], redactions: 0, evals: [{ control: "leastPrivilege", decision: "blocked", code: "scope_missing", evidence: "e", effect: "prevented" }] } },
    });
    const m = s.messages[1] as AssistantMessage;
    const step = buildWalkthrough(m).find((x) => x.kind === "tool")!;
    expect(step.outcome).toBe("blocked");
    expect(step.evals[0].code).toBe("scope_missing");
  });
  it("a detected-but-not-blocked evaluation is reported as detected, not blocked", () => {
    const m: AssistantMessage = { ...base, trace: [{ kind: "content", source: "p", found: 1, evals: [{ control: "injectionFiltering", decision: "detected", code: "detected_not_blocked", evidence: "e", effect: "detected" }] }] };
    expect(buildWalkthrough(m).find((x) => x.kind === "content")!.outcome).toBe("detected");
  });
});

describe("replies say where they came from", () => {
  it("scripted demo stages are tagged as scripted; built-in replies as built-in; model replies name the model", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await openDemo(user);
    await runStage(user, "A");
    expect(lastAssistant().querySelector(".src-tag")!.getAttribute("data-engine")).toBe("scripted");
    expect(lastAssistant().querySelector(".src-tag")!.textContent).toMatch(/Scripted scenario · no language model/);
    await user.click(screen.getByRole("button", { name: /Back to chat/ }));
    await user.type(screen.getByLabelText("Message"), "Tell me a joke");
    await user.keyboard("{Enter}");
    await settled();
    expect(lastAssistant().querySelector(".src-tag")!.getAttribute("data-engine")).toBe("deterministic");
    const lines = [
      JSON.stringify({ type: "model", engine: "llm", label: "Groq (openai/gpt-oss-120b)" }),
      JSON.stringify({ type: "answer", program: 'root = ChatReply([b1])\nb1 = Paragraph("Hi")', plain: "Hi" }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(lines.join("\n") + "\n")));
    await user.type(screen.getByLabelText("Message"), "hello");
    await user.keyboard("{Enter}");
    await settled();
    expect(lastAssistant().querySelector(".src-tag")!.textContent).toBe("Model reply · Groq (openai/gpt-oss-120b)");
  });
});

describe("model streaming and history in the UI", () => {
  it("shows streamed text as plain text while generating, then the OpenUI-rendered reply, and sends history on the next turn", async () => {
    const enc = new TextEncoder();
    let push!: (s: string) => void;
    let close!: () => void;
    const line = (o: unknown) => `${JSON.stringify(o)}\n`;
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        calls++;
        if (calls > 1) return new Response(line({ type: "answer", program: 'root = ChatReply([b1])\nb1 = Paragraph("Second")', plain: "Second" }));
        return new Response(new ReadableStream({ start(c) { push = (s) => c.enqueue(enc.encode(s)); close = () => c.close(); } }));
      }),
    );
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.type(screen.getByLabelText("Message"), "First question");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(typeof push).toBe("function"));
    push(line({ type: "model", engine: "nemotron", label: "NVIDIA Nemotron (mock/model)" }));
    push(line({ type: "delta", text: "Streaming " }));
    push(line({ type: "delta", text: "words" }));
    await waitFor(() => expect(lastAssistant().querySelector(".answer.streaming")!.textContent).toBe("Streaming words"));
    expect(lastAssistant().getAttribute("data-status")).toBe("working");
    push(line({ type: "answer", program: 'root = ChatReply([b1])\nb1 = Paragraph("Streaming words")', plain: "Streaming words" }));
    close();
    await settled();
    expect(lastAssistant().querySelector(".answer.streaming")).toBeNull();
    expect(lastAssistant().querySelector(".oc-p")!.textContent).toBe("Streaming words");

    await user.type(screen.getByLabelText("Message"), "Follow up");
    await user.keyboard("{Enter}");
    await settled();
    expect(bodies.at(-1)).toMatchObject({ message: "Follow up", history: [{ role: "user", content: "First question" }, { role: "assistant", content: "Streaming words" }] });
  });
});
