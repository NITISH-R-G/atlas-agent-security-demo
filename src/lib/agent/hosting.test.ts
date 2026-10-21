// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { POST as chatRoute } from "@/app/api/chat/route";
import { GET as health } from "@/app/api/health/route";
import { acquireSlot, allowChat, allowGlobal, clientIp, isHttps, MAX_INFLIGHT, resetRateLimits } from "./session";

const chat = (init: { headers?: Record<string, string>; body?: string; url?: string } = {}) =>
  chatRoute(new Request(init.url ?? "http://localhost/api/chat", { method: "POST", headers: init.headers, body: init.body ?? JSON.stringify({ message: "hello", security: true }) }));

beforeEach(() => {
  resetRateLimits();
  process.env.ATLAS_SIMULATED_LATENCY = "0";
});

describe("health endpoint", () => {
  it("reports the configured provider and model but no secrets", async () => {
    process.env.LLM_PROVIDER = "groq";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.GROQ_API_KEY = "gsk_test_key_value_should_never_appear";
    const res = await health();
    const text = JSON.stringify(await res.json());
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(text).toContain("openai/gpt-oss-120b");
    expect(text).toContain("groq");
    expect(text).not.toContain("gsk_test_key_value_should_never_appear");
    expect(text).not.toMatch(/api[_-]?key/i);
    delete process.env.GROQ_API_KEY;
  });

  it("says plainly when no provider is configured", async () => {
    const body = (await (await health()).json()) as { status: string; model: { configured: boolean } };
    expect(body.status).toBe("ok");
    expect(body.model.configured).toBe(false);
  });
});

describe("proxy-aware helpers", () => {
  it("detects https from the forwarded protocol", () => {
    expect(isHttps(new Request("http://x/api", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isHttps(new Request("http://x/api"))).toBe(false);
    expect(isHttps(new Request("https://x/api"))).toBe(true);
  });

  it("sets a Secure session cookie behind a TLS-terminating proxy", async () => {
    const res = await chat({ headers: { "x-forwarded-proto": "https" } });
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Strict/);
    await res.text();
  });

  it("accepts only plausible client addresses", () => {
    expect(clientIp(new Request("http://x", { headers: { "fly-client-ip": "203.0.113.9" } }))).toBe("203.0.113.9");
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "evil; drop, 1.2.3.4" } }))).toBeUndefined();
    expect(clientIp(new Request("http://x"))).toBeUndefined();
  });
});

describe("request limits", () => {
  it("rejects oversized bodies", async () => {
    const res = await chat({ body: JSON.stringify({ message: "x".repeat(70_000), security: true }) });
    expect(res.status).toBe(413);
  });

  it("limits a client by IP even when it discards its cookie", async () => {
    let last = 0;
    for (let i = 0; i < 160; i++) {
      const res = await chat({ headers: { "fly-client-ip": "198.51.100.7" }, body: JSON.stringify({ message: "hi", security: true }) });
      last = res.status;
      await res.text();
    }
    expect(last).toBe(429);
  });

  it("applies a global ceiling", () => {
    const now = Date.now();
    let ok = 0;
    for (let i = 0; i < 5; i++) if (allowGlobal(now, 3)) ok++;
    expect(ok).toBe(3);
  });

  it("caps concurrent streams and releases slots exactly once", () => {
    const releases = Array.from({ length: MAX_INFLIGHT }, () => acquireSlot());
    expect(releases.every(Boolean)).toBe(true);
    expect(acquireSlot()).toBeUndefined();
    releases[0]!();
    releases[0]!();
    expect(acquireSlot()).toBeDefined();
    expect(acquireSlot()).toBeUndefined();
  });

  it("keeps per-session limits independent", () => {
    for (let i = 0; i < 61; i++) allowChat("a".repeat(32));
    expect(allowChat("b".repeat(32))).toBe(true);
  });
});
