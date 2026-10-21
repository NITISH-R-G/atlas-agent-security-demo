import type { SimState } from "./environment";
import type { SecurityPolicy } from "./policy";

/**
 * Parked sensitive calls waiting for a human decision. Only the approval endpoint, driven by an explicit
 * click, can resolve one; model output and retrieved content have no path to this store.
 * In-memory and per-process: a restart drops pending approvals, which fails closed.
 */
export interface PendingCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  policy: SecurityPolicy;
  state: SimState;
  /** Session that parked the action; only that session may resolve it. */
  sid?: string;
  source?: "scripted" | "builtin" | "model";
}

export const TTL_MS = 10 * 60 * 1000;
export const MAX_PENDING = 200;
const g = globalThis as unknown as { __atlasPending?: Map<string, { call: PendingCall; at: number }> };
const store = (g.__atlasPending ??= new Map());

export function savePending(call: PendingCall, now = Date.now()) {
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
  store.set(call.callId, { call, at: now });
  // Bounded: a flood of parked calls evicts the oldest instead of growing without limit.
  while (store.size > MAX_PENDING) store.delete(store.keys().next().value as string);
}

/** Single-use: returns the parked call and removes it, or undefined if unknown/expired. */
export function takePending(callId: string, now = Date.now(), sid?: string): PendingCall | undefined {
  const entry = store.get(callId);
  if (!entry) return undefined;
  // Another session (or no session) cannot resolve it, and a failed attempt leaves the action pending for its owner.
  if (entry.call.sid !== sid) return undefined;
  store.delete(callId);
  markConsumed(callId);
  return now - entry.at > TTL_MS ? undefined : entry.call;
}

const consumed = ((g as unknown as { __atlasConsumed?: Set<string> }).__atlasConsumed ??= new Set<string>());
const markConsumed = (id: string) => {
  consumed.add(id);
  while (consumed.size > 2000) consumed.delete(consumed.values().next().value as string);
};

export function peekPending(callId: string): { call: PendingCall; at: number } | undefined {
  const e = store.get(callId);
  return e ? { call: e.call, at: e.at } : undefined;
}

/** Re-parks a call recovered from a verified ticket. Refuses expired or already-consumed ids. Keeps the original timestamp. */
export function restorePending(call: PendingCall, at: number, now = Date.now()): boolean {
  if (now - at > TTL_MS || consumed.has(call.callId)) return false;
  store.set(call.callId, { call, at });
  while (store.size > MAX_PENDING) store.delete(store.keys().next().value as string);
  return true;
}

export function hasPending(callId: string) {
  return store.has(callId);
}

export function clearPending() {
  store.clear();
  consumed.clear();
}
