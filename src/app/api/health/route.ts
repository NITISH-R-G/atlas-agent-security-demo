import { describeModel, readModelConfig } from "@/lib/agent/provider";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Liveness and runtime provenance. Exposes only what a presenter needs to confirm: which provider and model the server
 * would use, and that state is in memory. Never returns keys, key presence per provider, environment or request data.
 */
export async function GET() {
  const cfg = readModelConfig(process.env);
  const model = cfg.ok
    ? { configured: true, provider: cfg.config.provider, model: cfg.config.model, label: describeModel(cfg.config).label }
    : { configured: false, problem: cfg.problem };
  return Response.json(
    {
      status: "ok",
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      model,
      state: { approvals: "signed session-bound tickets; single use enforced per instance (not shared across instances)", audit: "in memory, bounded, not durable", sessions: "anonymous cookie, not authentication" },
      note: "Synthetic data only. Scripted scenarios never call a model.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
