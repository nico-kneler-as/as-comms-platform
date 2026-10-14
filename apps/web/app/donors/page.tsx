import Link from "next/link";

import { requireWorkspace } from "@/src/server/auth/workspace-access";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

export default async function DonorsPage() {
  // The layout redirects first; this keeps the query closed if it ever runs alone.
  await requireWorkspace("donors");
  const runtime = await getStage1WebRuntime();
  const runs = await runtime.campaigns.campaignRuns.listRecent({
    workspace: "donors",
    limit: 100,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Donor relations
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          Appeals
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Donor appeal history and delivery status.
        </p>
      </header>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <h2 className="text-sm font-semibold text-slate-900">
            No donor appeals yet
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Appeals created in the Donors workspace will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-slate-600" scope="col">
                  Name
                </th>
                <th className="px-5 py-3 text-left font-medium text-slate-600" scope="col">
                  State
                </th>
                <th className="px-5 py-3 text-right font-medium text-slate-600" scope="col">
                  Recipients
                </th>
                <th className="px-5 py-3 text-left font-medium text-slate-600" scope="col">
                  Sent
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50/80">
                  <td className="px-5 py-4 font-medium text-slate-900">
                    <Link
                      className="hover:underline"
                      href={`/donors/${encodeURIComponent(run.id)}`}
                    >
                      {run.name ?? run.subjectTemplate ?? "Untitled appeal"}
                    </Link>
                  </td>
                  <td className="px-5 py-4 capitalize text-slate-600">
                    {run.state}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums text-slate-600">
                    {run.audienceSize?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {formatSentDate(run.completedAt ?? run.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatSentDate(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/Denver",
  }).format(new Date(value));
}
