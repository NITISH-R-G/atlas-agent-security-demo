import type { ControlKey } from "./policy";

/** Display metadata for the 11 controls. Pure data; decisions come only from the execution layer. */
export const CONTROL_INFO: Record<ControlKey, { name: string; purpose: string; stage: string; enforcement: "server-enforced" | "modelled-inputs" }> = {
  leastPrivilege: { name: "Least privilege", purpose: "The agent identity holds only the permissions its task needs.", stage: "Identity check", enforcement: "server-enforced" },
  scopedCredentials: { name: "Scoped, short-lived credentials", purpose: "The synthetic credential has explicit scopes and an expiry.", stage: "Credential check", enforcement: "server-enforced" },
  resourceAuthz: { name: "Resource-level authorization", purpose: "Each protected resource is checked against who may read it.", stage: "Resource check", enforcement: "server-enforced" },
  toolAllowlist: { name: "Tool allowlist", purpose: "Only tools approved in server configuration can run.", stage: "Tool selection", enforcement: "server-enforced" },
  trustValidation: { name: "Trust and provenance", purpose: "Third-party tools must be signed, pinned and from a verified publisher.", stage: "Tool selection", enforcement: "server-enforced" },
  contentIsolation: { name: "Untrusted-content isolation", purpose: "Retrieved content is data and cannot give the agent instructions.", stage: "Content handling", enforcement: "server-enforced" },
  injectionFiltering: { name: "Injection filtering", purpose: "Instruction-like text in untrusted content is removed before reuse. A heuristic: it does not catch every injection.", stage: "Content handling", enforcement: "server-enforced" },
  approvalForSensitive: { name: "Approval for sensitive actions", purpose: "Designated sensitive actions wait for your explicit approval.", stage: "Approval gate", enforcement: "server-enforced" },
  outputFiltering: { name: "Output filtering", purpose: "Protected fields are withheld before results reach the model or you.", stage: "Result filtering", enforcement: "server-enforced" },
  audit: { name: "Audit logging", purpose: "Decisions and outcomes are recorded (in memory, not durable).", stage: "Audit", enforcement: "server-enforced" },
  failClosed: { name: "Fail closed", purpose: "If a required check cannot complete, the action is denied.", stage: "Error handling", enforcement: "server-enforced" },
};

export type EvalDecision = "allowed" | "blocked" | "detected" | "not_applicable" | "indeterminate";
export type EvalEffect = "prevented" | "detected" | "documented" | "none";

/** One control's actual evaluation for one event. Evidence never contains secret values. */
export interface ControlEval {
  control: ControlKey;
  decision: EvalDecision;
  /** Machine-readable reason code. */
  code: string;
  evidence: string;
  effect: EvalEffect;
}

export const evalOf = (control: ControlKey, decision: EvalDecision, code: string, evidence: string, effect: EvalEffect = decision === "blocked" ? "prevented" : "none"): ControlEval => ({
  control,
  decision,
  code,
  evidence,
  effect,
});

export const off = (control: ControlKey): ControlEval => evalOf(control, "not_applicable", "control_off", "Off in this profile, so this check was not enforced.");
