// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveRoute } from "@/app/api/approve/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { GET as health } from "@/app/api/health/route";
import { isCrossSite, readBoundedText } from "./http-guard";
import { resetRateLimits } from "./session";

/** Request-size and cross-origin enforcement (category A/B). No provider is configured, so no model call is possible. */

const req = (headers: Record<string, string>, url = "http://localhost/api/chat") => new Request(url, { method: "POST", headers, body: "{}" });
const stream = (sizes: number[], pulled = { n: 0, bytes: 0 }) =>
  new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled.n >= sizes.length) return c.close();
      const s = sizes[pulled.n++];
      pulled.bytes += s;
      c.enqueue(new Uint8Array(s).fill(97));
    },
  });
const chunked = (url: string, sizes: number[], pulled?: { n: number; bytes: number }) => new Request(url, { method: "POST", body: stream(sizes, pulled), duplex: "half" } as RequestInit);

beforeEach(() => {
  resetRateLimits();
  process.env.ATLAS_SIMULATED_LATENCY = "0";
});
afterEach(() => vi.unstubAllGlobals());

describe("readBoundedText: the limit is on bytes actually read", () => {
  it("accepts a body of exactly the limit and rejects one byte more", async () => {
    expect((await readBoundedText(chunked("http://x", [100]), 100))?.length).toBe(100);
    expect(await readBoundedText(chunked("http://x", [101]), 100)).toBeUndefined();
  });
  it("counts bytes, not characters (a 3-byte character costs 3)", async () => {
    const body = new Request("http://x", { method: "POST", body: "€".repeat(40) }); // 120 bytes
    expect(await readBoundedText(body, 100)).toBeUndefined();
  });
  it("stops pulling once the limit is passed, whatever is offered", async () => {
    const pulled = { n: 0, bytes: 0 };
    expect(await readBoundedText(chunked("http://x", Array(1000).fill(1024), pulled), 4096)).toBeUndefined();
    expect(pulled.bytes).toBeLessThanOrEqual(4096 + 1024 * 2);
  });
  it("rejects a declared oversize length without reading the body", async () => {
    const pulled = { n: 0, bytes: 0 };
    const r = new Request("http://x", { method: "POST", headers: { "content-length": "999999" }, body: stream([10], pulled), duplex: "half" } as RequestInit);
    expect(await readBoundedText(r, 100)).toBeUndefined();
    expect(pulled.n).toBeLessThanOrEqual(1); // at most the runtime's own pre-pull; the guard read nothing
  });
  it("a lying (too small) content-length cannot smuggle more than the limit", async () => {
    const pulled = { n: 0, bytes: 0 };
    const r = new Request("http://x", { method: "POST", headers: { "content-length": "5" }, body: stream(Array(100).fill(1024), pulled), duplex: "half" } as RequestInit);
    expect(await readBoundedText(r, 4096)).toBeUndefined();
    expect(pulled.bytes).toBeLessThanOrEqual(4096 + 1024 * 2);
  });
  it("an empty body reads as empty text", async () => {
    expect(await readBoundedText(new Request("http://x"), 10)).toBe("");
  });
});

describe("size limits through the real routes", () => {
  it("chat: 413 for a chunked body over 64 KiB and the body is not read to the end", async () => {
    const pulled = { n: 0, bytes: 0 };
    const res = await chatRoute(chunked("http://localhost/api/chat", Array(500).fill(8192), pulled));
    expect(res.status).toBe(413);
    expect(pulled.bytes).toBeLessThan(64 * 1024 + 8192 * 2);
  });
  it("chat: 413 for a declared oversize length", async () => {
    expect((await chatRoute(req({ "content-length": "70000" }))).status).toBe(413);
  });
  it("chat: field limits still hold (message, history length, history item)", async () => {
    const post = (b: unknown) => chatRoute(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(b) }));
    expect((await post({ message: "x".repeat(4001), security: true })).status).toBe(400);
    expect((await post({ message: "hi", security: true, history: Array(13).fill({ role: "user", content: "x" }) })).status).toBe(400);
    expect((await post({ message: "hi", security: true, history: [{ role: "system", content: "x" }] })).status).toBe(400);
    expect((await post({ message: "hi", security: "yes" })).status).toBe(400);
  });
  it("approve: 413 for a chunked body over 16 KiB, and for a declared oversize length", async () => {
    const pulled = { n: 0, bytes: 0 };
    expect((await approveRoute(chunked("http://localhost/api/approve", Array(500).fill(4096), pulled))).status).toBe(413);
    expect(pulled.bytes).toBeLessThan(16 * 1024 + 4096 * 2);
    expect((await approveRoute(req({ "content-length": "20000" }, "http://localhost/api/approve"))).status).toBe(413);
  });
  it("approve: malformed callId and a non-boolean decision are 400", async () => {
    const post = (b: unknown) => approveRoute(new Request("http://localhost/api/approve", { method: "POST", body: JSON.stringify(b) }));
    expect((await post({ callId: "call-1", approve: true })).status).toBe(400);
    expect((await post({ callId: "call-" + "a".repeat(24) + "-1", approve: "yes" })).status).toBe(400);
    expect((await post(null)).status).toBe(400);
  });
});

describe("isCrossSite", () => {
  const cases: [string, Record<string, string>, boolean][] = [
    ["no browser headers (non-browser client)", {}, false],
    ["same origin", { origin: "http://localhost" }, false],
    ["same origin with Sec-Fetch-Site", { origin: "http://localhost", "sec-fetch-site": "same-origin" }, false],
    ["address-bar navigation (none)", { "sec-fetch-site": "none" }, false],
    ["foreign origin", { origin: "https://evil.example" }, true],
    ["same host, different port", { origin: "http://localhost:3000" }, true],
    ["sibling subdomain", { origin: "http://app.localhost" }, true],
    ["sec-fetch-site cross-site", { "sec-fetch-site": "cross-site" }, true],
    ["sec-fetch-site same-site (sibling site)", { "sec-fetch-site": "same-site" }, true],
    ["opaque origin 'null'", { origin: "null" }, true],
    ["malformed origin", { origin: "not a url" }, true],
    ["foreign origin but same-origin fetch metadata lies", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }, true],
    ["origin matches the proxy-forwarded host", { origin: "https://atlas.example", "x-forwarded-host": "atlas.example" }, false],
    ["origin matches the Host header", { origin: "https://atlas.example", host: "atlas.example" }, false],
  ];
  for (const [name, headers, expected] of cases) it(`${expected ? "rejects" : "allows"}: ${name}`, () => expect(isCrossSite(req(headers))).toBe(expected));
});

describe("cross-origin requests have no side effects", () => {
  it("no model call, no session cookie, no rate-limit slot is spent", async () => {
    process.env.LLM_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk_test_key_value_should_never_appear";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < 100; i++) {
      const res = await chatRoute(new Request("http://localhost/api/chat", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ message: "hi", security: true }) }));
      expect(res.status).toBe(403);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
    // the same client is not rate limited afterwards, because the rejected requests never counted
    const ok = await chatRoute(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ message: "Why was that denied?", security: true }) }));
    expect(ok.status).toBe(200);
    await ok.text();
    for (const k of ["LLM_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL"]) delete process.env[k];
  });
  it("the read-only health route is not subject to the check", async () => {
    expect((await health()).status).toBe(200);
  });
});
