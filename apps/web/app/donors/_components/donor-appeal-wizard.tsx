"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ComposeStep } from "@/app/broadcasts/new/_components/compose-step";
import { cancelResendAction, configureResendAction, schedule, sendNow, testSend } from "@/app/broadcasts/actions";

import type { DonorAppealBootstrap, DonorAppealDraft } from "../actions";
import {
  clearDonorExclusions,
  getDonorAppealBootstrap,
  previewDonorAppealAudience,
  refreshDonorSalesforceCampaigns,
  saveDonorAppealDraft,
  uploadDonorExclusions,
} from "../actions";
import { DonorAudienceStep } from "./donor-audience-step";
import { DonorExcludeStep, type DonorAudiencePreview } from "./donor-exclude-step";
import { DonorResendStep } from "./donor-resend-step";

const STEPS = ["Details", "Audience", "Exclude", "Content", "Resend", "Review & send"] as const;
type Step = (typeof STEPS)[number];

export function DonorAppealWizard({ draft: initialDraft, bootstrap: initialBootstrap }: { readonly draft: DonorAppealDraft; readonly bootstrap: DonorAppealBootstrap }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [bootstrap, setBootstrap] = useState(initialBootstrap);
  const [step, setStep] = useState<Step>("Details");
  const [criteria, setCriteria] = useState(initialDraft.audienceCriteria);
  const [preview, setPreview] = useState<DonorAudiencePreview | null>(null);
  const [csvSummary, setCsvSummary] = useState<{ readonly acceptedCount: number; readonly invalidSkippedCount: number } | null>(null);
  const [resendEnabled, setResendEnabled] = useState(false);
  const [resendDays, setResendDays] = useState(3);
  const [resendSubject, setResendSubject] = useState("");
  const [resendPreheader, setResendPreheader] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const mode = criteria.initialFilter === "salesforce_lists" ? "salesforce_lists" : "all_available";
  const exclusions = criteria.exclusions ?? { salesforceListIds: [], useUploadedExclusions: false, previousRuns: [] };
  // The checkbox reads the saved audience itself, so what Devynn sees is what
  // gets sent: there is no second copy of the Insiders choice to drift.
  const excludeInsiders = exclusions.salesforceListIds.includes("insiders");

  function updateCriteria(next: DonorAppealDraft["audienceCriteria"]) {
    setCriteria(next);
  }

  async function persist(): Promise<boolean> {
    const result = await saveDonorAppealDraft({
      runId: draft.runId, observedUpdatedAt: draft.updatedAt, name: draft.name?.trim() ?? "", fromEmail: draft.fromEmail ?? "", fromName: draft.fromName?.trim() ?? "", replyToEmail: draft.replyToEmail ?? "", subject: nonEmpty(draft.subject), preheader: nonEmpty(draft.preheader), bodyHtml: draft.bodyHtml, bodyText: draft.bodyText, bodyDesignJson: draft.bodyDesignJson, audienceCriteria: criteria, audienceSize: preview?.total ?? draft.audienceSize,
    });
    if (!result.ok) { setMessage(result.message); return false; }
    setDraft(result.data);
    return true;
  }

  async function refreshPreview() {
    try { setPreview(await previewDonorAppealAudience(draft.runId)); }
    catch { setMessage("We could not update the recipient count. Try again."); }
  }

  // Keep the recipient count live on the Exclude step: save the choices and
  // recount on arrival and shortly after each change (one save at a time).
  const exclusionKey = JSON.stringify([criteria.exclusions ?? null, excludeInsiders]);
  useEffect(() => {
    if (step !== "Exclude") return;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        if (await persist()) await refreshPreview();
      });
    }, 500);
    return () => { window.clearTimeout(timer); };
  }, [step, exclusionKey]);

  function next() {
    startTransition(async () => {
      if (step === "Details" && (!draft.name?.trim() || !draft.fromEmail || !draft.fromName?.trim() || !draft.replyToEmail)) { setMessage("Add the appeal name, sender, from name, and reply-to address."); return; }
      if (step === "Audience" && mode === "salesforce_lists" && (criteria.salesforceListIds?.length ?? 0) === 0) { setMessage("Choose at least one Salesforce campaign."); return; }
      if (step === "Resend" && resendEnabled && (!resendSubject.trim() || resendDays < 1 || resendDays > 14)) { setMessage("Add a new subject and choose 1 to 14 days."); return; }
      if (!(await persist())) return;
      if (step === "Exclude") await refreshPreview();
      if (step === "Resend") {
        const result = resendEnabled ? await configureResendAction(draft.runId, { delayDays: resendDays, subject: resendSubject, ...(resendPreheader.trim() ? { preheader: resendPreheader } : {}) }, "donors") : await cancelResendAction(draft.runId, "donors");
        if (!result.ok && !(result.code === "campaign_resend_cancel_failed" && !resendEnabled)) { setMessage(result.message); return; }
      }
      const index = STEPS.indexOf(step);
      if (index < STEPS.length - 1) setStep(STEPS[index + 1] ?? "Review & send");
      setMessage(null);
    });
  }

  function back() { const index = STEPS.indexOf(step); if (index > 0) setStep(STEPS[index - 1] ?? "Details"); }

  function chooseAudience(nextMode: "all_available" | "salesforce_lists") {
    // Whole-list appeals leave Insiders out by default; campaign audiences don't.
    const ids = new Set(exclusions.salesforceListIds);
    if (nextMode === "all_available") ids.add("insiders"); else ids.delete("insiders");
    updateCriteria({ ...criteria, initialFilter: nextMode, salesforceListIds: nextMode === "all_available" ? [] : criteria.salesforceListIds ?? [], exclusions: { ...exclusions, salesforceListIds: [...ids] } });
  }

  function changeInsiders(value: boolean) {
    const ids = new Set(exclusions.salesforceListIds);
    if (value) ids.add("insiders"); else ids.delete("insiders");
    updateCriteria({ ...criteria, exclusions: { ...exclusions, salesforceListIds: [...ids] } });
  }

  return <div className="mx-auto w-full max-w-4xl px-6 py-8"><header className="mb-7"><p className="text-sm font-medium text-slate-500">Donor appeals</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">New appeal</h1></header><ol className="mb-8 grid gap-2 sm:grid-cols-6" aria-label="Appeal steps">{STEPS.map((item, index) => <li key={item} className={`rounded-md px-2 py-2 text-center text-xs font-medium ${item === step ? "bg-slate-900 text-white" : index < STEPS.indexOf(step) ? "bg-slate-200 text-slate-800" : "bg-white text-slate-500"}`}>{index + 1}. {item}</li>)}</ol><div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-7">{step === "Details" ? <Details draft={draft} senders={bootstrap.senders} onChange={(patch) => { setDraft({ ...draft, ...patch, replyToEmail: patch.fromEmail && draft.replyToEmail === draft.fromEmail ? patch.fromEmail : draft.replyToEmail }); }} /> : null}{step === "Audience" ? <DonorAudienceStep mode={mode} selectedListIds={criteria.salesforceListIds ?? []} lists={bootstrap.lists} lastSyncedAt={bootstrap.lastSyncedAt} refreshing={busy} onModeChange={chooseAudience} onSelectedListIdsChange={(ids) => { updateCriteria({ ...criteria, salesforceListIds: [...ids] }); }} onRefresh={() => { startTransition(async () => { const before = bootstrap.lastSyncedAt; const result = await refreshDonorSalesforceCampaigns(); if (!result.ok) { setMessage(result.message); return; } const deadline = Date.now() + 120_000; do { await new Promise((resolve) => window.setTimeout(resolve, 2_000)); const fresh = await getDonorAppealBootstrap(); setBootstrap(fresh); if (fresh.lastSyncedAt !== before) break; } while (Date.now() < deadline); }); }} /> : null}{step === "Exclude" ? <DonorExcludeStep excludeInsiders={excludeInsiders} selectedListIds={exclusions.salesforceListIds.filter((id) => id !== "insiders")} previousRun={exclusions.previousRuns[0] ?? null} earlierAppeals={bootstrap.earlierAppeals.filter((appeal) => appeal.id !== draft.runId)} lists={bootstrap.lists} csvSummary={csvSummary} preview={preview} onExcludeInsidersChange={changeInsiders} onSelectedListIdsChange={(ids) => { updateCriteria({ ...criteria, exclusions: { ...exclusions, salesforceListIds: [...(excludeInsiders ? ["insiders"] : []), ...ids] } }); }} onPreviousRunChange={(value) => { updateCriteria({ ...criteria, exclusions: { ...exclusions, previousRuns: value ? [value] : [] } }); }} onCsvChange={(file) => { if (!file) return; startTransition(async () => { const result = await uploadDonorExclusions({ runId: draft.runId, csvText: await file.text() }); if (!result.ok) { setMessage(result.message); return; } setCsvSummary(result.data); updateCriteria({ ...criteria, exclusions: { ...exclusions, useUploadedExclusions: true } }); }); }} onClearCsv={() => { startTransition(async () => { const result = await clearDonorExclusions(draft.runId); if (!result.ok) { setMessage(result.message); return; } setCsvSummary(null); updateCriteria({ ...criteria, exclusions: { ...exclusions, useUploadedExclusions: false } }); }); }} /> : null}{step === "Content" ? <ComposeStep launchType="html_email" subject={draft.subject ?? ""} preheader={draft.preheader ?? ""} bodyPlaintext={draft.bodyText ?? ""} bodyHtml={draft.bodyHtml ?? ""} savedDesign={draft.bodyDesignJson} selectedAliasSignature="" frozen={false} showMergeTags={false} showAbTest={false} onSubjectChange={(value) => { setDraft({ ...draft, subject: value }); }} onPreheaderChange={(value) => { setDraft({ ...draft, preheader: value }); }} onBodyChange={(value) => { setDraft({ ...draft, bodyDesignJson: value.bodyDesignJson, bodyText: value.bodyPlaintext, bodyHtml: value.bodyHtml }); }} onBack={back} onContinue={next} /> : null}{step === "Resend" ? <DonorResendStep enabled={resendEnabled} days={resendDays} subject={resendSubject} preheader={resendPreheader} onEnabledChange={setResendEnabled} onDaysChange={setResendDays} onSubjectChange={setResendSubject} onPreheaderChange={setResendPreheader} /> : null}{step === "Review & send" ? <Review draft={draft} preview={preview} resendEnabled={resendEnabled} resendDays={resendDays} scheduleAt={scheduleAt} busy={busy} onScheduleAtChange={setScheduleAt} onTest={() => { startTransition(async () => { const result = await testSend(draft.runId, draft.operatorEmail, "donors"); setMessage(result.ok ? `Test sent to ${result.data.recipientEmail}.` : result.message); }); }} onSend={() => { startTransition(async () => { if (!(await persist())) return; const result = scheduleAt ? await schedule(draft.runId, new Date(scheduleAt), "donors") : await sendNow(draft.runId, "donors"); if (!result.ok) { setMessage(result.message); return; } router.push(`/donors/${encodeURIComponent(draft.runId)}`); }); }} /> : null}</div>{message ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">{message}</p> : null}{step !== "Content" && step !== "Review & send" ? <footer className="mt-5 flex justify-between gap-3"><Button type="button" variant="outline" onClick={back} disabled={busy || step === "Details"}>Back</Button><Button type="button" onClick={next} disabled={busy}>{busy ? "Saving…" : "Continue"}</Button></footer> : step === "Review & send" ? <footer className="mt-5"><Button type="button" variant="outline" onClick={back} disabled={busy}>Back</Button></footer> : null}</div>;
}

