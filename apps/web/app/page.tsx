import Link from "next/link";

import { AppShell, type StatusCard, StatusGrid } from "@as-comms/ui";

import { getStage0ReadinessSnapshot } from "../src/server/readiness";

export default function HomePage() {
  const readiness = getStage0ReadinessSnapshot();
  const cards: StatusCard[] = [
    {
      title: "Stage 0 foundation",
      status: "ok",
      description:
        "The monorepo scaffold, worker boundary, contracts package, and shared UI package are in place."
    },
    ...readiness.checks.map((check) => ({
      title: check.name,
      status: check.status,
      description: check.message
    }))
  ];

  return (
    <AppShell
      eyebrow="Stage 0"
      title="AS Comms Platform"
      description="This landing page is intentionally narrow: it proves the web surface boots, exposes basic health/readiness information, and stops short of Stage 1 product behavior."
    >
      <StatusGrid items={cards} />
      <section className="grid gap-6 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-slate-950">What Stage 0 includes</h2>
          <p className="text-sm leading-7 text-slate-700">
            This repo now has the locked workspace shape, a Next.js App Router shell,
            a Graphile Worker boot path, boundary enforcement, and verification hooks.
          </p>
          <p className="text-sm leading-7 text-slate-700">
            Product behavior, business tables, provider ingest, role UX, and Inbox logic
            are all intentionally deferred.
          </p>
        </div>
        <div className="rounded-2xl bg-slate-950 p-5 text-sm text-slate-100">
          <p className="font-semibold">Operational surfaces</p>
          <ul className="mt-3 space-y-2 text-slate-300">
            <li>
              <Link className="underline decoration-slate-500" href="/health">
                /health
              </Link>
            </li>
            <li>/api/health</li>
            <li>/api/readiness</li>
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
