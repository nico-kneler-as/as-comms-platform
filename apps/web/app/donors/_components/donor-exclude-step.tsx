"use client";

import {
  AudienceExclusionSummary,
  ExclusionCsvUpload,
  PreviousBroadcastExclusion,
  describeSharedExclusionReason,
  type AudienceExclusionPreview,
} from "@/app/_components/audience-exclusions/audience-exclusion-controls";

import type { DonorCampaignList } from "./donor-audience-step";

export type DonorAudiencePreview = AudienceExclusionPreview;

/** Turns a composer reason key into words Devynn recognizes. */
export function describeExclusionReason(
  reason: string,
  lists: readonly { readonly id: string; readonly name: string }[],
  earlierAppeals: readonly { readonly id: string; readonly name: string }[],
): string {
  if (reason === "salesforce_list:insiders") return "Insiders";
  if (reason.startsWith("salesforce_list:")) {
    const listId = reason.slice("salesforce_list:".length);
    return `In "${lists.find((list) => list.id === listId)?.name ?? "a Salesforce campaign"}"`;
  }
  return describeSharedExclusionReason(reason, earlierAppeals, "appeal");
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
  return (
    <section className="space-y-5">
      <div><h2 className="text-xl font-semibold tracking-tight text-slate-950">Who should we skip?</h2><p className="mt-1 text-sm text-slate-600">Choose any people who should not receive this appeal.</p></div>
      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"><input type="checkbox" checked={excludeInsiders} onChange={(event) => { onExcludeInsidersChange(event.currentTarget.checked); }} /><span><span className="font-semibold text-slate-900">Don&apos;t send to Insiders</span><span className="block text-sm text-slate-600">Use the Insiders group from Salesforce.</span></span></label>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-semibold text-slate-900">Other Salesforce campaigns</p><div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{lists.map((list) => <label key={list.id} className="flex gap-3 text-sm text-slate-700"><input type="checkbox" checked={selected.has(list.id)} onChange={(event) => { const next = new Set(selectedListIds); if (event.currentTarget.checked) next.add(list.id); else next.delete(list.id); onSelectedListIdsChange([...next]); }} />{list.name}</label>)}</div></div>
      <ExclusionCsvUpload id="donor-exclusion-csv" summary={csvSummary} onChange={onCsvChange} onClear={onClearCsv} />
      <PreviousBroadcastExclusion id="donor-earlier-appeal" noun="appeal" previousRun={previousRun} earlierBroadcasts={earlierAppeals} onChange={onPreviousRunChange} />
      <AudienceExclusionSummary preview={preview} describeReason={(reason) => describeExclusionReason(reason, lists, earlierAppeals)} />
    </section>
  );
}
