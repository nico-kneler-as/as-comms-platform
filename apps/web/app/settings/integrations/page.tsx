import { redirect } from "next/navigation";

import type { SyncStateRecord, SyncStatus } from "@as-comms/contracts";

import { requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

const DISPLAY_TZ = "America/Denver";

function prettifyProvider(provider: string | null): string {
  if (provider === null) return "—";
  const map: Record<string, string> = {
    gmail: "Gmail",
    salesforce: "Salesforce",
    mailchimp: "Mailchimp",
    simpletexting: "SimpleTexting"
  };
  return map[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

function prettifyJobType(jobType: string): string {
  return jobType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${String(s)}s`;
  return `${String(m)}m ${String(s)}s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: DISPLAY_TZ,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusBadgeClasses(status: SyncStatus): string {
  const base =
    "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";
  switch (status) {
    case "succeeded":
      return `${base} bg-emerald-50 text-emerald-700`;
    case "running":
      return `${base} bg-blue-50 text-blue-700`;
    case "failed":
      return `${base} bg-red-50 text-red-700`;
    case "pending":
      return `${base} bg-yellow-50 text-yellow-700`;
    case "quarantined":
      return `${base} bg-orange-50 text-orange-700`;
    case "cancelled":
      return `${base} bg-slate-100 text-slate-500`;
    default:
      return `${base} bg-slate-100 text-slate-500`;
  }
}

function statusLabel(status: SyncStatus): string {
  switch (status) {
    case "succeeded":
      return "Success";
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "pending":
      return "Pending";
    case "quarantined":
      return "Quarantined";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

interface GroupKey {
  readonly provider: string | null;
  readonly jobType: string;
}

interface GroupedRow {
  readonly key: GroupKey;
  readonly records: readonly SyncStateRecord[];
  readonly latest: SyncStateRecord;
}

function groupByProviderAndJob(
  records: readonly SyncStateRecord[]
): readonly GroupedRow[] {
  const map = new Map<string, SyncStateRecord[]>();

  for (const record of records) {
    const key = `${record.provider ?? "__null__"}::${record.jobType}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(record);
    } else {
      map.set(key, [record]);
    }
  }

  const groups: GroupedRow[] = [];
  for (const [, recs] of map) {
    // Sort descending by lastSuccessfulAt then updatedAt to find "latest"
    const sorted = [...recs].sort((a, b) => {
      const aTime = a.lastSuccessfulAt ?? "";
      const bTime = b.lastSuccessfulAt ?? "";
      return bTime.localeCompare(aTime);
    });
    const first = sorted[0];
    if (!first) continue;
    groups.push({
      key: { provider: first.provider, jobType: first.jobType },
      records: sorted,
      latest: first
    });
  }

  // Sort groups: by provider then jobType
  groups.sort((a, b) => {
    const pa = a.key.provider ?? "";
    const pb = b.key.provider ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.key.jobType.localeCompare(b.key.jobType);
  });

  return groups;
}

export default async function IntegrationsPage() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const runtime = await getStage1WebRuntime();
  const records = await runtime.repositories.syncState.listAll();
  const groups = groupByProviderAndJob(records);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-slate-200 bg-white px-8 py-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">
          Integrations Health
        </h1>
        <p className="text-sm text-slate-600">
          Current sync status for each provider and job type. Timestamps shown
          in Mountain Time (America/Denver).
        </p>
      </header>

      <div className="flex min-w-0 flex-1 flex-col px-8 py-6">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
            <p className="text-sm text-slate-500">
              No sync state records found. Sync jobs will appear here once they
              run.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Provider
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Job Type
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Last Successful Sync
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Freshness p95
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Freshness p99
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((group) => {
                  const { latest } = group;
                  const groupId = `${latest.provider ?? "null"}::${latest.jobType}`;
                  return (
                    <tr
                      key={groupId}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {prettifyProvider(latest.provider)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {prettifyJobType(latest.jobType)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">
                        {formatTimestamp(latest.lastSuccessfulAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">
                        {formatSeconds(latest.freshnessP95Seconds)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">
                        {formatSeconds(latest.freshnessP99Seconds)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={statusBadgeClasses(latest.status)}>
                          {statusLabel(latest.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
