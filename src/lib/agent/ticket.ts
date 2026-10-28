import type { PendingCall } from "./approvals";
import { policyFor } from "./policy";
import { TOOLS } from "./runtime";
import type { unsealCall } from "./seal";

/**
 * Turns the content of a verified ticket into a parked call the server is willing to resume. A ticket proves that this
 * server (or one sharing its secret) once parked the call; it is not a source of authority. Everything that decides what
 * the call may do is derived here from server configuration:
 *   - the policy is always the protected profile (approvals exist only under it);
 *   - the simulated state is empty (it belongs to one request);
 *   - the tool must be a known, sensitive tool (only those are ever parked), arguments are re-validated by the tool's schema at run time;
 *   - the session id must be well formed, the source one of the server's own values.
 * Returns undefined when the content could not have been produced by a genuine park.
 */
export function restoreParkedCall(sealed: NonNullable<ReturnType<typeof unsealCall>>["call"]): PendingCall | undefined {
  const c = sealed as Partial<PendingCall> | undefined;
  if (!c || typeof c.callId !== "string" || typeof c.tool !== "string") return undefined;
  if (c.policy?.approvalForSensitive !== true) return undefined;
  if (!Object.hasOwn(TOOLS, c.tool) || !TOOLS[c.tool].sensitive) return undefined;
  if (!c.args || typeof c.args !== "object" || Array.isArray(c.args)) return undefined;
  if (typeof c.sid !== "string" || !/^[a-f0-9]{32}$/.test(c.sid)) return undefined;
  const source = c.source === "scripted" || c.source === "builtin" || c.source === "model" ? c.source : undefined;
  return { callId: c.callId, tool: c.tool, args: c.args, policy: policyFor(true), state: { outbox: [] }, sid: c.sid, source };
}
