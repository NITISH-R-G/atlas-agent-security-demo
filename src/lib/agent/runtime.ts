import { z } from "zod";

import {
  ATLAS_SYNC,
  ATLAS_SYNC_RESPONSE,
  CURRENT_PROJECT,
  RESOURCES,
  RESOURCE_BY_ID,
  USER,
  freshState,
  isInternalAddress,
  type Resource,
  type SimState,
} from "./environment";
import type { SecurityPolicy } from "./policy";
import { savePending } from "./approvals";
import { recordAudit } from "./audit";
import { evalOf, off, type ControlEval } from "./controls";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Decision = "granted" | "denied" | "untrusted_blocked" | "approval_required" | "invalid" | "error";
export type Layer =
  | "toolAllowlist"
  | "trustValidation"
  | "leastPrivilege"
  | "scopedCredentials"
  | "resourceAuthz"
  | "approvalForSensitive"
  | "failClosed"
  | "validation"
  | "none";

export interface ToolCall {
  id: string;
  tool: string;
  args: unknown;
}

export interface ToolOutcome {
  callId: string;
  tool: string;
  label: string;
  /** Short human summary of the target, e.g. a resource id. */
  target: string;
  decision: Decision;
  /** The control that decided (or "none" when nothing objected). */
  layer: Layer;
  reason: string;
  status: "ok" | "blocked" | "pending" | "error";
  data?: unknown;
  redactions: number;
  /** Inline status messages, each backed by this actual execution event. */
  notices: string[];
  untrustedOutput: boolean;
  latencyMs: number;
  /** Per-control evaluations that actually ran for this call, in order. */
  evals: ControlEval[];
  /** The permission the call needs (for example records:export), derived from the tool definition and validated arguments. */
  action?: string;
  /** Who the action ran as: the configured user and the privilege level this profile gives the agent. */
  principal: string;
  /** Where the tool comes from and how far it is trusted (server configuration, never the model's claim). */
  source: string;
}

export interface Identity {
  id: string;
  scopes: string[];
}
export interface Token {
  id: string;
  scopes: string[];
  expiresAt: number;
  synthetic: true;
}

export interface AuditEvent {
  at: number;
  tool: string;
  target: string;
  decision: Decision;
  layer: Layer;
}

export type Check = (call: ToolCall, ctx: Context) => { ok: true } | { ok: false; layer: Layer; reason: string; decision?: Decision };

export interface Context {
  policy: SecurityPolicy;
  identity: Identity;
  token: Token;
  state: SimState;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  audit: AuditEvent[];
  /** Session that owns this run (bound to any approval it parks). */
  sid?: string;
  source?: "scripted" | "builtin" | "model";
  /** Only the approval endpoint sets this, for a call it previously parked. */
  approvedCallId?: string;
  /** Test seam: extra checks evaluated alongside the built-in ones. */
  extraChecks?: Check[];
}

/* ------------------------------------------------------------------ */
/* Identity and credentials                                            */
/* ------------------------------------------------------------------ */

export const NARROW_SCOPES = ["kb:read", "project:lighthouse:read", "doc:lighthouse:read", "message:send"];
export const TOKEN_TTL_MS = 5 * 60 * 1000;

export function createContext(policy: SecurityPolicy, opts: Partial<Pick<Context, "now" | "sleep" | "state">> = {}): Context {
  const now = opts.now ?? (() => Date.now());
  return {
    policy,
    // A fictional service account. Excessive in the vulnerable profile, task-sized in the protected one.
    identity: { id: "atlas-agent@atlas-labs.example", scopes: policy.leastPrivilege ? [...NARROW_SCOPES] : ["*"] },
    // A simulated credential: long-lived and broad, or scoped to the task and short-lived.
    token: policy.scopedCredentials
      ? { id: "svc-token-scoped", scopes: [...NARROW_SCOPES], expiresAt: now() + TOKEN_TTL_MS, synthetic: true }
      : { id: "svc-token-wide", scopes: ["*"], expiresAt: Number.POSITIVE_INFINITY, synthetic: true },
    state: opts.state ?? freshState(),
    now,
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    audit: [],
  };
}

