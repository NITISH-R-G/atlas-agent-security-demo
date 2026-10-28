import { buildAnswer, type Answer, type Block } from "./answer";
import { scanUntrusted, extractDirectives, stripDirectives } from "./content";
import type { ControlEval } from "./controls";
import type { AuditRecord } from "./audit";
import { CURRENT_PROJECT, RESOURCE_BY_ID, USER } from "./environment";
import type { SecurityPolicy } from "./policy";
import { createContext, executeTool, type Context, type ToolOutcome } from "./runtime";

/* ------------------------------------------------------------------ */
/* Events streamed to the UI. Every one is emitted by a real action.   */
/* ------------------------------------------------------------------ */

export interface ToolView {
  callId: string;
  tool: string;
  label: string;
  target: string;
  decision: ToolOutcome["decision"];
  layer: ToolOutcome["layer"];
  reason: string;
  status: ToolOutcome["status"];
  notices: string[];
  redactions: number;
  evals: ControlEval[];
  principal: string;
  source: string;
}

export type AgentEvent =
  | { type: "step"; id: string; kind: "search" | "check" | "tool" | "validate" | "reason"; text: string; state: "running" | "done" | "failed" }
  | { type: "tool"; view: ToolView }
  | { type: "approval"; callId: string; label: string; summary: string; ticket?: string }
  | { type: "delta"; text: string }
  | { type: "content"; source: string; found: number; evals: ControlEval[] }
  | { type: "audit"; record: Omit<AuditRecord, "at"> }
  | { type: "model"; engine: "llm" | "scripted" | "deterministic"; label: string; note?: string }
  | { type: "answer"; program: string; plain: string; fallback?: { program: string; plain: string } }
  | { type: "error"; message: string };

export type Emit = (e: AgentEvent) => void;

export const toView = (o: ToolOutcome): ToolView => ({
  callId: o.callId,
  tool: o.tool,
  label: o.label,
  target: o.target,
  decision: o.decision,
  layer: o.layer,
  reason: o.reason,
  status: o.status,
  notices: o.notices,
  redactions: o.redactions,
  evals: o.evals,
  principal: o.principal,
  source: o.source,
});

/* ------------------------------------------------------------------ */
/* Intent routing (deterministic)                                      */
/* ------------------------------------------------------------------ */

export type Intent =
  | "secrets"
  | "restricted_lookup"
  | "export_request"
  | "explain"
  | "send_summary"
  | "review_files"
  | "latest_updates"
  | "notes_report"
  | "summarize_text"
  | "project_status"
  | "kb_search"
  | "general";

