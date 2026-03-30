import { AppShell, type StatusCard, StatusGrid } from "@as-comms/ui";

import { getStage0HealthSnapshot, getStage0ReadinessSnapshot } from "../../src/server/readiness";

export default function HealthPage() {
  const health = getStage0HealthSnapshot();
  const readiness = getStage0ReadinessSnapshot();
  const cards: StatusCard[] = [
    {
      title: `service:${health.service}`,
      status: health.status,
      description: `Generated at ${health.generatedAt}.`
    },
    ...readiness.checks.map((check) => ({
      title: check.name,
      status: check.status,
      description: check.message
    }))
  ];

  return (
    <AppShell
      eyebrow="Operational checks"
      title="Health and readiness"
      description="Browser-safe operational signals for the Stage 0 scaffold."
    >
      <StatusGrid items={cards} />
      <pre className="overflow-x-auto rounded-3xl bg-slate-950 p-6 text-xs leading-6 text-slate-100">
        {JSON.stringify({ health, readiness }, null, 2)}
      </pre>
    </AppShell>
  );
}