// Anything that is not a real array of scopes grants nothing (a string like "*" must not match via String.includes).
const grants = (scopes: unknown, needed: string) => Array.isArray(scopes) && (scopes.includes("*") || scopes.includes(needed));

/* ------------------------------------------------------------------ */
/* Tool registry                                                       */
/* ------------------------------------------------------------------ */

interface ToolDef {
  name: string;
  /** The kind of resource this tool is allowed to return; any other kind is treated as an unknown resource. */
  kind?: Resource["kind"];
  label: string;
  args: z.ZodType<Record<string, unknown>>;
  sensitive: boolean;
  approved: boolean; // on the allowlist
  provenance: { signed: boolean; pinned: boolean; publisherVerified: boolean };
  latencyMs: number;
  untrustedOutput?: boolean;
  scope: (args: Record<string, unknown>) => string;
  resource?: (args: Record<string, unknown>) => string | undefined;
  run: (args: Record<string, unknown>, ctx: Context) => unknown;
}

const FIRST_PARTY = { signed: true, pinned: true, publisherVerified: true };
const id = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/);

const redact = (r: Resource, on: boolean): { fields: Record<string, string>; redacted: string[]; protectedPresent: string[] } => {
  const redacted: string[] = [];
  const protectedPresent: string[] = [];
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.fields)) {
    if (r.protectedFields.includes(k)) protectedPresent.push(k);
    if (on && r.protectedFields.includes(k)) {
      fields[k] = "[filtered]";
      redacted.push(k);
    } else fields[k] = v;
  }
  return { fields, redacted, protectedPresent };
};

const resourceMeta = new WeakMap<object, { redacted: string[]; protectedPresent: string[] }>();

const readResource = (rid: string, ctx: Context) => {
  const r = RESOURCE_BY_ID.get(rid)!;
  const { fields, redacted, protectedPresent } = redact(r, ctx.policy.outputFiltering);
  const out = { id: r.id, title: r.title, classification: r.classification, untrusted: !!r.untrusted, fields };
  resourceMeta.set(out, { redacted, protectedPresent });
  return out;
};

