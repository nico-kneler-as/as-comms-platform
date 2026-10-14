"use client";

import { Input } from "@/components/ui/input";

export type PreviousRunAudience = "recipients" | "openers" | "clickers";

export interface AudienceExclusionPreview {
  readonly total: number;
  readonly excludedByReason: Readonly<Record<string, number>>;
  readonly consentExcluded: number;
}

export interface EarlierBroadcast {
  readonly id: string;
  readonly name: string;
}

export function describeSharedExclusionReason(
  reason: string,
  earlierBroadcasts: readonly EarlierBroadcast[],
  noun: "broadcast" | "appeal" = "broadcast",
): string {
  if (reason === "uploaded_exclusions") return "On your uploaded list";
  if (reason.startsWith("previous_run:")) {
    const [, runId = "", audience = "recipients"] = reason.split(":");
    const verb = audience === "openers" ? "opened" : audience === "clickers" ? "clicked" : "got";
    return `Already ${verb} "${earlierBroadcasts.find((broadcast) => broadcast.id === runId)?.name ?? `an earlier ${noun}`}"`;
  }
  return reason;
}

export function ExclusionCsvUpload({
  id,
  summary,
  onChange,
  onClear,
}: {
  readonly id: string;
  readonly summary: { readonly acceptedCount: number; readonly invalidSkippedCount: number } | null;
  readonly onChange: (file: File | null) => void;
  readonly onClear: () => void;
}) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><label htmlFor={id} className="font-semibold text-slate-900">Upload a list of emails to skip</label><Input id={id} className="mt-3" type="file" accept=".csv,text/csv" onChange={(event) => { onChange(event.currentTarget.files?.[0] ?? null); }} />{summary ? <p className="mt-2 text-sm text-slate-600">{summary.acceptedCount} accepted · {summary.invalidSkippedCount} invalid</p> : null}{summary ? <button type="button" onClick={onClear} className="mt-2 text-sm font-medium text-slate-700 underline">Clear uploaded list</button> : null}</div>;
}

export function PreviousBroadcastExclusion({
  id,
  previousRun,
  earlierBroadcasts,
  onChange,
  noun = "broadcast",
}: {
  readonly id: string;
  readonly previousRun: { readonly runId: string; readonly audience: PreviousRunAudience } | null;
  readonly earlierBroadcasts: readonly EarlierBroadcast[];
  readonly onChange: (value: { readonly runId: string; readonly audience: PreviousRunAudience } | null) => void;
  /** Devynn's flow calls them appeals; volunteer broadcasts keep "broadcast". */
  readonly noun?: "broadcast" | "appeal";
}) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-semibold text-slate-900">People who got, opened, or clicked an earlier {noun}</p><label className="mt-3 block text-sm text-slate-700" htmlFor={id}>Earlier {noun}<select id={id} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3" value={previousRun?.runId ?? ""} onChange={(event) => { onChange(event.currentTarget.value ? { runId: event.currentTarget.value, audience: previousRun?.audience ?? "recipients" } : null); }}><option value="">Do not exclude an earlier {noun}</option>{earlierBroadcasts.map((broadcast) => <option key={broadcast.id} value={broadcast.id}>{broadcast.name}</option>)}</select></label>{previousRun ? <div className="mt-3 flex flex-wrap gap-2" aria-label="Earlier broadcast audience"><button type="button" onClick={() => { onChange({ runId: previousRun.runId, audience: "recipients" }); }} className={`rounded-md border px-3 py-1.5 text-sm ${previousRun.audience === "recipients" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>Recipients</button><button type="button" onClick={() => { onChange({ runId: previousRun.runId, audience: "openers" }); }} className={`rounded-md border px-3 py-1.5 text-sm ${previousRun.audience === "openers" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>Openers</button><button type="button" onClick={() => { onChange({ runId: previousRun.runId, audience: "clickers" }); }} className={`rounded-md border px-3 py-1.5 text-sm ${previousRun.audience === "clickers" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>Clickers</button></div> : null}</div>;
}

export function AudienceExclusionSummary({
  preview,
  describeReason,
}: {
  readonly preview: AudienceExclusionPreview | null;
  readonly describeReason: (reason: string) => string;
}) {
  const reasons = preview === null ? [] : Object.entries(preview.excludedByReason).filter(([, count]) => count > 0);
  return <div className="rounded-xl border border-slate-900 bg-slate-950 p-4 text-white" aria-live="polite"><p className="text-sm text-slate-300">Audience summary</p><p className="mt-1 text-2xl font-semibold">{preview?.total.toLocaleString() ?? "—"} people will receive this</p>{reasons.map(([reason, count]) => <p key={reason} className="mt-2 text-sm text-slate-300">{count.toLocaleString()} skipped · {describeReason(reason)}</p>)}{preview ? <p className="mt-2 text-sm text-slate-300">{preview.consentExcluded.toLocaleString()} removed because they unsubscribed or bounced</p> : <p className="mt-2 text-sm text-slate-300">Save your choices to see the latest count.</p>}</div>;
}
