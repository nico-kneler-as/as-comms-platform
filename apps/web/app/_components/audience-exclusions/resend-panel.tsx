"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { Workspace } from "@as-comms/contracts";

import { cancelResendAction } from "@/app/broadcasts/actions";
import { Button } from "@/components/ui/button";

export function ResendPanel({ parentRunId, child, workspace, detailHref }: { readonly parentRunId: string; readonly child: { readonly id: string; readonly state: string; readonly scheduledAt: string | null; readonly audienceSize: number | null } | null; readonly workspace: Workspace; readonly detailHref: (runId: string) => string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (child === null) return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold text-slate-900">Reminder</h2><p className="mt-1 text-sm text-slate-600">No reminder is set for this broadcast.</p></section>;
  const label = child.state === "draft" ? "Configured" : child.state === "cancelled" ? "Cancelled" : child.state === "complete" || child.state === "finalized" ? "Sent" : "Scheduled";
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold text-slate-900">Reminder</h2><p className="mt-2 text-sm text-slate-700"><span className="font-medium">{label}.</span>{child.scheduledAt ? ` Scheduled for ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(child.scheduledAt))}.` : " It will send after the broadcast is complete."}</p>{child.audienceSize !== null ? <p className="mt-1 text-sm text-slate-600">{child.audienceSize.toLocaleString()} recipients</p> : null}<div className="mt-3 flex flex-wrap gap-3"><Link href={detailHref(child.id)} className="text-sm font-medium text-slate-700 underline">View reminder</Link>{child.state === "draft" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { startTransition(async () => { const result = await cancelResendAction(parentRunId, workspace); if (result.ok) router.refresh(); }); }}>{pending ? "Cancelling…" : "Cancel reminder"}</Button> : null}</div></section>;
}