export const TOOLS: Record<string, ToolDef> = {
  search_kb: {
    name: "search_kb",
    label: "Search knowledge base",
    args: z.object({ query: z.string().min(1).max(200) }).strict(),
    sensitive: false,
    approved: true,
    provenance: FIRST_PARTY,
    latencyMs: 350,
    scope: () => "kb:read",
    run: (a) => {
      const words = String(a.query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const hits = RESOURCES.filter((r) => r.kind === "kb")
        .map((r) => ({ r, score: words.filter((w) => `${r.title} ${r.fields.body}`.toLowerCase().includes(w)).length }))
        .filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 3)
        .map(({ r }) => ({ id: r.id, title: r.title, snippet: r.fields.body }));
      return { hits };
    },
  },
  get_project: {
    name: "get_project",
    kind: "project",
    label: "Get project record",
    args: z.object({ id }).strict(),
    sensitive: false,
    approved: true,
    provenance: FIRST_PARTY,
    latencyMs: 450,
    scope: (a) => RESOURCE_BY_ID.get(String(a.id))?.requiredScope ?? "project:unknown:read",
    resource: (a) => String(a.id),
    run: (a, ctx) => readResource(String(a.id), ctx),
  },
  list_documents: {
    name: "list_documents",
    label: "List project files",
    args: z.object({ projectId: id }).strict(),
    sensitive: false,
    approved: true,
    provenance: FIRST_PARTY,
    latencyMs: 300,
    scope: () => "doc:lighthouse:read",
    run: (a) => {
      const files = RESOURCES.filter((r) => r.kind === "document" && r.audience.includes(USER.team) && a.projectId === CURRENT_PROJECT).map((r) => ({
        id: r.id,
        title: r.title,
      }));
      return { files };
    },
  },
  read_document: {
    name: "read_document",
    kind: "document",
    label: "Read document",
    args: z.object({ id }).strict(),
    sensitive: false,
    approved: true,
    provenance: FIRST_PARTY,
    latencyMs: 400,
    scope: (a) => RESOURCE_BY_ID.get(String(a.id))?.requiredScope ?? "doc:unknown:read",
    resource: (a) => String(a.id),
    run: (a, ctx) => readResource(String(a.id), ctx),
  },
  fetch_updates: {
    name: "fetch_updates",
    label: "Fetch updates (Atlas Sync plugin)",
    args: z.object({ projectId: id }).strict(),
    sensitive: false,
    approved: false,
    provenance: { signed: ATLAS_SYNC.signed, pinned: ATLAS_SYNC.pinned, publisherVerified: ATLAS_SYNC.publisherVerified },
    latencyMs: 700,
    untrustedOutput: true,
    scope: () => "project:lighthouse:read",
    run: () => ({ ...ATLAS_SYNC_RESPONSE }),
  },
  send_message: {
    name: "send_message",
    label: "Send message",
    args: z
      .object({ to: z.string().email().max(120), subject: z.string().min(1).max(120), body: z.string().min(1).max(4000) })
      .strict(),
    sensitive: true,
    approved: true,
    provenance: FIRST_PARTY,
    latencyMs: 400,
    scope: () => "message:send",
    resource: (a) => String(a.to),
    // Simulation only: "sending" appends to an in-memory outbox. There is no network.
    run: (a, ctx) => {
      const m = { id: `msg-${ctx.state.outbox.length + 1}`, to: String(a.to), subject: String(a.subject), body: String(a.body) };
      ctx.state.outbox.push(m);
      return { delivered: "outbox", id: m.id, to: m.to };
    },
  },
  export_records: {
    name: "export_records",
    kind: "customer",
    label: "Export customer records",
    args: z.object({ ids: z.array(id).min(1).max(5) }).strict(),
    sensitive: true,
    approved: false,
    provenance: FIRST_PARTY,
    latencyMs: 500,
    scope: () => "records:export",
    resource: (a) => (a.ids as string[]).join(","),
    run: (a, ctx) => ({ records: (a.ids as string[]).filter((i) => RESOURCE_BY_ID.has(i)).map((i) => readResource(i, ctx)) }),
  },
};

/* ------------------------------------------------------------------ */
/* Execution pipeline                                                  */
/* ------------------------------------------------------------------ */

const DECISION_NOTICE: Record<string, string> = {
  denied: "Permission denied",
  untrusted_blocked: "Untrusted tool blocked",
  approval_required: "Approval required",
};

const scopeSummary = (scopes: unknown) => (Array.isArray(scopes) ? (scopes.includes("*") ? "all scopes (*)" : `${scopes.length} scoped permissions`) : "no valid scope list");

type Failure = { layer: Layer; reason: string; decision?: Decision };

/**
 * Runs the pre-execution checks in order, recording one ControlEval per control actually evaluated.
 * Stops at the first failure. A thrown error is handled by the failClosed control.
 */