function Details({ draft, senders, onChange }: { readonly draft: DonorAppealDraft; readonly senders: DonorAppealBootstrap["senders"]; readonly onChange: (patch: Partial<DonorAppealDraft>) => void }) {
  return <section className="space-y-5"><div><h2 className="text-xl font-semibold tracking-tight text-slate-950">Appeal details</h2><p className="mt-1 text-sm text-slate-600">Set the name and sender people will see.</p></div><label className="block text-sm font-medium text-slate-800" htmlFor="appeal-name">Appeal name<Input id="appeal-name" className="mt-1" value={draft.name ?? ""} onChange={(event) => { onChange({ name: event.currentTarget.value }); }} /></label><label className="block text-sm font-medium text-slate-800" htmlFor="appeal-sender">Sender address<select id="appeal-sender" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3" value={draft.fromEmail ?? ""} onChange={(event) => { onChange({ fromEmail: event.currentTarget.value }); }}>{senders.map((sender) => <option key={sender.email} value={sender.email}>{sender.label} — {sender.email}</option>)}</select></label><label className="block text-sm font-medium text-slate-800" htmlFor="appeal-from-name">From name<Input id="appeal-from-name" className="mt-1" value={draft.fromName ?? ""} onChange={(event) => { onChange({ fromName: event.currentTarget.value }); }} /><span className="mt-2 flex gap-2"><button type="button" onClick={() => { onChange({ fromName: "Adventure Scientists" }); }} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Adventure Scientists</button><button type="button" onClick={() => { onChange({ fromName: "Gregg Treinish" }); }} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Gregg Treinish</button></span></label><label className="block text-sm font-medium text-slate-800" htmlFor="appeal-reply-to">Reply-to<Input id="appeal-reply-to" className="mt-1" type="email" value={draft.replyToEmail ?? ""} onChange={(event) => { onChange({ replyToEmail: event.currentTarget.value }); }} /></label></section>;
}

