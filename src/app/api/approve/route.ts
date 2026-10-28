import { hasPending, restorePending } from "@/lib/agent/approvals";
import { isCrossSite, readBoundedText } from "@/lib/agent/http-guard";
import { unsealCall } from "@/lib/agent/seal";
import { resolveApproval } from "@/lib/agent/approve";
import { restoreParkedCall } from "@/lib/agent/ticket";
import { toView } from "@/lib/agent/planner";
import { readSid } from "@/lib/agent/session";

export const runtime = "nodejs";

/** Resolves a parked sensitive action. Only an explicit user click in the UI calls this. */
export async function POST(req: Request) {
  if (isCrossSite(req)) return Response.json({ error: { message: "Cross-site requests are not accepted." } }, { status: 403 });
  let body: unknown;
  try {
    const raw = await readBoundedText(req, 16 * 1024); // a sealed ticket is at most 8 KiB
    if (raw === undefined) return Response.json({ error: { message: "Request is too large." } }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: { message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const { callId, approve, ticket } = (body ?? {}) as { callId?: unknown; approve?: unknown; ticket?: unknown };
  if (typeof callId !== "string" || !/^call-[a-f0-9]{24}-\d{1,4}$/.test(callId) || typeof approve !== "boolean") {
    return Response.json({ error: { message: "callId and approve are required." } }, { status: 400 });
  }
  // The instance that parked this call may not be the one serving this request (serverless). Recover it from a verified ticket.
  if (typeof ticket === "string" && !hasPending(callId)) {
    const sealed = unsealCall(ticket, process.env.ATLAS_SEAL_SECRET);
    // The ticket's content is never an authority: policy, state and the allowed tools are derived server-side (ticket.ts).
    const call = sealed && sealed.call.callId === callId ? restoreParkedCall(sealed.call) : undefined;
    if (call && sealed) restorePending(call, sealed.at);
  }
  const result = await resolveApproval(callId, approve, { sid: readSid(req) });
  if (!result.ok) return Response.json({ error: { message: result.error } }, { status: 404 });
  if (result.decision === "denied") return Response.json({ decision: "denied", audit: result.audit });
  return Response.json({ decision: "approved", view: toView(result.outcome), audit: result.audit });
}