function runChecks(def: ToolDef, call: ToolCall, ctx: Context, args: Record<string, unknown>, evals: ControlEval[]): Failure | undefined {
  const p = ctx.policy;
  let failure: Failure | undefined;
  try {
    // 1. Trust and provenance
    const prov = def.provenance;
    const trusted = prov.signed && prov.pinned && prov.publisherVerified;
    if (!p.trustValidation) evals.push(off("trustValidation"));
    else if (trusted) evals.push(evalOf("trustValidation", "allowed", "provenance_verified", `${def.label}: signed, pinned, verified publisher.`));
    else {
      evals.push(evalOf("trustValidation", "blocked", "provenance_failed", `${def.label}: unsigned, unpinned, unverified publisher (server config).`));
      failure = { layer: "trustValidation", decision: "untrusted_blocked", reason: "Provenance check failed: the plugin is unsigned, unpinned and from an unverified publisher." };
    }

    // 2. Tool allowlist
    if (!failure) {
      if (!p.toolAllowlist) evals.push(off("toolAllowlist"));
      else if (def.approved) evals.push(evalOf("toolAllowlist", "allowed", "on_allowlist", `${def.name} is on the approved tool list.`));
      else {
        evals.push(evalOf("toolAllowlist", "blocked", "not_on_allowlist", `${def.name} is not on the approved tool list.`));
        failure = { layer: "toolAllowlist", reason: `${def.name} is not on the approved tool list.` };
      }
    }

    // 3. Identity (least privilege)
    const needed = def.scope(args);
    if (!failure) {
      if (!grants(ctx.identity.scopes, needed)) {
        evals.push(evalOf("leastPrivilege", "blocked", "scope_missing", `Needs ${needed}; identity holds ${scopeSummary(ctx.identity.scopes)}.`));
        failure = { layer: "leastPrivilege", reason: `The agent identity does not hold the scope ${needed}.` };
      } else if (!p.leastPrivilege) evals.push(evalOf("leastPrivilege", "not_applicable", "broad_identity", `Identity holds ${scopeSummary(ctx.identity.scopes)}; not narrowed in this profile.`, "documented"));
      else evals.push(evalOf("leastPrivilege", "allowed", "scope_granted", `Needs ${needed}; identity holds ${scopeSummary(ctx.identity.scopes)}.`));
    }

    // 4. Credential scope and expiry
    if (!failure) {
      if (ctx.now() > ctx.token.expiresAt) {
        evals.push(evalOf("scopedCredentials", "blocked", "credential_expired", "The synthetic credential has expired."));
        failure = { layer: "scopedCredentials", reason: "The short-lived credential has expired." };
      } else if (!grants(ctx.token.scopes, needed)) {
        evals.push(evalOf("scopedCredentials", "blocked", "scope_missing", `Needs ${needed}; credential holds ${scopeSummary(ctx.token.scopes)}.`));
        failure = { layer: "scopedCredentials", reason: `The task credential is not scoped for ${needed}.` };
      } else if (!p.scopedCredentials) evals.push(evalOf("scopedCredentials", "not_applicable", "broad_credential", `Credential holds ${scopeSummary(ctx.token.scopes)} and does not expire in this profile.`, "documented"));
      else evals.push(evalOf("scopedCredentials", "allowed", "scope_and_expiry_ok", `Needs ${needed}; credential holds ${scopeSummary(ctx.token.scopes)} and has not expired.`));
    }

    // 5. Resource-level authorization
    if (!failure) {
      if (!p.resourceAuthz) evals.push(off("resourceAuthz"));
      else {
        const rid = def.resource?.(args);
        const r = rid ? RESOURCE_BY_ID.get(rid) : undefined;
        if (r && !r.audience.includes(USER.team)) {
          evals.push(evalOf("resourceAuthz", "blocked", "not_in_audience", `${r.id} is limited to: ${r.audience.join(", ")}.`));
          failure = { layer: "resourceAuthz", reason: `${USER.name}'s team is not in the audience for ${r.title}.` };
        } else if (def.name === "send_message" && !isInternalAddress(String(args.to))) {
          evals.push(evalOf("resourceAuthz", "blocked", "external_recipient", "Messages may only go to internal recipients."));
          failure = { layer: "resourceAuthz", reason: "Messages may only go to internal recipients." };
        } else if (def.name === "export_records") {
          evals.push(evalOf("resourceAuthz", "blocked", "not_in_audience", "Customer records are outside this user's audience."));
          failure = { layer: "resourceAuthz", reason: "Customer records are outside this user's audience." };
        } else if (r) evals.push(evalOf("resourceAuthz", "allowed", "in_audience", `${r.id} is open to the ${USER.team} team.`));
        else evals.push(evalOf("resourceAuthz", "allowed", "recipient_ok", "Recipient is internal."));
      }
    }

    // 6. Extra checks (test and demo seam)
    if (!failure) {
      for (const c of ctx.extraChecks ?? []) {
        const r = c(call, ctx);
        if (!r.ok) {
          failure = r;
          break;
        }
      }
    }
  } catch {
    if (p.failClosed) {
      evals.push(evalOf("failClosed", "blocked", "check_error", "A required authorization check could not complete, so the action was denied."));
      failure = { layer: "failClosed", reason: "A policy check failed to evaluate, so the action was denied." };
    } else {
      evals.push(evalOf("failClosed", "indeterminate", "fail_open", "A check errored and was ignored. This profile fails open, a defined weakness inside the synthetic runtime.", "documented"));
    }
  }
  return failure;
}

