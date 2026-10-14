import Link from "next/link";
import { sql } from "drizzle-orm";

import { DeleteDraftButton } from "@/app/broadcasts/new/_components/delete-draft-button";
import { Button } from "@/components/ui/button";
import { requireWorkspace } from "@/src/server/auth/workspace-access";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

const stateClasses: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", scheduled: "bg-sky-50 text-sky-700", sending: "bg-amber-50 text-amber-800", complete: "bg-emerald-50 text-emerald-800", finalized: "bg-slate-200 text-slate-700", cancelled: "bg-rose-50 text-rose-800",
};

interface EngagementRow {
  readonly runId: string;
  readonly opened: number | string;
  readonly clicked: number | string;
}

/**
 * Opens and clicks per appeal in one grouped query. Loading every snapshot to
 * count them would read ~31,000 rows per year-end appeal on each page view.
 */
async function readEngagement(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
  runIds: readonly string[],
): Promise<Map<string, { readonly opens: number; readonly clicks: number }>> {
  const engagement = new Map<string, { readonly opens: number; readonly clicks: number }>();
  if (runtime.connection === null || runIds.length === 0) return engagement;
  const result = await runtime.connection.db.execute(sql<EngagementRow>`
    select
      campaign_run_id as "runId",
      count(*) filter (where opened_at is not null)::int as "opened",
      count(*) filter (where clicked_at is not null)::int as "clicked"
    from audience_snapshots
    where campaign_run_id in (${sql.join(runIds.map((id) => sql`${id}`), sql`, `)})
    group by campaign_run_id
  `);
  // postgres-js returns an array, other drivers { rows }.
  const raw: unknown = result;
  const rows: readonly EngagementRow[] = Array.isArray(raw)
    ? (raw as readonly EngagementRow[])
    : ((raw as { readonly rows?: readonly EngagementRow[] }).rows ?? []);
  for (const row of rows) {
    engagement.set(row.runId, { opens: Number(row.opened), clicks: Number(row.clicked) });
  }
  return engagement;
}

export default async function DonorsPage() {
  await requireWorkspace("donors");
  const runtime = await getStage1WebRuntime();
  const runs = (await runtime.campaigns.campaignRuns.listRecent({ workspace: "donors", limit: 100 }))
    .filter((run) => run.resendOfRunId === null);
  const [engagement, resends] = await Promise.all([
    readEngagement(runtime, runs.filter((run) => run.state === "complete" || run.state === "finalized").map((run) => run.id)),
    Promise.all(runs.map((run) => runtime.campaigns.campaignRuns.findResendByParentRunId(run.id))),
  ]);
  const rows = runs.map((run, index) => ({ run, resend: resends[index] ?? null, metrics: engagement.get(run.id) ?? null }));

  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Donor relations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Appeals</h1><p className="mt-1 text-sm text-slate-600">Plan and send donor emails in one place.</p></div><Button asChild><Link href="/donors/new">New appeal</Link></Button></header>{rows.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><h2 className="text-base font-semibold text-slate-900">No appeals yet</h2><p className="mt-1 text-sm text-slate-600">An appeal is an email you send to supporters about a donation or fundraising moment.</p><Button asChild className="mt-5"><Link href="/donors/new">New appeal</Link></Button></div> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50"><tr><th scope="col" className="px-5 py-3 text-left font-medium text-slate-600">Appeal</th><th scope="col" className="px-5 py-3 text-left font-medium text-slate-600">Status</th><th scope="col" className="px-5 py-3 text-right font-medium text-slate-600">Recipients</th><th scope="col" className="px-5 py-3 text-left font-medium text-slate-600">Sent or scheduled</th><th scope="col" className="px-5 py-3 text-left font-medium text-slate-600">Results</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map(({ run, resend, metrics }) => {
    const isDraft = run.state === "draft";
    // A draft reopens in the appeal flow; anything launched shows its results.
    const href = isDraft ? `/donors/new?runId=${encodeURIComponent(run.id)}` : `/donors/${encodeURIComponent(run.id)}`;
    return <tr key={run.id} className="hover:bg-slate-50/80"><td className="px-5 py-4 font-medium text-slate-900"><Link className="hover:underline" href={href}>{run.name ?? run.subjectTemplate ?? "Untitled appeal"}</Link>{resend ? <span className="ml-2 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">Reminder {resend.state === "cancelled" ? "cancelled" : "set"}</span> : null}{isDraft ? <div className="mt-1"><DeleteDraftButton runId={run.id} compact /></div> : null}</td><td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${stateClasses[run.state] ?? stateClasses.draft ?? ""}`}>{run.state}</span></td><td className="px-5 py-4 text-right tabular-nums text-slate-600">{run.audienceSize?.toLocaleString() ?? "—"}</td><td className="px-5 py-4 text-slate-600">{formatDate(run.completedAt ?? run.scheduledAt)}</td><td className="px-5 py-4 text-slate-600">{metrics ? `${metrics.opens.toLocaleString()} opens · ${metrics.clicks.toLocaleString()} clicks` : "—"}</td></tr>;
  })}</tbody></table></div>}</div>;
}

function formatDate(value: string | null): string { return value === null ? "—" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Denver" }).format(new Date(value)); }
