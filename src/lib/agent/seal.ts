import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { PendingCall } from "./approvals";

/**
 * Sealed approval tickets. On serverless hosts the request that parks an approval and the request that resolves it may run in
 * different instances, so the parked call travels with the browser as an authenticated-encrypted ticket (AES-256-GCM). The
 * browser cannot read or alter it, and it is still bound to the session cookie, a ten minute expiry and (per instance) single use.
 * Without a configured secret a random per-process key is used: tickets then only verify in the instance that issued them.
 */
const processKey = randomBytes(32);

const keyFor = (secret?: string) => (secret && secret.trim().length >= 16 ? createHash("sha256").update(`atlas-seal:${secret.trim()}`).digest() : processKey);

export function sealCall(call: PendingCall, at: number, secret?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const body = Buffer.concat([c.update(JSON.stringify({ call, at }), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function unsealCall(ticket: string, secret?: string): { call: PendingCall; at: number } | undefined {
  try {
    if (ticket.length > 8192) return undefined;
    const raw = Buffer.from(ticket, "base64url");
    if (raw.length < 29) return undefined;
    const d = createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const parsed = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as { call?: PendingCall; at?: number };
    if (!parsed.call || typeof parsed.call.callId !== "string" || typeof parsed.at !== "number") return undefined;
    return { call: parsed.call, at: parsed.at };
  } catch {
    return undefined;
  }
}