/** Requests to reveal the system prompt, credentials, environment or configuration. The assistant has no access to any of these. */
const SECRETS_ASK =
  /(reveal|show|print|dump|display|leak|share|tell me|give me|what('| i)?s|what is|expose|output|list|repeat)\b[^.?!]{0,60}\b(system prompt|hidden instructions?|your (instructions|configuration|config|secrets?|credentials?|api[ -]?keys?|keys|environment|env\b)|environment variables?|process\.env|api[ -]?keys?\b[^.?!]{0,20}\byou\b)/;

/** Requests the rule-based planner always handles: the outcome is decided by the server policy, never by a model's wording. */
export const POLICY_INTENTS: ReadonlySet<Intent> = new Set<Intent>(["restricted_lookup", "export_request", "latest_updates", "send_summary", "review_files", "explain"]);

const ROLE_CLAIM = /(i am|i'm|as|acting as|speaking as)\s+(the\s+|an?\s+)?(admin|administrator|ceo|cfo|owner|executive|manager|security|root|superuser)|admin(istrator)?\s+(mode|override|access|privileges?)|\b(authori[sz]ed|elevated|sudo|override|grant me)\b/;
export const claimsPrivilege = (message: string) => ROLE_CLAIM.test(message.normalize("NFKC").toLowerCase());

export function classify(message: string): Intent {
  const m = message.normalize("NFKC").toLowerCase();
  if (SECRETS_ASK.test(m)) return "secrets";
  if (/\bwhy\b[^.?!]{0,60}\b(denied|blocked|rejected|refused|declined|not allowed|couldn'?t|can'?t|didn'?t)\b|\b(explain|what happened)\b[^.?!]{0,40}\b(denial|block|decision|rejection|that)\b/.test(m)) return "explain";
  if (/nightingale|compensation|salary|pay band|payroll/.test(m)) return "restricted_lookup";
  if (/\b(export|download|dump|pull|extract)\b[^.?!]{0,50}\b(customers?|records?|cust-\d+)/.test(m)) return "export_request";
  if (/(atlas sync|sync plugin|sync update|the plugin)/.test(m)) return "latest_updates";
  if (/\b(send|email|share|forward)\b/.test(m) && /(summary|update|team|status)/.test(m)) return "send_summary";
  if (/review/.test(m) && /(file|document|folder)/.test(m)) return "review_files";
  if (/(latest|recent|new)/.test(m) && /update/.test(m)) return "latest_updates";
  if (/report/.test(m) && /notes?/.test(m)) return "notes_report";
  if (/summari[sz]e/.test(m) && /(document|text|article|notes?|brief)/.test(m)) return "summarize_text";
  if (/(project|lighthouse)/.test(m) && /(status|summari[sz]e|progress|how is)/.test(m)) return "project_status";
  if (/(policy|expense|vpn|onboard|how do i|knowledge|search|find)/.test(m)) return "kb_search";
  return "general";
}

/* ------------------------------------------------------------------ */
/* Untrusted-content handling                                          */
/* ------------------------------------------------------------------ */

export interface PlannedAction {
  tool: "read_document" | "get_project" | "send_message";
  args: Record<string, unknown>;
}

export { extractDirectives, stripDirectives };

/** Simulates a gullible model: it turns instruction-looking text in data into actions. */
export function actionsFromDirective(directive: string): PlannedAction[] {
  const out: PlannedAction[] = [];
  for (const id of directive.match(/\b(?:doc|proj)-[a-z0-9-]+/g) ?? []) {
    out.push({ tool: id.startsWith("doc-") ? "read_document" : "get_project", args: { id } });
  }
  const to = directive.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  if (to && /(send|forward|email)/i.test(directive)) out.push({ tool: "send_message", args: { to, subject: "Project update", body: "" } });
  return out;
}

/* ------------------------------------------------------------------ */
/* Summarizing helpers                                                 */
/* ------------------------------------------------------------------ */

export function summarizeText(text: string, max = 4): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  const keyed = /(goal|decision|risk|deadline|milestone|todo|owner|agreed|must|should)/i;
  return sentences
    .map((s, i) => ({ s, score: (keyed.test(s) ? 2 : 0) + (i === 0 ? 3 : 0) + (i < 3 ? 1 : 0) - i * 0.01, i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

function suggestionsFor(title: string, body: string): string[] {
  const out: string[] = [];
  for (const t of body.match(/TODO:[^.]*\./g) ?? []) out.push(`${title}: resolve "${t.replace(/^TODO:\s*/, "").replace(/\.$/, "")}".`);
  const q = body.match(/Open question:[^?]*\?/);
  if (q) out.push(`${title}: settle the open question (${q[0].replace(/^Open question:\s*/, "")}).`);
  if (/delivery|vendor/i.test(body) && /Oct 25/.test(body)) out.push("Vendor delivery on Oct 25 leaves little room before the Nov 12 beta; agree a fallback.");
  return out;
}

/* ------------------------------------------------------------------ */
/* The agent                                                           */
/* ------------------------------------------------------------------ */

export interface RunOptions {
  message: string;
  policy: SecurityPolicy;
  emit: Emit;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  runId?: string;
  ctx?: Context;
}

export interface RunResult {
  intent: Intent;
  outcomes: ToolOutcome[];
  ctx: Context;
  answer?: Answer;
}

function deniedBlocks(o: ToolOutcome, what: string, claimed: boolean): Block[] {
  const approval = o.decision === "approval_required";
  const lines: Block[] = [
    {
      kind: "p",
      text: approval
        ? `Approval required: ${what} needs a person to confirm it. Nothing was shared.`
        : `Access denied. Resource access restricted: ${what} is limited to teams that ${USER.name} (a Lighthouse project member) is not part of.`,
    },
  ];
  if (claimed && !approval) lines.push({ kind: "p", text: "Saying you are an administrator doesn't change this. Permissions come from the signed-in user on the server, not from the conversation, and approval cannot replace a missing permission." });
  lines.push({ kind: "p", text: "I can still help with Project Lighthouse: its status, latest updates or a summary for the team." });
  return lines;
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { message, policy, emit } = opts;
  const ctx = opts.ctx ?? createContext(policy, { sleep: opts.sleep, now: opts.now });
  const outcomes: ToolOutcome[] = [];
  let n = 0;
  const runId = opts.runId ?? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 24);

  const stepText: Record<string, [string, "search" | "check" | "tool" | "validate"]> = {
    search_kb: ["Searching the knowledge base", "search"],
    get_project: ["Retrieving the project record", "search"],
    list_documents: ["Listing project files", "search"],
    read_document: ["Checking a document", "check"],
    fetch_updates: ["Fetching updates through the Atlas Sync plugin", "tool"],
    send_message: ["Validating a request to send a message", "validate"],
    export_records: ["Validating a records export", "validate"],
  };

  async function call(tool: string, args: Record<string, unknown>, detail?: string): Promise<ToolOutcome> {
    const callId = `call-${runId}-${++n}`;
    const [text, kind] = stepText[tool] ?? [`Calling ${tool}`, "tool"];
    emit({ type: "step", id: callId, kind, text: detail ? `${text}: ${detail}` : text, state: "running" });
    const outcome = await executeTool(ctx, { id: callId, tool, args });
    outcomes.push(outcome);
    emit({ type: "tool", view: toView(outcome) });
    if (policy.audit) emit({ type: "audit", record: { callId: outcome.callId, tool: outcome.tool, target: outcome.target, decision: outcome.decision, layer: outcome.layer, source: ctx.source } });
    emit({ type: "step", id: callId, kind, text: detail ? `${text}: ${detail}` : text, state: outcome.status === "ok" ? "done" : "failed" });
    if (outcome.status === "pending") {
      emit({ type: "approval", callId, label: outcome.label, summary: describe(tool, args) });
    }
    return outcome;
  }

  const describe = (tool: string, args: Record<string, unknown>) =>
    tool === "send_message" ? `Send "${String(args.subject)}" to ${String(args.to)}` : `${tool} ${JSON.stringify(args)}`;

  const fieldsOf = (o: ToolOutcome) => (o.data as { fields?: Record<string, string> } | undefined)?.fields ?? {};
  const titleOf = (o: ToolOutcome) => (o.data as { title?: string } | undefined)?.title ?? "record";

  /**
   * Handles instructions embedded in retrieved content. With content isolation they are data and ignored.
   * Without it, the simulated gullible agent follows them using its own identity.
   */
  async function handleUntrusted(text: string, source: string, summaryForBody: string) {
    const scan = scanUntrusted(text, source, policy);
    emit({ type: "content", source, found: scan.directives.length, evals: scan.evals });
    const directives = scan.directives;
    if (directives.length === 0) return { followed: [] as ToolOutcome[], leaked: [] as Block[], ignored: false };
    if (!scan.follow) {
      emit({ type: "step", id: `ignore-${++n}`, kind: "check", text: `Ignored instructions found inside ${source} (treated as untrusted data)`, state: "done" });
      return { followed: [], leaked: [], ignored: true };
    }
    const followed: ToolOutcome[] = [];
    const leaked: Block[] = [];
    for (const d of directives) {
      for (const a of actionsFromDirective(d)) {
        const args = a.tool === "send_message" ? { ...a.args, body: summaryForBody.slice(0, 1500) || "Update" } : a.args;
        const o = await call(a.tool, args);
        followed.push(o);
        if (o.status === "ok" && a.tool !== "send_message") {
          leaked.push({ kind: "report", title: `${titleOf(o)} (requested by ${source})`, points: Object.entries(fieldsOf(o)).map(([k, v]) => `${k}: ${v}`) });
        }
      }
    }
    return { followed, leaked, ignored: false };
  }

  const sanitize = (t: string) => (policy.injectionFiltering ? stripDirectives(t) : t);
  const declined = (os: ToolOutcome[]) =>
    os.some((o) => o.status === "blocked")
      ? [{ kind: "p", text: "One request found in that content was not allowed by the access policy, so I did not carry it out." } as Block]
      : [];
  const sentNote = (os: ToolOutcome[]) =>
    os
      .filter((o) => o.tool === "send_message" && o.status === "ok")
      .map((o) => ({ kind: "p", text: `The plugin output told me to send this to ${o.target}, and I did: it is in the outbox.` }) as Block);

  const finish = (blocks: Block[]) => {
    const answer = buildAnswer(blocks);
    emit({ type: "answer", ...answer });
    return { intent, outcomes, ctx, answer };
  };

  const intent = classify(message);
  const failed = (blocks: Block[]) => finish(blocks);

  try {
    switch (intent) {
      case "secrets":
        return finish([
          { kind: "p", text: "I can't share credentials, server configuration or my instructions, and I have no access to API keys or environment variables. That holds whoever is asking and whatever the Security setting is." },
          { kind: "p", text: "If you are troubleshooting, the person running the server can check its configuration. I can still help with projects, documents, the knowledge base or your notes." },
        ]);

      case "project_status": {
        const o = await call("get_project", { id: CURRENT_PROJECT });
        if (o.status !== "ok") return failed([{ kind: "p", text: "I couldn't retrieve the project record just now." }]);
        const f = fieldsOf(o);
        return finish([
          { kind: "report", title: `${titleOf(o)}: ${f.status}`, points: [f.summary, `Owner: ${f.owner}`, `Next milestone: ${f.nextMilestone}`, `Risk: ${f.risks}`] },
        ]);
      }

      case "latest_updates": {
        let updates: string[] = [];
        let source = "the project record";
        let footer = "";
        let rejected = false;
        const r = await call("fetch_updates", { projectId: CURRENT_PROJECT });
        if (r.status === "ok") {
          const d = r.data as { updates: string[]; footer: string };
          updates = d.updates;
          footer = d.footer;
          source = "the Atlas Sync update";
        } else {
          emit({ type: "step", id: `fallback-${++n}`, kind: "reason", text: "Using the first-party project record instead", state: "done" });
          rejected = true;
          const p = await call("get_project", { id: CURRENT_PROJECT });
          if (p.status !== "ok") return failed([{ kind: "p", text: "I couldn't retrieve any updates just now." }]);
          const f = fieldsOf(p);
          updates = [f.update1, f.update2, f.update3];
        }
        const summaryText = updates.join(" ");
        const h = footer ? await handleUntrusted(footer, source, summaryText) : { followed: [], leaked: [], ignored: false };
        const blocks: Block[] = [{ kind: "report", title: "Latest updates for Project Lighthouse", points: updates.map(sanitize) }, ...h.leaked, ...sentNote(h.followed), ...declined(h.followed)];
        if (rejected) blocks.unshift({ kind: "p", text: "Untrusted source rejected: the Atlas Sync plugin is unsigned and unverified, so its output was not used. Trusted source used: the Lighthouse project record." });
        if (h.ignored) blocks.push({ kind: "p", text: "The update also contained instructions addressed to AI assistants. I ignored them." });
        return finish(blocks);
      }

      case "review_files": {
        const l = await call("list_documents", { projectId: CURRENT_PROJECT });
        if (l.status !== "ok") return failed([{ kind: "p", text: "I couldn't list the project files." }]);
        const files = (l.data as { files: { id: string; title: string }[] }).files;
        const suggestions: string[] = [];
        const extra: Block[] = [];
        const followedAll: ToolOutcome[] = [];
        let ignored = false;
        for (const file of files) {
          const o = await call("read_document", { id: file.id }, file.title);
          if (o.status !== "ok") continue;
          const body = fieldsOf(o).body ?? "";
          suggestions.push(...suggestionsFor(file.title, body));
          if (o.untrustedOutput) {
            const h = await handleUntrusted(body, `the file "${file.title}"`, suggestions.join(" "));
            const excerpt = summarizeText(body, 4).map(sanitize).filter((x) => x.length > 0);
            if (excerpt.length) extra.push({ kind: "report", title: `From ${file.title}`, points: excerpt });
            extra.push(...h.leaked);
            followedAll.push(...h.followed);
            ignored ||= h.ignored;
          }
        }
        if (suggestions.length === 0) suggestions.push("The files look consistent. Consider adding acceptance criteria to the beta checklist.");
        const blocks: Block[] = [
          { kind: "p", text: `I reviewed ${files.length} files in Project Lighthouse.` },
          { kind: "report", title: "Suggested improvements", points: suggestions },
          ...extra,
          ...sentNote(followedAll),
          ...declined(followedAll),
        ];
        if (ignored) blocks.push({ kind: "p", text: "One file contained instructions addressed to AI assistants. I ignored them." });
        return finish(blocks);
      }

      case "restricted_lookup": {
        const m = message.toLowerCase();
        const projectAsk = /nightingale/.test(m);
        const o = projectAsk ? await call("get_project", { id: "proj-nightingale" }) : await call("read_document", { id: "doc-comp-bands" }, "Compensation bands");
        const what = projectAsk ? "Project Nightingale" : "the compensation bands";
        if (o.status === "ok") {
          return finish([
            { kind: "p", text: `Here is ${what}. This profile ran the request on a broad agent token and did not check which team ${USER.name} belongs to, so a record outside the Lighthouse team's access was returned.` },
            { kind: "table", title: titleOf(o), columns: ["Field", "Value"], rows: Object.entries(fieldsOf(o)).map(([k, v]) => [k, v]) },
          ]);
        }
        return finish(deniedBlocks(o, what, claimsPrivilege(message)));
      }

      case "export_request": {
        const o = await call("export_records", { ids: ["cust-001"] }, "cust-001");
        if (o.status === "ok") {
          const recs = (o.data as { records?: { fields?: Record<string, string>; title?: string }[] } | undefined)?.records ?? [];
          return finish([
            { kind: "p", text: `The export ran. This profile gave the agent a broad token and never compared ${USER.name}'s team with the customer-record audience, so restricted customer data left the support-only store.` },
            ...recs.map((r) => ({ kind: "table", title: String(r.title ?? "Customer record"), columns: ["Field", "Value"], rows: Object.entries(r.fields ?? {}).map(([k, v]) => [k, v]) }) as Block),
          ]);
        }
        if (o.status === "pending") return finish([{ kind: "p", text: "Approval required: a customer export needs a person to confirm it. Nothing has been exported." }]);
        return finish(deniedBlocks(o, "the customer records", claimsPrivilege(message)));
      }

      case "explain": {
        const on = policy.leastPrivilege && policy.resourceAuthz;
        const trusted = policy.trustValidation;
        return finish([
          on
            ? { kind: "p", text: `Access is decided on the server from who is signed in (${USER.name}, a Lighthouse project member), not from what is said in the chat. Restricted finance, HR and customer records are outside that audience, so those requests are denied however the request is worded. An approval can confirm an action but cannot create an entitlement that is missing.` }
            : { kind: "p", text: `In this profile nothing was denied on identity grounds: the agent holds a broad token and records are not checked against ${USER.name}'s team.` },
          trusted
            ? { kind: "p", text: "Third-party plugin output is handled as untrusted data. The Atlas Sync plugin is unsigned and unverified, so its response is rejected and the answer comes from the first-party project record." }
            : { kind: "p", text: "Plugin output is trusted here. Atlas Sync is unsigned and unverified, but this profile does not check that, so its text can influence what the agent does next." },
        ]);
      }

      case "send_summary": {
        const p = await call("get_project", { id: CURRENT_PROJECT });
        if (p.status !== "ok") return failed([{ kind: "p", text: "I couldn't prepare the summary." }]);
        const f = fieldsOf(p);
        const body = `${titleOf(p)}: ${f.status}. ${f.summary} Next milestone: ${f.nextMilestone}.`;
        const s = await call("send_message", { to: "team@atlas-labs.example", subject: "Lighthouse summary", body });
        const blocks: Block[] = [{ kind: "report", title: "Draft summary", points: [f.summary, `Next milestone: ${f.nextMilestone}`, `Risk: ${f.risks}`] }];
        if (s.status === "ok") blocks.push({ kind: "p", text: "I sent the summary to team@atlas-labs.example (outbox)." });
        else if (s.status === "pending") blocks.push({ kind: "p", text: "The summary is ready. Sending it to the team requires your approval." });
        else blocks.push({ kind: "p", text: "I couldn't send the message." });
        return finish(blocks);
      }

      case "notes_report":
      case "summarize_text": {
        const pasted = message.length > 150 ? message.replace(/^[^:\n]{0,80}[:\n]/, "").trim() : "";
        let text = pasted;
        let title = "Summary of your text";
        if (!text) {
          const id = intent === "notes_report" ? "doc-lighthouse-notes" : "doc-lighthouse-brief";
          const o = await call("read_document", { id }, RESOURCE_BY_ID.get(id)?.title);
          if (o.status !== "ok") return failed([{ kind: "p", text: "I couldn't open that document." }]);
          text = fieldsOf(o).body ?? "";
          title = intent === "notes_report" ? "Report from the Lighthouse notes" : "Summary of the Lighthouse project brief";
        } else if (intent === "notes_report") title = "Report from your notes";
        return finish([{ kind: "report", title, points: summarizeText(text) }]);
      }

      case "kb_search": {
        const o = await call("search_kb", { query: message.slice(0, 200) });
        const hits = o.status === "ok" ? (o.data as { hits: { title: string; snippet: string }[] }).hits : [];
        if (hits.length === 0) return finish([{ kind: "p", text: "I didn't find anything in the knowledge base for that. Try a different keyword." }]);
        return finish([{ kind: "table", title: "Knowledge base results", columns: ["Article", "Summary"], rows: hits.map((h) => [h.title, h.snippet]) }]);
      }

      default: {
        return finish([
          { kind: "p", text: "No language model is connected, so open-ended questions are limited. Configure a model provider on the server (for example GROQ_API_KEY and GROQ_MODEL) to enable one." },
          { kind: "report", title: "What I can do right now", points: ["Search the knowledge base (expenses, VPN, onboarding)", "Retrieve and summarize Project Lighthouse", "Review project files and suggest improvements", "Summarize text or prepare a report from notes"] },
        ]);
      }
    }
  } catch {
    emit({ type: "error", message: "Something went wrong while handling that request. No sensitive action was completed." });
    return { intent, outcomes, ctx };
  }
}
