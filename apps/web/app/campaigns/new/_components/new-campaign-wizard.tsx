"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  AudienceCriteria,
  AudienceLastActivityWindow,
  AudienceTriState,
  CampaignKind,
  LaunchType,
} from "@as-comms/contracts";

import type {
  AudienceBuilderBootstrap,
  AudienceCountData,
  AudiencePreviewRow,
  CampaignWizardDraftData,
} from "../../_lib/audience-data-source";
import {
  previewAudienceAction,
  resolveAudienceCountAction,
  saveCampaignWizardDraftAction,
} from "../../_lib/audience-data-source";
import { AudienceBuilderStep } from "./audience-builder-step";
import { CampaignKindStep } from "./campaign-kind-step";
import { LaunchTypeStep } from "./launch-type-step";
import {
  type CampaignWizardStepDefinition,
  WizardRail,
} from "./wizard-rail";

const STEPS: readonly CampaignWizardStepDefinition[] = [
  {
    id: "launch",
    title: "Launch type",
    subtitle: "Normal Email is the only active path in Phase A.",
  },
  {
    id: "kind",
    title: "Campaign kind",
    subtitle: "Project email and newsletter drive footer scope.",
  },
  {
    id: "audience",
    title: "Audience",
    subtitle: "Filters resolve live against canonical contacts.",
  },
];

type SaveState = "idle" | "saving" | "saved" | "error";

