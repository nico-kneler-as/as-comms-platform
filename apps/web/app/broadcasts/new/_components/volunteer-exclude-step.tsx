"use client";

import {
  AudienceExclusionSummary,
  ExclusionCsvUpload,
  PreviousBroadcastExclusion,
  describeSharedExclusionReason,
  type AudienceExclusionPreview,
  type EarlierBroadcast,
  type PreviousRunAudience,
} from "@/app/_components/audience-exclusions/audience-exclusion-controls";
import { WizardFooter } from "./wizard-shell";

export function VolunteerExcludeStep({ earlierBroadcasts, previousRun, csvSummary, preview, onPreviousRunChange, onCsvChange, onClearCsv, onBack, onContinue }: { readonly earlierBroadcasts: readonly EarlierBroadcast[]; readonly previousRun: { readonly runId: string; readonly audience: PreviousRunAudience } | null; readonly csvSummary: { readonly acceptedCount: number; readonly invalidSkippedCount: number } | null; readonly preview: AudienceExclusionPreview | null; readonly onPreviousRunChange: (value: { readonly runId: string; readonly audience: PreviousRunAudience } | null) => void; readonly onCsvChange: (file: File | null) => void; readonly onClearCsv: () => void; readonly onBack: () => void; readonly onContinue: () => void }) {
  return <section className="flex h-full flex-col"><div className="space-y-5"><div><h2 className="text-xl font-semibold tracking-tight text-slate-950">Who should we skip?</h2><p className="mt-1 text-sm text-slate-600">Exclude people from this email without changing the broadcast audience rules.</p></div><ExclusionCsvUpload id="broadcast-exclusion-csv" summary={csvSummary} onChange={onCsvChange} onClear={onClearCsv} /><PreviousBroadcastExclusion id="broadcast-earlier-run" previousRun={previousRun} earlierBroadcasts={earlierBroadcasts} onChange={onPreviousRunChange} /><AudienceExclusionSummary preview={preview} describeReason={(reason) => describeSharedExclusionReason(reason, earlierBroadcasts)} /></div><WizardFooter onBack={onBack} primaryAction={onContinue} primaryLabel="Continue" /></section>;
}
