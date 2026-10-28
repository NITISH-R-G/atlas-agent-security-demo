import { isCrossSite, readBoundedText } from "@/lib/agent/http-guard";
import { matchPrepared } from "@/lib/agent/prepared";
import { peekPending } from "@/lib/agent/approvals";
import { sealCall } from "@/lib/agent/seal";
import { setAuditStdout } from "@/lib/agent/audit";
import { runModel } from "@/lib/agent/orchestrator";
import { classify, runAgent, type AgentEvent } from "@/lib/agent/planner";
import { policyFor } from "@/lib/agent/policy";
import { readModelConfig } from "@/lib/agent/provider";
import { parseChatRequest } from "@/lib/agent/request";
import { createContext, syntheticAuthFault } from "@/lib/agent/runtime";
import { acquireSlot, allowChat, allowGlobal, clientIp, IP_LIMIT, isHttps, newSid, readSid, sidCookie } from "@/lib/agent/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 64 * 1024;

const json = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

/**
 * Streams the agent's real events as NDJSON.
 * - The Security switch becomes a server-side policy object; the browser cannot supply individual controls.
 * - With NVIDIA_API_KEY + NEMOTRON_MODEL set, Nemotron converses and may propose tool calls; every call still goes
 *   through the same server-side boundary. Otherwise, or in demo mode, a deterministic planner runs, and says so.
 */
export async function POST(req: Request) {
  if (isCrossSite(req)) return json(403, "cross_site", "Cross-site requests are not accepted.");
  // Bound the request size while reading, even when no length is declared (the app only needs a few KB).
  let body: unknown;
  try {
    const raw = await readBoundedText(req, MAX_BODY);
    if (raw === undefined) return json(413, "too_large", "Request is too large.");
    body = JSON.parse(raw);
  } catch {
    return json(400, "bad_json", "Request body must be valid JSON.");
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return json(400, "bad_request", parsed.message);
  const { message, security, history, demo, fault } = parsed.value;

  // Anonymous session: binds approvals and rate limits to this browser. Not authentication.
  const existing = readSid(req);
  const sid = existing ?? newSid();
  const cookie = existing ? undefined : sidCookie(sid, isHttps(req));
  const limited = (message: string, status = 429, code = "rate_limited") => Response.json({ error: { code, message } }, { status, headers: cookie ? { "Set-Cookie": cookie } : undefined });
  const ip = clientIp(req, !!process.env.FLY_APP_NAME);
  if (ip && !allowChat(`ip:${ip}`, Date.now(), IP_LIMIT)) return limited("Too many requests from this network. Wait a few minutes and try again.");
  if (!allowChat(sid)) return limited("Too many requests from this session. Wait a few minutes and try again.");
  if (!allowGlobal()) return limited("Atlas is receiving a lot of traffic. Wait a few minutes and try again.", 503, "busy");
  const release = acquireSlot();
  if (!release) return limited("Atlas is busy right now. Try again in a moment.", 503, "busy");

  const policy = policyFor(security);
  setAuditStdout(process.env.ATLAS_AUDIT_STDOUT === "1");
  const sleep = process.env.ATLAS_SIMULATED_LATENCY === "0" ? async () => {} : undefined; // tests only
  const ctx = createContext(policy, { sleep });
  if (fault === "authz") ctx.extraChecks = [syntheticAuthFault];

  const config = readModelConfig(process.env);
  const intent = classify(message);
  const secretsAsk = intent === "secrets";
  // Only the explicit prepared prompts take the constrained rule-based path. Everything else is interpreted by the live
  // model, and every action it proposes is enforced by the same server-side runtime.
  const prepared = matchPrepared(message);
  const policyRoute = prepared !== undefined;
  const useModel = !demo && config.ok && !secretsAsk && !policyRoute;
  ctx.sid = sid;
  ctx.source = demo ? "scripted" : useModel ? "model" : "builtin";
  const withTicket = (e: Extract<AgentEvent, { type: "approval" }>): AgentEvent => {
    const parked = peekPending(e.callId);
    return parked ? { ...e, ticket: sealCall(parked.call, parked.at, process.env.ATLAS_SEAL_SECRET) } : e;
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e.type === "approval" ? withTicket(e) : e)}\n`));
        } catch {
          closed = true;
        }
      };
      req.signal.addEventListener("abort", () => (closed = true));
      try {
        if (useModel && config.ok) {
          await runModel({ message, history, policy, ctx, config: config.config, emit, signal: req.signal });
        } else {
          emit({
            type: "model",
            engine: demo || policyRoute ? "scripted" : "deterministic",
            label: demo || policyRoute ? "Rule-based reply (no language model)" : secretsAsk ? "Built-in assistant (credential and configuration requests never reach the model)" : "Built-in assistant (no language model configured)",
            note: demo || policyRoute ? "This answer is produced by fixed rules applied to the server's access policy; no language model was called." : secretsAsk ? "This request was answered without calling any model." : config.ok ? undefined : config.message,
          });
          await runAgent({ message, policy, emit, signal: req.signal, ctx, intent: prepared });
        }
      } catch {
        emit({ type: "error", message: "The assistant hit an error. No sensitive action was completed." });
      } finally {
        release();
        if (!closed) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
}
