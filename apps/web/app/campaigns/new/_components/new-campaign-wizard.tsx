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
  AudiencePreviewRow,
  CampaignSenderOption,
  ComposePreviewData,
  CampaignWizardDraftData,
} from "../../_lib/audience-data-source";
import { cn } from "@/lib/utils";
import {
  loadComposePreviewAction,
  previewAudienceAction,
  resolveAudienceCountAction,
  saveCampaignWizardDraftAction,
} from "../../_lib/audience-data-source";
import { schedule, sendNow, testSend } from "../../actions";
import { AudienceBuilderStep } from "./audience-builder-step";
import { CampaignKindStep } from "./campaign-kind-step";
import { ComposeStep } from "./compose-step";
import { LaunchTypeStep } from "./launch-type-step";
import { ReviewStep } from "./review-step";
import { type CampaignWizardStepDefinition, WizardRail } from "./wizard-rail";

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
  {
    id: "compose",
    title: "Compose",
    subtitle: "Draft the subject, preheader, and campaign body.",
  },
  {
    id: "review",
    title: "Review",
    subtitle: "Freeze the sender, audience, and send timing.",
  },
];

type SaveState = "idle" | "saving" | "saved" | "error";
type ToastState = {
  readonly tone: "success" | "error";
  readonly message: string;
} | null;

function hasAppliedAudienceFilters(criteria: AudienceCriteria): boolean {
  return (
    criteria.projectIds.length > 0 ||
    criteria.statuses.length > 0 ||
    criteria.expeditionIds.length > 0 ||
    criteria.lastActivityWindow !== "all_time" ||
    criteria.hasReplied !== "either" ||
    criteria.hasClicked !== "either"
  );
}

function formatAutosaveLabel(lastSavedAtIso: string): string {
  const diffSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastSavedAtIso).getTime()) / 1000),
  );
  return `Saved ${diffSeconds.toString()}s ago`;
}

function readTimeZoneParts(
  date: Date,
  timeZone: string,
): Record<"year" | "month" | "day" | "hour" | "minute", string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return formatter.formatToParts(date).reduce(
    (parts, part) => {
      if (
        part.type === "year" ||
        part.type === "month" ||
        part.type === "day" ||
        part.type === "hour" ||
        part.type === "minute"
      ) {
        parts[part.type] = part.value;
      }

      return parts;
    },
    {
      year: "0000",
      month: "00",
      day: "00",
      hour: "00",
      minute: "00",
    },
  );
}

function buildDenverInputDefaults(now: Date): {
  readonly date: string;
  readonly time: string;
} {
  const rounded = new Date(now);
  rounded.setMinutes(rounded.getMinutes() + 60);
  rounded.setSeconds(0, 0);

  const parts = readTimeZoneParts(rounded, "America/Denver");
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function convertDenverInputToDate(date: string, time: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) ??
    /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null || timeMatch === null) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(timeMatch[1] ?? "", 10);
  const minute = Number.parseInt(timeMatch[2] ?? "", 10);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(desiredUtc);
  const guessParts = readTimeZoneParts(guess, "America/Denver");
  const observedUtc = Date.UTC(
    Number.parseInt(guessParts.year, 10),
    Number.parseInt(guessParts.month, 10) - 1,
    Number.parseInt(guessParts.day, 10),
    Number.parseInt(guessParts.hour, 10),
    Number.parseInt(guessParts.minute, 10),
  );

  return new Date(guess.getTime() + (desiredUtc - observedUtc));
}

