import type { Decision, Layer } from "./runtime";

/**
 * Server-side audit log (in-memory ring buffer). Written only when the audit control is on.
 * It is never returned by any API route; read it from server code or tests via getAuditLog().
 */
export interface AuditRecord {
  at: number;
  callId: string;
  tool: string;
  target: string;
  decision: Decision;
  layer: Layer;
  /** Where the request came from: a scripted demo scenario, the built-in assistant, or a live model turn. */
  source?: AuditSource;
}

export type AuditSource = "scripted" | "builtin" | "model";

const MAX = 500;
const g = globalThis as unknown as { __atlasAudit?: AuditRecord[] };
const log = (g.__atlasAudit ??= []);

let stdout = false;
/** Set by the server route from configuration; the agent core itself reads no environment. */
export const setAuditStdout = (on: boolean) => void (stdout = on);

export function recordAudit(r: AuditRecord) {
  log.push(r);
  // Opt-in server log line; only tool, target, decision and layer (no data, no credentials).
  if (stdout) console.log(`[audit] ${JSON.stringify(r)}`);
  if (log.length > MAX) log.splice(0, log.length - MAX);
}
export const getAuditLog = (): readonly AuditRecord[] => log.slice();
export const clearAuditLog = () => void (log.length = 0);
