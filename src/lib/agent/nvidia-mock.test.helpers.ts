/** Test-only mock of an OpenAI-compatible streaming chat completions endpoint. NOT a real NVIDIA service. */
export interface MockTurn {
  text?: string;
  toolCalls?: { name: string; args: unknown }[];
  /** Return a non-200 response with this body. */
  status?: number;
  body?: string;
  /** Never respond (until aborted). */
  hang?: boolean;
  /** Send the normal parts, then fail the connection instead of finishing (an interrupted stream). */
  breakAfter?: boolean;
}

export interface Recorded {
  url: string;
  headers: Headers;
  body: Record<string, unknown> & { messages: { role: string; content: unknown }[]; tools?: unknown[] };
}

const enc = new TextEncoder();
const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const chunk = (delta: object, finish: string | null = null) => ({ id: "mock-1", object: "chat.completion.chunk", created: 1, model: "mock/model", choices: [{ index: 0, delta, finish_reason: finish }] });

export function mockNvidia(turns: MockTurn[]) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    const t = turns[Math.min(requests.length - 1, turns.length - 1)];
    if (t.hang) {
      return new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(init.signal!.reason ?? new DOMException("aborted", "AbortError"))));
    }
    if (t.status) return new Response(t.body ?? JSON.stringify({ error: { message: "mock error" } }), { status: t.status, headers: { "Content-Type": "application/json" } });
    if (t.body !== undefined) return new Response(t.body, { headers: { "Content-Type": "text/event-stream" } });
    const parts: string[] = [sse(chunk({ role: "assistant", content: "" }))];
    if (t.toolCalls) {
      t.toolCalls.forEach((c, i) => parts.push(sse(chunk({ tool_calls: [{ index: i, id: `call_${requests.length}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] }))));
      parts.push(sse(chunk({}, "tool_calls")));
    } else {
      const text = t.text ?? "";
      const mid = Math.ceil(text.length / 2);
      for (const piece of [text.slice(0, mid), text.slice(mid)]) if (piece) parts.push(sse(chunk({ content: piece })));
      parts.push(sse(chunk({}, "stop")));
    }
    parts.push("data: [DONE]\n\n");
    return new Response(
      new ReadableStream({
        start(c) {
          for (const p of t.breakAfter ? parts.slice(0, -2) : parts) c.enqueue(enc.encode(p));
          if (t.breakAfter) c.error(new Error("connection reset"));
          else c.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}
