import { takePending } from "./approvals";
import { recordAudit, type AuditRecord } from "./audit";
import { createContext, executeTool, type ToolOutcome } from "./runtime";

export type AuditView = Omit<AuditRecord, "at">;

export type ApprovalResult =
  | { ok: true; decision: "approved"; outcome: ToolOutcome; audit?: AuditView }
  | { ok: true; decision: "denied"; audit?: AuditView }
  | { ok: false; error: string };

/**
 * Resolves a parked call. Approved calls are re-run through the full runtime pipeline with the policy that
 * was active when they were parked, so approval never skips the other controls.
 */
export async function resolveApproval(
  callId: string,
  approve: boolean,
  opts: { sleep?: (ms: number) => Promise<void>; now?: number; sid?: string } = {},
): Promise<ApprovalResult> {
  const pending = takePending(callId, opts.now, opts.sid);
  if (!pending) return { ok: false, error: "This approval request is unknown or has expired. Nothing was run." };
  if (!approve) {
    // A human refusal is a security decision too: record it when auditing is on, and never execute the call.
    if (!pending.policy.audit) return { ok: true, decision: "denied" };
    const view: AuditView = { callId, tool: pending.tool, target: String(pending.args.to ?? pending.args.id ?? (Array.isArray(pending.args.ids) ? pending.args.ids.join(",") : "-")).slice(0, 60), decision: "denied", layer: "approvalForSensitive", source: pending.source };
    recordAudit({ at: Date.now(), ...view, source: pending.source });
    return { ok: true, decision: "denied", audit: view };
  }
  const ctx = createContext(pending.policy, { state: pending.state, sleep: opts.sleep });
  ctx.sid = pending.sid;
  ctx.source = pending.source;
  ctx.approvedCallId = callId;
  const outcome = await executeTool(ctx, { id: callId, tool: pending.tool, args: pending.args });
  const audit: AuditView | undefined = pending.policy.audit ? { callId, tool: outcome.tool, target: outcome.target, decision: outcome.decision, layer: outcome.layer, source: pending.source } : undefined;
  return { ok: true, decision: "approved", outcome, audit };
}
