/**
 * Central security policy. The single Security switch maps to one of two profiles here;
 * every control is a field that the runtime and planner actually read. No UI code decides security.
 */
export interface SecurityPolicy {
  /** Identity holds only the scopes its task needs (otherwise a broad `*` grant). */
  leastPrivilege: boolean;
  /** Credentials are scoped to the task and expire (otherwise one long-lived broad token). */
  scopedCredentials: boolean;
  /** Each resource is checked against its own audience (otherwise any reachable resource is readable). */
  resourceAuthz: boolean;
  /** Only approved tools may be called. */
  toolAllowlist: boolean;
  /** Third-party tools must be signed, pinned and from a verified publisher. */
  trustValidation: boolean;
  /** Retrieved content is data; it can never choose tools or actions. */
  contentIsolation: boolean;
  /** Directive-looking text in untrusted content is removed from anything quoted back. */
  injectionFiltering: boolean;
  /** Sensitive tools wait for an explicit human approval. */
  approvalForSensitive: boolean;
  /** Fields tagged protected are redacted from tool output. */
  outputFiltering: boolean;
  /** Every decision is written to the server-side audit log. */
  audit: boolean;
  /** An error while evaluating a check denies the action (otherwise the action proceeds). */
  failClosed: boolean;
}

export type ControlKey = keyof SecurityPolicy;

export const CONTROL_KEYS: ControlKey[] = [
  "leastPrivilege",
  "scopedCredentials",
  "resourceAuthz",
  "toolAllowlist",
  "trustValidation",
  "contentIsolation",
  "injectionFiltering",
  "approvalForSensitive",
  "outputFiltering",
  "audit",
  "failClosed",
];

/** The deliberately vulnerable demonstration profile. Only the simulated environment is affected. */
export const VULNERABLE_POLICY: Readonly<SecurityPolicy> = Object.freeze({
  leastPrivilege: false,
  scopedCredentials: false,
  resourceAuthz: false,
  toolAllowlist: false,
  trustValidation: false,
  contentIsolation: false,
  injectionFiltering: false,
  approvalForSensitive: false,
  outputFiltering: false,
  audit: false,
  failClosed: false,
});

export const PROTECTED_POLICY: Readonly<SecurityPolicy> = Object.freeze({
  leastPrivilege: true,
  scopedCredentials: true,
  resourceAuthz: true,
  toolAllowlist: true,
  trustValidation: true,
  contentIsolation: true,
  injectionFiltering: true,
  approvalForSensitive: true,
  outputFiltering: true,
  audit: true,
  failClosed: true,
});

export function policyFor(securityOn: boolean): SecurityPolicy {
  return { ...(securityOn ? PROTECTED_POLICY : VULNERABLE_POLICY) };
}

/** Test helper: the vulnerable profile with exactly the given controls enabled. */
export function onlyControls(...keys: ControlKey[]): SecurityPolicy {
  const p = policyFor(false);
  for (const k of keys) p[k] = true;
  return p;
}
