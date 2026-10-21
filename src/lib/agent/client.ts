import type { AuditView } from "./approve";
import type { AgentEvent, ToolView } from "./planner";

export type StreamResult = { ok: true } | { ok: false; code: "network" | "server" | "cancelled" | "empty"; message: string };

/** Streams NDJSON agent events. Never throws: failures are typed so the chat can show a calm error. */
export async function streamChat(
  req: { message: string; security: boolean; history?: { role: "user" | "assistant"; content: string }[]; demo?: boolean; fault?: "authz" },
  opts: { signal?: AbortSignal; onEvent: (e: AgentEvent) => void; fetchImpl?: typeof fetch },
): Promise<StreamResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let received = 0;
  try {
    const res = await doFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      let message = "The assistant service returned an error.";
      try {
        const d = (await res.json()) as { error?: { message?: string } };
        if (d?.error?.message) message = d.error.message;
      } catch {
        /* default */
      }
      return { ok: false, code: "server", message };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const flush = (line: string) => {
      if (!line.trim()) return;
      try {
        opts.onEvent(JSON.parse(line) as AgentEvent);
        received++;
      } catch {
        /* ignore a malformed line rather than breaking the stream */
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        flush(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    flush(buf + decoder.decode());
    return received > 0 ? { ok: true } : { ok: false, code: "empty", message: "The assistant returned nothing." };
  } catch (error) {
    if (opts.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return { ok: false, code: "cancelled", message: "Stopped." };
    }
    return { ok: false, code: "network", message: "Couldn't reach the assistant. Check your connection and try again." };
  }
}

export type ApproveResult =
  | { ok: true; decision: "approved"; view: ToolView; audit?: AuditView }
  | { ok: true; decision: "denied"; audit?: AuditView }
  | { ok: false; message: string };

export async function sendApproval(callId: string, approve: boolean, ticket?: string, fetchImpl: typeof fetch = fetch): Promise<ApproveResult> {
  try {
    const res = await fetchImpl("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, approve, ticket }),
    });
    const data = (await res.json()) as { decision?: string; view?: ToolView; audit?: AuditView; error?: { message?: string } };
    if (!res.ok) return { ok: false, message: data.error?.message ?? "Approval failed. Nothing was run." };
    if (data.decision === "approved" && data.view) return { ok: true, decision: "approved", view: data.view, audit: data.audit };
    if (data.decision === "denied") return { ok: true, decision: "denied", audit: data.audit };
    return { ok: false, message: "Unexpected response. Nothing was run." };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Nothing was run." };
  }
}
