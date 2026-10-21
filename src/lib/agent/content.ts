import { evalOf, off, type ControlEval } from "./controls";
import type { SecurityPolicy } from "./policy";

/**
 * Heuristic detector for instruction-like text addressed to AI assistants. It is deliberately simple, runs on normalized
 * text (Unicode NFKC, zero-width characters removed, case-folded), and does NOT catch every injection. Authorization is
 * enforced separately at the tool boundary and never depends on this detector.
 */
const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿]/g;

const PATTERNS: RegExp[] = [
  /note to (the )?ai (assistants?|agents?|models?)\s*:/,
  /\b(ignore|disregard|forget)\s+(all |any |the )?(of )?(your )?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|messages?|rules|directions)/,
  /^\s*(system|assistant|developer)\s*:/,
  /<!--\s*(assistant|system|ai)\b/,
  /\byou are now (the |an? )?(administrator|admin|root|developer|system|unrestricted)/,
  /\bas the ai assistant,? you (must|should|will|are required)/,
  /\byou (must|should) now (forward|send|read|reveal|export|disclose|ignore)\b/,
  /\[\s*(assistant|system|ai)[^\]]{0,40}instruction[^\]]{0,40}\]/,
];

interface Hit {
  /** The matched instruction text (from the match to the end of the line), normalized. */
  text: string;
  /** What remains of the line once the instruction is removed. */
  kept: string;
}

function inspectLine(line: string): Hit | undefined {
  const clean = line.normalize("NFKC").replace(ZERO_WIDTH, "");
  const lower = clean.toLowerCase();
  let at = -1;
  for (const p of PATTERNS) {
    const m = p.exec(lower);
    if (m && (at < 0 || m.index < at)) at = m.index;
  }
  if (at < 0) return undefined;
  // When normalization changed the text, offsets no longer line up with the original line, so drop the whole line.
  const unchanged = clean.length === line.length;
  return { text: clean.slice(at).trim(), kept: unchanged ? line.slice(0, at).trimEnd() : "" };
}

export function extractDirectives(text: string): string[] {
  return text.split(/\r?\n/).flatMap((l) => {
    const h = inspectLine(l);
    return h ? [h.text] : [];
  });
}

export function stripDirectives(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => {
      const h = inspectLine(l);
      return h ? h.kept : l;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface UntrustedScan {
  directives: string[];
  /** The text that may be reused (quoted back or shown to the model). */
  safeText: string;
  /** True when this profile lets the agent act on the embedded instructions (the defined weakness). */
  follow: boolean;
  /** Actual evaluations of the two content controls for this piece of untrusted content. */
  evals: ControlEval[];
}

/**
 * The single place where untrusted content (plugin output, retrieved documents) meets the content controls.
 * Used by both the deterministic planner and the model orchestrator.
 */
export function scanUntrusted(text: string, source: string, policy: SecurityPolicy): UntrustedScan {
  const directives = extractDirectives(text);
  const n = directives.length;
  const evals: ControlEval[] = [];
  const follow = n > 0 && !policy.contentIsolation;

  if (!policy.contentIsolation) {
    evals.push(
      n > 0
        ? evalOf("contentIsolation", "not_applicable", "instructions_followed", `${n} instruction(s) inside ${source} were treated as commands (defined weakness of this profile).`, "documented")
        : off("contentIsolation"),
    );
  } else if (n > 0) {
    evals.push(evalOf("contentIsolation", "blocked", "instructions_not_followed", `${n} instruction(s) inside ${source} were treated as data and not followed.`));
  } else {
    evals.push(evalOf("contentIsolation", "allowed", "treated_as_data", `${source} was handled as data; no instruction-like text was found (heuristic, not a guarantee).`));
  }

  if (!policy.injectionFiltering) {
    evals.push(off("injectionFiltering"));
  } else if (n === 0) {
    evals.push(evalOf("injectionFiltering", "allowed", "nothing_detected", `Heuristic scan of ${source} found nothing. This does not prove the content is safe.`));
  } else if (policy.contentIsolation) {
    evals.push(evalOf("injectionFiltering", "blocked", "instruction_text_removed", `Instruction-like text from ${source} was removed before reuse.`));
  } else {
    evals.push(evalOf("injectionFiltering", "detected", "detected_not_blocked", `Instruction-like text from ${source} was detected and removed from quoted output, but actions are decided by other controls.`, "detected"));
  }

  return { directives, safeText: policy.injectionFiltering ? stripDirectives(text) : text, follow, evals };
}