export function NewCampaignWizard({
  bootstrap,
  draft,
}: {
  readonly bootstrap: AudienceBuilderBootstrap;
  readonly draft: CampaignWizardDraftData;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [launchType, setLaunchType] = useState<LaunchType>(draft.launchType);
  const [kind, setKind] = useState<CampaignKind>(draft.kind);
  const [criteria, setCriteria] = useState(draft.audienceCriteria);
  const [countState, setCountState] = useState<AudienceCountData>({
    count: draft.audienceSize ?? 0,
    hasAppliedFilters: false,
  });
  const [previewRows, setPreviewRows] = useState<readonly AudiencePreviewRow[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [countPending, startCountTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const countRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const savedFingerprintRef = useRef("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        launchType,
        kind,
        criteria,
        audienceSize: countState.count,
      }),
    [countState.count, criteria, kind, launchType],
  );
  const dirty = fingerprint !== savedFingerprintRef.current;

  useEffect(() => {
    savedFingerprintRef.current = JSON.stringify({
      launchType: draft.launchType,
      kind: draft.kind,
      criteria: draft.audienceCriteria,
      audienceSize: draft.audienceSize ?? 0,
    });
  }, [draft.audienceCriteria, draft.audienceSize, draft.kind, draft.launchType]);

  useEffect(() => {
    const requestId = ++countRequestRef.current;
    const timer = setTimeout(() => {
      startCountTransition(async () => {
        const result = await resolveAudienceCountAction({ criteria });
        if (requestId !== countRequestRef.current || !result.ok) {
          if (!result.ok && requestId === countRequestRef.current) {
            setSaveMessage(result.message);
          }
          return;
        }

        setCountState(result.data);
      });
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [criteria]);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }

    const requestId = ++previewRequestRef.current;
    startPreviewTransition(async () => {
      const result = await previewAudienceAction({ criteria });
      if (requestId !== previewRequestRef.current) {
        return;
      }

      if (!result.ok) {
        setSaveMessage(result.message);
        return;
      }

      setPreviewRows(result.data);
    });
  }, [criteria, previewOpen]);

  useEffect(() => {
    if (!dirty) {
      return;
    }

    const interval = setInterval(() => {
      void persistDraft("Autosaved");
    }, 30_000);

    return () => {
      clearInterval(interval);
    };
  }, [dirty, countState.count, criteria, kind, launchType]);

  async function persistDraft(successMessage: string): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      startSaveTransition(async () => {
        setSaveState("saving");
        const result = await saveCampaignWizardDraftAction({
          runId: draft.runId,
          launchType,
          kind,
          audienceCriteria: criteria,
          audienceSize: countState.hasAppliedFilters ? countState.count : null,
        });

        if (!result.ok) {
          setSaveState("error");
          setSaveMessage(result.message);
          resolve(false);
          return;
        }

        savedFingerprintRef.current = JSON.stringify({
          launchType: result.data.launchType,
          kind: result.data.kind,
          criteria: result.data.audienceCriteria,
          audienceSize: result.data.audienceSize ?? 0,
        });
        setSaveState("saved");
        setSaveMessage(successMessage);

        if (saveTimeoutRef.current !== null) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          setSaveState("idle");
          setSaveMessage(null);
        }, 2000);

        resolve(true);
      });
    });
  }

  function updateCriteria(mutator: (current: AudienceCriteria) => AudienceCriteria) {
    setCriteria((current) => mutator(current));
  }

  function toggleProject(projectId: string) {
    updateCriteria((current) => ({
      ...current,
      projectIds: current.projectIds.includes(projectId)
        ? current.projectIds.filter((value) => value !== projectId)
        : [...current.projectIds, projectId],
    }));
  }

  function toggleStatus(status: string) {
    updateCriteria((current) => ({
      ...current,
      statuses: current.statuses.includes(status as never)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status as never],
    }));
  }

  function toggleExpedition(expeditionId: string) {
    updateCriteria((current) => ({
      ...current,
      expeditionIds: current.expeditionIds.includes(expeditionId)
        ? current.expeditionIds.filter((value) => value !== expeditionId)
        : [...current.expeditionIds, expeditionId],
    }));
  }

  function changeLastActivity(value: AudienceLastActivityWindow) {
    updateCriteria((current) => ({
      ...current,
      lastActivityWindow: value,
    }));
  }

  function changeHasReplied(value: AudienceTriState) {
    updateCriteria((current) => ({
      ...current,
      hasReplied: value,
    }));
  }

  function changeHasClicked(value: AudienceTriState) {
    updateCriteria((current) => ({
      ...current,
      hasClicked: value,
    }));
  }

  async function continueTo(step: number) {
    const saved = await persistDraft("Saved");
    if (saved) {
      setCurrentStep(step);
    }
  }

  const statusLabel =
    saveState === "saving" || savePending
      ? "Saving draft…"
      : saveState === "saved"
        ? saveMessage ?? "Saved"
        : saveState === "error"
          ? saveMessage ?? "Save failed"
          : dirty
            ? "Unsaved changes"
            : "All changes saved";

  return (
    <div className="flex min-h-dvh w-full bg-slate-100">
      <WizardRail
        currentStep={currentStep}
        onStepChange={(index) => {
          if (index <= currentStep) {
            setCurrentStep(index);
          }
        }}
        steps={STEPS}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-slate-200 bg-white px-8 py-5">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <div>
              <h1 className="text-balance text-2xl font-semibold text-slate-900">
                Create campaign
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Draft ID {draft.runId.slice(0, 8)} · {statusLabel}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 px-8 py-8">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col rounded-3xl border border-slate-200 bg-white p-8">
            {currentStep === 0 ? (
              <LaunchTypeStep
                value={launchType}
                onChange={setLaunchType}
                onContinue={() => {
                  void continueTo(1);
                }}
              />
            ) : null}

            {currentStep === 1 ? (
              <CampaignKindStep
                value={kind}
                onChange={setKind}
                onBack={() => {
                  setCurrentStep(0);
                }}
                onContinue={() => {
                  void continueTo(2);
                }}
              />
            ) : null}

            {currentStep === 2 ? (
              <AudienceBuilderStep
                criteria={criteria}
                countState={countState}
                previewRows={previewRows}
                countLoading={countPending}
                previewLoading={previewPending}
                previewOpen={previewOpen}
                previewErrorMessage={saveState === "error" ? saveMessage : null}
                projectGroups={bootstrap.projects}
                expeditionOptions={bootstrap.expeditions}
                statusOptions={bootstrap.statuses}
                onProjectToggle={toggleProject}
                onStatusToggle={toggleStatus}
                onExpeditionToggle={toggleExpedition}
                onLastActivityChange={changeLastActivity}
                onHasRepliedChange={changeHasReplied}
                onHasClickedChange={changeHasClicked}
                onPreviewToggle={() => {
                  setPreviewOpen((current) => !current);
                  setSaveMessage(null);
                }}
                onBack={() => {
                  setCurrentStep(1);
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
