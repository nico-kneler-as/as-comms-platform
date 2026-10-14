"use client";

import { Input } from "@/components/ui/input";

import type { DonorCampaignList } from "./donor-audience-step";

export interface DonorAudiencePreview {
  readonly total: number;
  readonly excludedByReason: Readonly<Record<string, number>>;
  readonly consentExcluded: number;
}

export function DonorExcludeStep({
  excludeInsiders,
  selectedListIds,
  previousRun,
  earlierAppeals,
  lists,
  csvSummary,
  preview,
  onExcludeInsidersChange,
  onSelectedListIdsChange,
  onPreviousRunChange,
  onCsvChange,
  onClearCsv,
}: {
  readonly excludeInsiders: boolean;
  readonly selectedListIds: readonly string[];
  readonly previousRun: { readonly runId: string; readonly audience: "recipients" | "openers" | "clickers" } | null;
  readonly earlierAppeals: readonly { readonly id: string; readonly name: string }[];
  readonly lists: readonly DonorCampaignList[];
  readonly csvSummary: { readonly acceptedCount: number; readonly invalidSkippedCount: number } | null;
  readonly preview: DonorAudiencePreview | null;
  readonly onExcludeInsidersChange: (value: boolean) => void;
  readonly onSelectedListIdsChange: (ids: readonly string[]) => void;
  readonly onPreviousRunChange: (value: { readonly runId: string; readonly audience: "recipients" | "openers" | "clickers" } | null) => void;
  readonly onCsvChange: (file: File | null) => void;
  readonly onClearCsv: () => void;
}) {
  const selected = new Set(selectedListIds);
  const reasons = preview === null ? [] : Object.entries(preview.excludedByReason).filter(([, count]) => count > 0);
  return (
    <section className="space-y-5">
      <div><h2 className="text-xl font-semibold tracking-tight text-slate-950">Who should we skip?</h2><p className="mt-1 text-sm text-slate-600">Choose any people who should not receive this appeal.</p></div>
      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"><input type="checkbox" checked={excludeInsiders} onChange={(event) => { onExcludeInsidersChange(event.currentTarget.checked); }} /><span><span className="font-semibold text-slate-900">Don&apos;t send to Insiders</span><span className="block text-sm text-slate-600">Use the Insiders group from Salesforce.</span></span></label>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-semibold text-slate-900">Other Salesforce campaigns</p><div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{lists.map((list) => <label key={list.id} className="flex gap-3 text-sm text-slate-700"><input type="checkbox" checked={selected.has(list.id)} onChange={(event) => { const next = new Set(selectedListIds); if (event.currentTarget.checked) next.add(list.id); else next.delete(list.id); onSelectedListIdsChange([...next]); }} />{list.name}</label>)}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><label htmlFor="donor-exclusion-csv" className="font-semibold text-slate-900">Upload a list of emails to skip</label><Input id="donor-exclusion-csv" className="mt-3" type="file" accept=".csv,text/csv" onChange={(event) => { onCsvChange(event.currentTarget.files?.[0] ?? null); }} />{csvSummary ? <p className="mt-2 text-sm text-slate-600">{csvSummary.acceptedCount} accepted · {csvSummary.invalidSkippedCount} invalid</p> : null}{csvSummary ? <button type="button" onClick={onClearCsv} className="mt-2 text-sm font-medium text-slate-700 underline">Clear uploaded list</button> : null}</div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-semibold text-slate-900">People who got an earlier appeal</p><label className="mt-3 block text-sm text-slate-700" htmlFor="donor-earlier-appeal">Earlier appeal<select id="donor-earlier-appeal" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3" value={previousRun?.runId ?? ""} onChange={(event) => { onPreviousRunChange(event.currentTarget.value ? { runId: event.currentTarget.value, audience: previousRun?.audience ?? "recipients" } : null); }}><option value="">Do not exclude an earlier appeal</option>{earlierAppeals.map((appeal) => <option key={appeal.id} value={appeal.id}>{appeal.name}</option>)}</select></label>{previousRun ? <div className="mt-3 flex flex-wrap gap-2">{(["recipients", "openers", "clickers"] as const).map((audience) => <button key={audience} type="button" onClick={() => { onPreviousRunChange({ runId: previousRun.runId, audience }); }} className={`rounded-md border px-3 py-1.5 text-sm ${previousRun.audience === audience ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>{audience[0]?.toUpperCase()}{audience.slice(1)}</button>)}</div> : null}</div>
      <div className="rounded-xl border border-slate-900 bg-slate-950 p-4 text-white" aria-live="polite"><p className="text-sm text-slate-300">Audience summary</p><p className="mt-1 text-2xl font-semibold">{preview?.total.toLocaleString() ?? "—"} people will receive this</p>{reasons.map(([reason, count]) => <p key={reason} className="mt-2 text-sm text-slate-300">{count.toLocaleString()} skipped: {reason.replaceAll("_", " ")}</p>)}{preview ? <p className="mt-2 text-sm text-slate-300">{preview.consentExcluded.toLocaleString()} removed because they unsubscribed or bounced</p> : <p className="mt-2 text-sm text-slate-300">Save your choices to see the latest count.</p>}</div>
    </section>
  );
}