function Review({ draft, preview, resendEnabled, resendDays, scheduleAt, busy, onScheduleAtChange, onTest, onSend }: { readonly draft: DonorAppealDraft; readonly preview: DonorAudiencePreview | null; readonly resendEnabled: boolean; readonly resendDays: number; readonly scheduleAt: string; readonly busy: boolean; readonly onScheduleAtChange: (value: string) => void; readonly onTest: () => void; readonly onSend: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const recipientCount = preview?.total.toLocaleString() ?? draft.audienceSize?.toLocaleString() ?? "0";
  return <section className="space-y-5"><div><h2 className="text-xl font-semibold tracking-tight text-slate-950">Review and send</h2><p className="mt-1 text-sm text-slate-600">One last check before this appeal goes out.</p></div><dl className="divide-y rounded-xl border border-slate-200 bg-white"><Row label="Appeal" value={draft.name ?? "Untitled appeal"} /><Row label="From" value={`${draft.fromName ?? ""} <${draft.fromEmail ?? ""}>`} /><Row label="Recipients" value={`${recipientCount} people`} /><Row label="Subject" value={draft.subject ?? "No subject yet"} /><Row label="Reminder" value={resendEnabled ? `After ${resendDays.toString()} days` : "No reminder"} /></dl><label className="block text-sm font-medium text-slate-800" htmlFor="appeal-schedule">Schedule for later (optional)<Input id="appeal-schedule" className="mt-1" type="datetime-local" value={scheduleAt} onChange={(event) => { onScheduleAtChange(event.currentTarget.value); }} /></label><div className="flex flex-wrap gap-3"><Button type="button" variant="outline" onClick={onTest} disabled={busy}>Send test to me</Button><Button type="button" onClick={() => { setConfirmOpen(true); }} disabled={busy}>{scheduleAt ? "Schedule appeal" : "Send appeal"}</Button></div><Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent><DialogHeader><DialogTitle>{scheduleAt ? "Schedule this appeal?" : "Send this appeal?"}</DialogTitle><DialogDescription>This will go to {recipientCount} people.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => { setConfirmOpen(false); }}>Go back</Button><Button type="button" disabled={busy} onClick={() => { setConfirmOpen(false); onSend(); }}>{scheduleAt ? "Schedule appeal" : "Send appeal"}</Button></DialogFooter></DialogContent></Dialog><p className="text-sm text-slate-500">You will be asked to confirm the recipient count before sending.</p></section>;
}

function Row({ label, value }: { readonly label: string; readonly value: string }) { return <div className="flex gap-4 px-4 py-3 text-sm"><dt className="w-24 shrink-0 font-medium text-slate-500">{label}</dt><dd className="text-slate-900">{value}</dd></div>; }

function nonEmpty(value: string | null): string | null { const trimmed = value?.trim() ?? ""; return trimmed.length > 0 ? trimmed : null; }
