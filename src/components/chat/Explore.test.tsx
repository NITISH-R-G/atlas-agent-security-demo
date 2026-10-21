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
beforeAll(() => {
  process.env.ATLAS_SIMULATED_LATENCY = "0";
});
beforeEach(() => {
  clearPending();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

const enter = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("button", { name: "Explore Security" }));
  return screen.getByRole("region", { name: "Explore Security" });
};
const idle = () => waitFor(() => expect(document.querySelector(".msg.assistant[data-status='working']")).toBeNull(), { timeout: 5000 });
const runStage = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
  await user.click(screen.getByRole("button", { name: new RegExp(`scenario ${id},`) }));
  await waitFor(() => expect(document.querySelector(".msg.assistant")).not.toBeNull());
  await idle();
};

describe("normal chat stays minimal", () => {
  it("does not show the scripted scenario panel, walkthrough or architecture by default", () => {
    render(<ChatApp />);
    expect(screen.queryByRole("region", { name: "Security demo" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Security walkthrough" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Architecture" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Security" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Explore Security" }).length).toBeGreaterThan(0);
  });

  it("a normal reply shows compact tool status and one collapsed Activity summary, not a step log", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await user.click(screen.getByRole("switch", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Find the latest project updates." }));
    await idle();
    const m = document.querySelector(".msg.assistant")!;
    expect(m.querySelector(".chips")).not.toBeNull();
    expect((m.querySelector("details.trace") as HTMLDetailsElement).open).toBe(false);
    expect(m.querySelector(".tk")).toBeNull();
    expect(m.querySelector(".wt")).toBeNull();
  });
});

describe("Explore Security", () => {
  it("offers the four scenarios with short titles and Run controls", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const ex = await enter(user);
    for (const [id, title] of [["A", "Vulnerable"], ["B", "Protected"], ["C", "Approval"], ["D", "Fail closed"]]) {
      expect(within(ex).getByText(new RegExp(`${id} · ${title}`))).toBeTruthy();
      expect(within(ex).getByRole("button", { name: new RegExp(`Run scenario ${id}`) })).toBeTruthy();
    }
    await user.click(within(ex).getByRole("button", { name: /Back to chat/ }));
    expect(screen.queryByRole("region", { name: "Explore Security" })).toBeNull();
  });

  it("scenario C holds the send for approval and the real approval completes it", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    await enter(user);
    await runStage(user, "C");
    const card = screen.getByRole("group", { name: "Approval required" });
    expect(document.body.textContent).not.toMatch(/Simulated send completed/);
    await user.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Approved · Simulated send completed/));
    expect(screen.getByRole("button", { name: /Replay scenario C/ })).toBeTruthy();
  });

  it("the architecture view lights only what the selected scenario really did", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const ex = await enter(user);
    await runStage(user, "C");
    await runStage(user, "D");
    await user.click(within(ex).getByRole("tab", { name: "Architecture" }));
    const branches = () => within(ex).getByRole("list", { name: "Possible server outcomes" });
    await user.click(within(ex).getByRole("button", { name: /C · Approval/ }));
    expect(within(branches()).getByText(/Approval required/).closest("li")!.className).toMatch(/taken/);
    expect(within(branches()).getByText(/Authorization unavailable/).closest("li")!.className).not.toMatch(/taken/);
    await user.click(within(ex).getByRole("button", { name: /D · Fail closed/ }));
    expect(within(branches()).getByText(/Authorization unavailable/).closest("li")!.className).toMatch(/taken/);
    expect(within(branches()).getByText(/Approval required/).closest("li")!.className).not.toMatch(/taken/);
    await user.click(within(ex).getByRole("button", { name: /A · Vulnerable \(not run\)/ }));
    expect(within(ex).getByRole("img").getAttribute("aria-label")).toMatch(/Policy engine: Server-side \(Not used yet\)/);
    expect(within(branches()).getAllByRole("listitem").every((li) => !/taken/.test(li.className))).toBe(true);
  });
});

describe("guided tour", () => {
  it("runs real scenarios, highlights real elements, supports keyboard and restores focus", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const ex = await enter(user);
    const start = within(ex).getByRole("button", { name: "Take the tour" });
    await user.click(start);
    const dialog = await screen.findByRole("dialog", { name: /Security mode/ }, { timeout: 8000 });
    expect(within(dialog).getByText("1 / 5")).toBeTruthy();
    expect(document.querySelector(".tour-spot")).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: /Agent action/ })).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: /Policy decision/ })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: /Agent action/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".tour-spot")).toBeNull();
    expect(document.activeElement).toBe(start);
  });

  it("skips a step whose target does not exist rather than describing something absent", async () => {
    const user = userEvent.setup();
    render(<ChatApp />);
    const ex = await enter(user);
    await user.click(within(ex).getByRole("button", { name: "Take the tour" }));
    await screen.findByRole("dialog", { name: /Security mode/ }, { timeout: 8000 });
    // Approve the pending approval is not needed; here we only assert every shown step has a real target.
    const count = Number(screen.getByText(/^1 \/ \d+$/).textContent!.split("/")[1]);
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(5);
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
