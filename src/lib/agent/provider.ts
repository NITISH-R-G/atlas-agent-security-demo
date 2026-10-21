/**
 * Model provider configuration (server-side only). All providers speak the OpenAI-compatible chat completions API
 * (streaming + tool calls). Keys are read only here, on the server, and never appear in messages, events or logs.
 *
 *  - Groq:       https://api.groq.com/openai/v1/chat/completions, bearer GROQ_API_KEY, model GROQ_MODEL.
 *  - OpenRouter: https://openrouter.ai/api/v1/chat/completions, bearer OPENROUTER_API_KEY, model OPENROUTER_MODEL.
 *  - OpenAI:     https://api.openai.com/v1/chat/completions,    bearer OPENAI_API_KEY,     model OPENAI_MODEL.
 *  - NVIDIA:     https://integrate.api.nvidia.com/v1/chat/completions, bearer NVIDIA_API_KEY, model NEMOTRON_MODEL
 *                (alias NVIDIA_MODEL). The NVIDIA docs do not confirm a hosted model id.
 *
 * There is deliberately NO default model in code: ids come from the operator's own configuration. For OpenRouter,
 * pick one whose catalog entry lists `tools` in supported_parameters (https://openrouter.ai/api/v1/models).
 * Selection precedence: LLM_PROVIDER (`groq` | `openrouter` | `openai` | `nvidia`) if set; otherwise the first provider whose
 * key is set, in the order Groq, OpenRouter, OpenAI, NVIDIA.
 */
export type ProviderId = "groq" | "openrouter" | "openai" | "nvidia";

export const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

export interface ModelConfig {
  provider: ProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
}

export type ConfigProblem = "missing_key" | "missing_model" | "invalid_model" | "invalid_base_url" | "invalid_provider";
export type ConfigResult = { ok: true; config: ModelConfig } | { ok: false; problem: ConfigProblem; message: string };

const NAMES: Record<ProviderId, { key: string; model: string; base: string; label: string; defaultBase: string; officialHost: (h: string) => boolean }> = {
  groq: { key: "GROQ_API_KEY", model: "GROQ_MODEL", base: "GROQ_BASE_URL", label: "Groq", defaultBase: GROQ_DEFAULT_BASE_URL, officialHost: (h) => h === "api.groq.com" },
  openrouter: { key: "OPENROUTER_API_KEY", model: "OPENROUTER_MODEL", base: "OPENROUTER_BASE_URL", label: "OpenRouter", defaultBase: OPENROUTER_DEFAULT_BASE_URL, officialHost: (h) => h === "openrouter.ai" },
  openai: { key: "OPENAI_API_KEY", model: "OPENAI_MODEL", base: "OPENAI_BASE_URL", label: "OpenAI", defaultBase: OPENAI_DEFAULT_BASE_URL, officialHost: (h) => h === "api.openai.com" },
  nvidia: { key: "NVIDIA_API_KEY", model: "NEMOTRON_MODEL (or NVIDIA_MODEL)", base: "NVIDIA_BASE_URL", label: "NVIDIA", defaultBase: NVIDIA_DEFAULT_BASE_URL, officialHost: (h) => h.endsWith("nvidia.com") },
};
const ORDER: ProviderId[] = ["groq", "openrouter", "openai", "nvidia"];

