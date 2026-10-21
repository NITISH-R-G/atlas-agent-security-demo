import { hasPending, restorePending } from "@/lib/agent/approvals";
import { unsealCall } from "@/lib/agent/seal";
import { resolveApproval } from "@/lib/agent/approve";
import { toView } from "@/lib/agent/planner";
import { readSid } from "@/lib/agent/session";

export const runtime = "nodejs";

/** Resolves a parked sensitive action. Only an explicit user click in the UI calls this. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
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
    if (sealed && sealed.call.callId === callId) restorePending(sealed.call, sealed.at);
  }
  const result = await resolveApproval(callId, approve, { sid: readSid(req) });
  if (!result.ok) return Response.json({ error: { message: result.error } }, { status: 404 });
  if (result.decision === "denied") return Response.json({ decision: "denied", audit: result.audit });
  return Response.json({ decision: "approved", view: toView(result.outcome), audit: result.audit });
}