/** The configured principal and privilege level for this run. It is derived from the server-side policy, never from conversation text. */
export function principalLabel(ctx: Context): string {
  const scopes = ctx.identity.scopes;
  const level = Array.isArray(scopes) && scopes.includes("*") ? "unrestricted agent token (all scopes)" : "project member (scoped to the Lighthouse team)";
  return `${USER.name} · ${level}`;
}

/** Provenance of a tool, from server configuration. */
export function sourceLabel(tool: string): string {
  const def = Object.hasOwn(TOOLS, tool) ? TOOLS[tool] : undefined;
  if (!def) return "unknown tool";
  const p = def.provenance;
  return p.signed && p.pinned && p.publisherVerified ? "first-party tool, verified" : "third-party plugin, unsigned and unverified";
}

/** The permission a call needs, from the server's tool definition. Never taken from the model's description of the call. */
export function actionLabel(call: ToolCall): string | undefined {
  const def = Object.hasOwn(TOOLS, call.tool) ? TOOLS[call.tool] : undefined;
  if (!def) return undefined;
  try {
    return def.scope(call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {});
  } catch {
    return undefined;
  }
}

export async function executeTool(ctx: Context, call: ToolCall): Promise<ToolOutcome> {
  const evals: ControlEval[] = [];
  const base = { callId: call.id, tool: call.tool, redactions: 0, notices: [] as string[], untrustedOutput: false, latencyMs: 0, evals };
  const finish = (o: Omit<ToolOutcome, keyof typeof base | "notices" | "principal" | "source"> & { notices?: string[] } & Partial<typeof base>): ToolOutcome => {
    evals.push(ctx.policy.audit ? evalOf("audit", "allowed", "recorded", "Decision recorded in the in-memory server audit log.", "documented") : off("audit"));
    const out: ToolOutcome = { ...base, ...o, notices: o.notices ?? [], principal: principalLabel(ctx), source: sourceLabel(call.tool), action: actionLabel(call) };
    if (ctx.policy.audit) {
      ctx.audit.push({ at: ctx.now(), tool: out.tool, target: out.target, decision: out.decision, layer: out.layer });
      recordAudit({ at: ctx.now(), callId: out.callId, tool: out.tool, target: out.target, decision: out.decision, layer: out.layer, source: ctx.source });
    }
    return out;
  };

  const def = Object.hasOwn(TOOLS, call.tool) ? TOOLS[call.tool] : undefined;
  if (!def) {
    return finish({ label: call.tool, target: "-", decision: "invalid", layer: "validation", reason: "Unknown tool.", status: "blocked", notices: ["Permission denied"] });
  }

  // Argument validation is an essential platform protection and is always on.
  const parsed = def.args.safeParse(call.args);
  if (!parsed.success) {
    return finish({ label: def.label, target: "-", decision: "invalid", layer: "validation", reason: "Invalid arguments.", status: "blocked", notices: ["Permission denied"] });
  }
  const args = parsed.data;
  // Type confusion and existence guard (platform validation, always on): a tool returns only existing resources of its own kind.
  if (def.kind) {
    const ids = Array.isArray(args.ids) ? (args.ids as string[]) : args.id !== undefined ? [String(args.id)] : [];
    if (ids.some((x) => RESOURCE_BY_ID.get(x)?.kind !== def.kind)) {
      return finish({ label: def.label, target: "-", decision: "invalid", layer: "validation", reason: "Unknown resource.", status: "blocked", notices: ["Permission denied"] });
    }
  }
  const target = def.resource?.(args) ?? Object.values(args).map(String)[0] ?? "-";
  const targetShort = String(target).slice(0, 60);

  const failure = runChecks(def, call, ctx, args, evals);
  if (failure) {
    const decision = failure.decision ?? "denied";
    return finish({ label: def.label, target: targetShort, decision, layer: failure.layer, reason: failure.reason, status: "blocked", notices: [DECISION_NOTICE[decision]] });
  }

  if (def.sensitive) {
    if (ctx.policy.approvalForSensitive) {
      if (ctx.approvedCallId === call.id) {
        evals.push(evalOf("approvalForSensitive", "allowed", "approved_by_user", "You approved this exact action."));
      } else {
        savePending({ callId: call.id, tool: def.name, args, policy: ctx.policy, state: ctx.state, sid: ctx.sid, source: ctx.source });
        evals.push(evalOf("approvalForSensitive", "blocked", "approval_pending", `${def.label} is held until you approve it.`));
        return finish({ label: def.label, target: targetShort, decision: "approval_required", layer: "approvalForSensitive", reason: "This action needs your approval before it can run.", status: "pending", notices: ["Approval required"] });
      }
    } else {
      evals.push(evalOf("approvalForSensitive", "not_applicable", "no_approval_step", "A sensitive action ran without an approval step in this profile.", "documented"));
    }
  }

  try {
    await ctx.sleep(def.latencyMs);
    const data = def.run(args, ctx);
    const meta = collectMeta(data);
    if (meta.hasResource) {
      if (ctx.policy.outputFiltering) {
        evals.push(
          meta.redacted.length
            ? evalOf("outputFiltering", "blocked", "fields_withheld", `Withheld before reaching the model or you: ${[...new Set(meta.redacted)].join(", ")}.`)
            : evalOf("outputFiltering", "allowed", "nothing_protected", "No protected fields in this result."),
        );
      } else if (meta.protectedPresent.length) {
        evals.push(evalOf("outputFiltering", "not_applicable", "returned_unfiltered", `Protected fields were returned unfiltered in this profile: ${[...new Set(meta.protectedPresent)].join(", ")}.`, "documented"));
      } else evals.push(off("outputFiltering"));
    }
    return finish({
      label: def.label,
      target: targetShort,
      decision: "granted",
      layer: "none",
      reason: "Allowed by the active policy.",
      status: "ok",
      data,
      redactions: meta.redacted.length,
      notices: ["Access granted", ...(meta.redacted.length > 0 ? ["Sensitive content filtered"] : [])],
      untrustedOutput: !!def.untrustedOutput || !!(data as { untrusted?: boolean })?.untrusted,
      latencyMs: def.latencyMs,
    });
  } catch {
    // Sensitive operations never report success after an execution error.
    return finish({ label: def.label, target: targetShort, decision: "error", layer: "none", reason: "The tool failed.", status: "error" });
  }
}

function collectMeta(data: unknown) {
  const meta = { hasResource: false, redacted: [] as string[], protectedPresent: [] as string[] };
  const visit = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const m = resourceMeta.get(o as object);
    if (m) {
      meta.hasResource = true;
      meta.redacted.push(...m.redacted);
      meta.protectedPresent.push(...m.protectedPresent);
    }
  };
  visit(data);
  for (const r of (data as { records?: object[] } | undefined)?.records ?? []) visit(r);
  return meta;
}

/** Demo-only fault injection: simulates the authorization service being unavailable for sensitive tools. */
export const syntheticAuthFault: Check = (call) => {
  if (TOOLS[call.tool]?.sensitive) throw new Error("synthetic authorization service unavailable");
  return { ok: true };
};