/** OpenAI-style ids (`gpt-...`, `ft:...`). */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
/** `author/slug` ids with an optional `:variant` suffix (OpenRouter and NVIDIA), e.g. `nvidia/some-model:free`. */
const SLUG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function validBaseUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.search || u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Reads and validates provider configuration from an environment map. Messages never include a key value. */
export function readModelConfig(env: Record<string, string | undefined>): ConfigResult {
  const fail = (problem: ConfigProblem, message: string): ConfigResult => ({ ok: false, problem, message });
  const requested = env.LLM_PROVIDER?.trim().toLowerCase();
  if (requested && !ORDER.includes(requested as ProviderId)) return fail("invalid_provider", "LLM_PROVIDER must be groq, openrouter, openai or nvidia.");

  const provider: ProviderId | undefined = (requested as ProviderId | undefined) ?? ORDER.find((p) => env[NAMES[p].key]?.trim());
  if (!provider) return fail("missing_key", "No model provider is configured: set GROQ_API_KEY and GROQ_MODEL (or the OpenRouter, OpenAI or NVIDIA equivalents).");
  const n = NAMES[provider];

  const apiKey = env[n.key]?.trim();
  if (!apiKey) return fail("missing_key", `${n.key} is not set on the server.`);

  // Precedence for NVIDIA: NEMOTRON_MODEL (primary) over NVIDIA_MODEL (alias).
  const model = provider === "nvidia" ? env.NEMOTRON_MODEL?.trim() || env.NVIDIA_MODEL?.trim() : env[n.model]?.trim();
  if (!model) return fail("missing_model", `${n.model} is not set. Use a model id available to your ${n.label} account; there is no default.`);
  const idOk = provider === "openai" ? MODEL_ID_PATTERN.test(model) : SLUG_ID_PATTERN.test(model);
  if (model.length > 100 || !idOk) return fail("invalid_model", `The ${n.label} model id (${n.model}) is not valid.`);

  const baseURL = (env[n.base]?.trim() || n.defaultBase).replace(/\/+$/, "");
  if (!validBaseUrl(baseURL)) return fail("invalid_base_url", `${n.base} must be an https URL (http is allowed only for localhost).`);

  return { ok: true, config: { provider, apiKey, baseURL, model } };
}

/** The label shown in the UI. A provider is named only when the validated endpoint host really belongs to it. */
export function describeModel(config: ModelConfig): { label: string; note?: string } {
  let host = "unknown";
  try {
    host = new URL(config.baseURL).host;
  } catch {
    /* keep unknown */
  }
  const n = NAMES[config.provider];
  if (n.officialHost(host)) return { label: config.provider === "nvidia" ? `NVIDIA Nemotron (${config.model})` : `${n.label} (${config.model})` };
  return { label: `Custom endpoint ${host} (${config.model}), not ${n.label}`, note: `The configured endpoint is not an official ${n.label} host.` };
}

export type ProviderFailure = "unauthorized" | "quota_exhausted" | "rate_limited" | "model_unavailable" | "unavailable" | "timeout" | "network" | "bad_response" | "cancelled";

/** Maps a provider/SDK error to a safe, honest message. Never echoes provider bodies (which may contain the key). */
export function classifyProviderError(error: unknown, provider: ProviderId = "openai"): { code: ProviderFailure; message: string } {
  const n = NAMES[provider];
  const e = error as { name?: string; statusCode?: number; lastError?: unknown } | undefined;
  // After bounded retries the SDK wraps the real failure (for example a 429) in a RetryError; classify the cause, not the wrapper.
  if (e?.name === "AI_RetryError" && e.lastError) return classifyProviderError(e.lastError, provider);
  const status = typeof e?.statusCode === "number" ? e.statusCode : undefined;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return { code: "timeout", message: "The model took too long to respond and was stopped." };
  if (status === 401 || status === 403) return { code: "unauthorized", message: `The ${n.label} API rejected the credentials. Check ${n.key}.` };
  if (status === 402) return { code: "quota_exhausted", message: `${n.label} reports insufficient credits or quota for this model. Add credits or choose another model.` };
  if (status === 429) {
    return {
      code: "rate_limited",
      message: provider === "openrouter" ? "OpenRouter is rate limiting requests (free models have strict per-minute and daily limits). Try again later or use another model." : provider === "groq" ? "Groq is rate limiting requests (per-minute or daily token limits). Wait a moment and try again, or choose another model." : `The ${n.label} API is rate limiting requests or the account has no remaining quota. Try again shortly.`,
    };
  }
  if (status === 404) return { code: "model_unavailable", message: `The ${n.label} API could not use this model (${n.model}). It may be unavailable or may not support tool calling; check the model id and the provider's catalog.` };
  if (status && status >= 500) return { code: "unavailable", message: `The ${n.label} API is temporarily unavailable.` };
  if (status && status >= 400) return { code: "bad_response", message: `The ${n.label} API rejected the request (HTTP ${status}). Check the model id (${n.model}).` };
  if (e?.name === "AI_JSONParseError" || e?.name === "AI_TypeValidationError" || e?.name === "AI_NoOutputGeneratedError") return { code: "bad_response", message: "The model returned a response that could not be read." };
  return { code: "network", message: `Could not reach the ${n.label} API.` };
}