function deriveSuggestedSenderEmail(input: {
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria;
  readonly bootstrap: AudienceBuilderBootstrap;
}): string | null {
  if (input.kind !== "project" || input.criteria.projectIds.length === 0) {
    return null;
  }

  const byId = new Map(
    input.bootstrap.projects.flatMap((group) => [
      [group.host.id, group.host] as const,
      ...group.connectedSubs.map((project) => [project.id, project] as const),
    ]),
  );
  const selected = input.criteria.projectIds
    .map((projectId) => byId.get(projectId))
    .filter(
      (project): project is NonNullable<typeof project> =>
        project !== undefined,
    );

  if (selected.length === 0) {
    return null;
  }

  if (selected.length === 1) {
    return (
      input.bootstrap.senderOptions.find(
        (option) =>
          option.projectId === selected[0]?.id && option.status === "verified",
      )?.email ?? null
    );
  }

  const selectedIds = new Set(selected.map((project) => project.id));
  for (const group of input.bootstrap.projects) {
    const groupIds = new Set([
      group.host.id,
      ...group.connectedSubs.map((project) => project.id),
    ]);
    const allSelectedBelongToGroup = [...selectedIds].every((projectId) =>
      groupIds.has(projectId),
    );
    if (allSelectedBelongToGroup) {
      return (
        input.bootstrap.senderOptions.find(
          (option) =>
            option.projectId === group.host.id && option.status === "verified",
        )?.email ?? null
      );
    }
  }

  return null;
}

function readProjectChipLabel(
  kind: CampaignKind,
  criteria: AudienceCriteria,
  bootstrap: AudienceBuilderBootstrap,
): string {
  if (kind === "newsletter") {
    return "Newsletter";
  }

  const byId = new Map(
    bootstrap.projects.flatMap((group) => [
      [group.host.id, group.host.name] as const,
      ...group.connectedSubs.map(
        (project) => [project.id, project.name] as const,
      ),
    ]),
  );
  if (criteria.projectIds.length === 1) {
    return byId.get(criteria.projectIds[0] ?? "") ?? "Project";
  }
  if (criteria.projectIds.length > 1) {
    return `${criteria.projectIds.length.toString()} projects`;
  }
  return "Project";
}

