import { LIMITS, type HistoryItem } from "./orchestrator";

export interface ChatRequest {
  message: string;
  security: boolean;
  history: HistoryItem[];
  demo: boolean;
  fault?: "authz";
}

/** Validates the whole request. Unknown fields are ignored; nothing from the body can set policy beyond `security`. */
export function parseChatRequest(body: unknown): { ok: true; value: ChatRequest } | { ok: false; message: string } {
  if (!body || typeof body !== "object") return { ok: false, message: "Request body must be a JSON object." };
  const b = body as Record<string, unknown>;
  if (typeof b.message !== "string" || !b.message.trim() || b.message.length > LIMITS.maxMessageChars) {
    return { ok: false, message: `message must be 1-${LIMITS.maxMessageChars} characters.` };
  }
  if (typeof b.security !== "boolean") return { ok: false, message: "security must be a boolean." };
  if (b.demo !== undefined && typeof b.demo !== "boolean") return { ok: false, message: "demo must be a boolean." };
  if (b.fault !== undefined && b.fault !== "authz") return { ok: false, message: 'fault must be "authz" when provided.' };
  const history: HistoryItem[] = [];
  if (b.history !== undefined) {
    if (!Array.isArray(b.history) || b.history.length > LIMITS.maxHistoryItems) return { ok: false, message: `history must be an array of at most ${LIMITS.maxHistoryItems} items.` };
    let total = 0;
    for (const h of b.history) {
      const item = h as Record<string, unknown>;
      if (!item || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || item.content.length > LIMITS.maxMessageChars) {
        return { ok: false, message: "Each history item needs a user/assistant role and content of reasonable length." };
      }
      total += item.content.length;
      if (item.content.trim()) history.push({ role: item.role, content: item.content });
    }
    if (total > LIMITS.maxHistoryChars) return { ok: false, message: "history is too long." };
  }
  return { ok: true, value: { message: b.message.trim(), security: b.security, history, demo: b.demo === true, fault: b.fault === "authz" ? "authz" : undefined } };
}