export function NewCampaignWizard({
  bootstrap,
  draft,
  isAdmin,
}: {
  readonly bootstrap: AudienceBuilderBootstrap;
  readonly draft: CampaignWizardDraftData;
  readonly isAdmin: boolean;
}) {
  const initialSchedule = buildDenverInputDefaults(new Date());
  const [currentStep, setCurrentStep] = useState(
    draft.state === "draft" ? 0 : 4,
  );
  const [launchType, setLaunchType] = useState<LaunchType>(draft.launchType);
  const [kind, setKind] = useState<CampaignKind>(draft.kind);
  const [name, setName] = useState(draft.name ?? "");
  const [fromEmail, setFromEmail] = useState(draft.fromEmail);
  const [replyToEmail, setReplyToEmail] = useState(draft.replyToEmail);
  const [subject, setSubject] = useState(draft.subjectTemplate ?? "");
  const [preheader, setPreheader] = useState(draft.preheader ?? "");
  const [bodyPlaintext, setBodyPlaintext] = useState(
    draft.bodyTextTemplate ?? "",
  );
  const [bodyHtml, setBodyHtml] = useState(draft.bodyHtmlTemplate ?? "");
  const [criteria, setCriteria] = useState(draft.audienceCriteria);
  const [countState, setCountState] = useState({
    count: draft.audienceSize ?? 0,
    hasAppliedFilters: hasAppliedAudienceFilters(draft.audienceCriteria),
  });
  const [previewRows, setPreviewRows] = useState<readonly AudiencePreviewRow[]>(
    [],
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [composePreview, setComposePreview] =
    useState<ComposePreviewData | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSavedAtIso, setLastSavedAtIso] = useState(draft.updatedAt);
  const [autosaveTick, setAutosaveTick] = useState(0);
  const [warningDismissFingerprint, setWarningDismissFingerprint] = useState<
    string | null
  >(null);
  const [testSendOpen, setTestSendOpen] = useState(false);
  const [testRecipientEmail, setTestRecipientEmail] = useState(
    draft.operatorEmail,
  );
  const [affectedContactsOpen, setAffectedContactsOpen] = useState(false);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduleDate, setScheduleDate] = useState(initialSchedule.date);
  const [scheduleTime, setScheduleTime] = useState(initialSchedule.time);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runState, setRunState] = useState(draft.state);
  const [scheduledAt, setScheduledAt] = useState(draft.scheduledAt);
  const [toast, setToast] = useState<ToastState>(null);
  const [countPending, startCountTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const [submitPending, startSubmitTransition] = useTransition();
  const [testSendPending, startTestSendTransition] = useTransition();
  const countRequestRef = useRef(0);
  const audiencePreviewRequestRef = useRef(0);
  const composePreviewRequestRef = useRef(0);
  const savedFingerprintRef = useRef("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const frozen = runState !== "draft";
  const previewFingerprint = useMemo(
    () => JSON.stringify({ subject, bodyPlaintext, bodyHtml }),
    [bodyHtml, bodyPlaintext, subject],
  );
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        launchType,
        kind,
        name: name.trim() || null,
        fromEmail,
        replyToEmail,
        subject,
        preheader,
        bodyPlaintext,
        bodyHtml,
        criteria,
        audienceSize: countState.hasAppliedFilters ? countState.count : null,
      }),
    [
      bodyHtml,
      bodyPlaintext,
      countState.count,
      countState.hasAppliedFilters,
      criteria,
      fromEmail,
      kind,
      launchType,
      name,
      preheader,
      replyToEmail,
      subject,
    ],
  );
  const dirty = fingerprint !== savedFingerprintRef.current;
  const selectedSenderOption = useMemo<CampaignSenderOption | null>(() => {
    if (fromEmail === null) {
      return null;
    }

    return (
      bootstrap.senderOptions.find(
        (option) => option.email === fromEmail && option.status === "verified",
      ) ??
      bootstrap.senderOptions.find((option) => option.email === fromEmail) ??
      null
    );
  }, [bootstrap.senderOptions, fromEmail]);
  const selectedSenderVerified = frozen
    ? true
    : selectedSenderOption?.status === "verified";
  const suggestedSenderEmail = useMemo(
    () => deriveSuggestedSenderEmail({ kind, criteria, bootstrap }),
    [bootstrap, criteria, kind],
  );
  const autosaveLabel = useMemo(
    () => formatAutosaveLabel(lastSavedAtIso),
    [autosaveTick, lastSavedAtIso],
  );
  const warningDismissed =
    warningDismissFingerprint !== null &&
    warningDismissFingerprint === previewFingerprint;

  useEffect(() => {
    savedFingerprintRef.current = JSON.stringify({
      launchType: draft.launchType,
      kind: draft.kind,
      name: draft.name,
      fromEmail: draft.fromEmail,
      replyToEmail: draft.replyToEmail,
      subject: draft.subjectTemplate ?? "",
      preheader: draft.preheader ?? "",
      bodyPlaintext: draft.bodyTextTemplate ?? "",
      bodyHtml: draft.bodyHtmlTemplate ?? "",
      criteria: draft.audienceCriteria,
      audienceSize: draft.audienceSize,
    });
  }, [draft]);

  useEffect(() => {
    if (fromEmail === null && suggestedSenderEmail !== null) {
      setFromEmail(suggestedSenderEmail);
      setReplyToEmail(suggestedSenderEmail);
    }
  }, [fromEmail, suggestedSenderEmail]);

  useEffect(() => {
    setReplyToEmail(fromEmail);
  }, [fromEmail]);

  useEffect(() => {
    const timer = setInterval(() => {
      setAutosaveTick((current) => current + 1);
    }, 30_000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (frozen) {
      return;
    }

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
  }, [criteria, frozen]);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }

    const requestId = ++audiencePreviewRequestRef.current;
    startPreviewTransition(async () => {
      const result = await previewAudienceAction({ criteria });
      if (requestId !== audiencePreviewRequestRef.current) {
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
    if (currentStep < 3) {
      return;
    }

    const requestId = ++composePreviewRequestRef.current;
    const timer = setTimeout(() => {
      startPreviewTransition(async () => {
        const result = await loadComposePreviewAction({
          kind,
          criteria,
          fromEmail,
          subjectTemplate: subject,
          bodyHtmlTemplate: bodyHtml,
          bodyTextTemplate: bodyPlaintext,
          sampleIndex,
        });
        if (requestId !== composePreviewRequestRef.current) {
          return;
        }

        if (!result.ok) {
          setToast({
            tone: "error",
            message: result.message,
          });
          return;
        }

        setComposePreview(result.data);
        setSampleIndex(result.data.sampleIndex);
      });
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [
    bodyHtml,
    bodyPlaintext,
    criteria,
    currentStep,
    fromEmail,
    kind,
    sampleIndex,
    subject,
  ]);

  useEffect(() => {
    setSampleIndex(0);
    setWarningDismissFingerprint(null);
  }, [bodyHtml, bodyPlaintext, subject]);

  useEffect(() => {
    if (!dirty || frozen) {
      return;
    }

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      Reflect.set(event, "returnValue", "");
    };

    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [dirty, frozen]);

  useEffect(() => {
    if (!dirty || frozen) {
      return;
    }

    const interval = setInterval(() => {
      void persistDraft("Autosaved");
    }, 30_000);

    return () => {
      clearInterval(interval);
    };
  }, [dirty, fingerprint, frozen]);

  useEffect(() => {
    if (toast === null) {
      return;
    }

    const timer = setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  async function persistDraft(successMessage: string): Promise<boolean> {
    if (frozen || !dirty) {
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      startSaveTransition(async () => {
        setSaveState("saving");
        const result = await saveCampaignWizardDraftAction({
          runId: draft.runId,
          launchType,
          kind,
          name: name.trim().length === 0 ? null : name.trim(),
          fromEmail,
          replyToEmail,
          subjectTemplate: subject.trim().length === 0 ? null : subject,
          bodyHtmlTemplate: bodyHtml.trim().length === 0 ? null : bodyHtml,
          bodyTextTemplate:
            bodyPlaintext.trim().length === 0 ? null : bodyPlaintext,
          preheader: preheader.trim().length === 0 ? null : preheader,
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
          name: result.data.name,
          fromEmail: result.data.fromEmail,
          replyToEmail: result.data.replyToEmail,
          subject: result.data.subjectTemplate ?? "",
          preheader: result.data.preheader ?? "",
          bodyPlaintext: result.data.bodyTextTemplate ?? "",
          bodyHtml: result.data.bodyHtmlTemplate ?? "",
          criteria: result.data.audienceCriteria,
          audienceSize: result.data.audienceSize,
        });
        setSaveState("saved");
        setSaveMessage(successMessage);
        setLastSavedAtIso(new Date().toISOString());

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

  function updateCriteria(
    mutator: (current: AudienceCriteria) => AudienceCriteria,
  ) {
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

  async function handleTestSend() {
    const saved = await persistDraft("Saved");
    if (!saved) {
      return;
    }

    startTestSendTransition(async () => {
      const result = await testSend(draft.runId, testRecipientEmail);
      if (!result.ok) {
        setToast({
          tone: "error",
          message: result.message,
        });
        return;
      }

      setToast({
        tone: "success",
        message: `Test sent to ${result.data.recipientEmail}`,
      });
      setTestSendOpen(false);
    });
  }

  async function handleSubmit() {
    const saved = await persistDraft("Saved");
    if (!saved) {
      return;
    }

    startSubmitTransition(async () => {
      const result =
        sendMode === "later"
          ? await (() => {
              const sendAt = convertDenverInputToDate(
                scheduleDate,
                scheduleTime,
              );
              if (sendAt === null) {
                return Promise.resolve({
                  ok: false as const,
                  message:
                    "Pick a valid Denver date and time before scheduling.",
                });
              }
              return schedule(draft.runId, sendAt);
            })()
          : await sendNow(draft.runId);

      if (!result.ok) {
        setToast({
          tone: "error",
          message: result.message,
        });
        return;
      }

      setRunState("scheduled");
      setScheduledAt(result.data.scheduledAt ?? null);
      setConfirmOpen(false);
      setCurrentStep(4);
      setToast({
        tone: "success",
        message:
          sendMode === "later"
            ? "Campaign scheduled."
            : "Campaign queued to send now.",
      });
    });
  }

  const statusLabel =
    saveState === "saving" || savePending
      ? "Saving draft…"
      : saveState === "saved"
        ? (saveMessage ?? "Saved")
        : saveState === "error"
          ? (saveMessage ?? "Save failed")
          : dirty
            ? "Unsaved changes"
            : "All changes saved";

  return (
    <div className="flex min-h-dvh w-full bg-slate-100 max-lg:flex-col">
      <WizardRail
        currentStep={currentStep}
        statusLabel={statusLabel}
        onStepChange={(index) => {
          if (!frozen && index <= currentStep) {
            setCurrentStep(index);
          }
        }}
        steps={STEPS}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {toast ? (
          <div
            className={cn(
              "fixed right-6 top-6 z-50 rounded-xl border px-4 py-2 text-sm shadow-lg",
              toast.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900",
            )}
            role="status"
            aria-live="polite"
          >
            {toast.message}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto bg-white px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto flex min-h-full w-full max-w-[1100px] flex-col">
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
                isAdmin={isAdmin}
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
                onContinue={() => {
                  void continueTo(3);
                }}
              />
            ) : null}

            {currentStep === 3 ? (
              <ComposeStep
                subject={subject}
                preheader={preheader}
                bodyPlaintext={bodyPlaintext}
                autosaveLabel={autosaveLabel}
                previewData={composePreview}
                previewLoading={previewPending}
                warningDismissed={warningDismissed}
                affectedContactsOpen={affectedContactsOpen}
                testSendOpen={testSendOpen}
                testRecipientEmail={testRecipientEmail}
                testSendPending={testSendPending}
                selectedSenderVerified={selectedSenderVerified}
                frozen={frozen}
                onSubjectChange={setSubject}
                onPreheaderChange={setPreheader}
                onBodyChange={(value) => {
                  setBodyPlaintext(value.bodyPlaintext);
                  setBodyHtml(value.bodyHtml);
                }}
                onBack={() => {
                  setCurrentStep(2);
                }}
                onContinue={() => {
                  void continueTo(4);
                }}
                onPreviewPrevious={() => {
                  setSampleIndex((current) => current - 1);
                }}
                onPreviewNext={() => {
                  setSampleIndex((current) => current + 1);
                }}
                onDismissWarning={() => {
                  setWarningDismissFingerprint(previewFingerprint);
                }}
                onAffectedContactsOpenChange={setAffectedContactsOpen}
                onTestSendOpenChange={setTestSendOpen}
                onTestRecipientEmailChange={setTestRecipientEmail}
                onSendTest={() => {
                  void handleTestSend();
                }}
              />
            ) : null}

            {currentStep === 4 ? (
              <ReviewStep
                kind={kind}
                projectChipLabel={readProjectChipLabel(
                  kind,
                  criteria,
                  bootstrap,
                )}
                runName={name.trim().length === 0 ? null : name}
                fromEmail={fromEmail}
                preheader={preheader}
                senderOptions={bootstrap.senderOptions}
                selectedSenderVerified={selectedSenderVerified}
                audienceSize={composePreview?.audienceSize ?? countState.count}
                previewData={composePreview}
                previewExpanded={reviewExpanded}
                sendMode={sendMode}
                scheduleDate={scheduleDate}
                scheduleTime={scheduleTime}
                frozen={frozen}
                frozenState={runState}
                frozenScheduledAt={scheduledAt}
                confirmOpen={confirmOpen}
                submitPending={submitPending}
                onRunNameChange={setName}
                onFromEmailChange={setFromEmail}
                onBack={() => {
                  if (!frozen) {
                    setCurrentStep(3);
                  }
                }}
                onRerunAudience={() => {
                  if (!frozen) {
                    setCurrentStep(2);
                  }
                }}
                onPreviewExpandedChange={setReviewExpanded}
                onSendModeChange={setSendMode}
                onScheduleDateChange={setScheduleDate}
                onScheduleTimeChange={setScheduleTime}
                onConfirmOpenChange={setConfirmOpen}
                onSubmit={() => {
                  void handleSubmit();
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
