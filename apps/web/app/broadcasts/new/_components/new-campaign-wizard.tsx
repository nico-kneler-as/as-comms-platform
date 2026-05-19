"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { CampaignKind, LaunchType } from "@as-comms/contracts";

import type {
  AudienceBuilderBootstrap,
  AudiencePreviewRow,
  AudienceVolunteerSearchRow,
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
  searchProjectVolunteersAction,
} from "../../_lib/audience-data-source";
import { schedule, sendNow, testSend } from "../../actions";
import {
  AudienceBuilderStep,
  type AudienceInitialFilter,
  type CampaignAudienceCriteria,
} from "./audience-builder-step";
import { ComposeStep } from "./compose-step";
import { LaunchTypeStep } from "./launch-type-step";
import { NameAndSenderStep } from "./name-and-sender-step";
import { PreviewStep } from "./preview-step";
import { ReviewStep } from "./review-step";
import { type CampaignWizardStepDefinition, WizardRail } from "./wizard-rail";

const STEPS: readonly CampaignWizardStepDefinition[] = [
  {
    id: "launch",
    title: "Launch type",
    subtitle: "Normal Email is the only active path in Phase A.",
  },
  {
    id: "setup",
    title: "Name & sender",
    subtitle: "Name the broadcast and choose a verified sender.",
  },
  {
    id: "audience",
    title: "Audience",
    subtitle: "Filters resolve live against canonical contacts.",
  },
  {
    id: "compose",
    title: "Write your email",
    subtitle: "Draft the subject, preheader, and broadcast body.",
  },
  {
    id: "preview",
    title: "Preview",
    subtitle: "Render samples and send a test email.",
  },
  {
    id: "review",
    title: "Review + send",
    subtitle: "Confirm the final checks and send timing.",
  },
];

type SaveState = "idle" | "saving" | "saved" | "error";
type ToastState = {
  readonly tone: "success" | "error";
  readonly message: string;
} | null;

function hasAppliedAudienceFilters(criteria: CampaignAudienceCriteria): boolean {
  return (
    criteria.projectId != null ||
    criteria.statuses.length > 0 ||
    (criteria.contactIds?.length ?? 0) > 0
  );
}

function deriveInitialFilter(
  draft: CampaignWizardDraftData,
): AudienceInitialFilter {
  return (draft.audienceCriteria.contactIds?.length ?? 0) > 0
    ? "specific"
    : "project_status";
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
  readonly criteria: CampaignAudienceCriteria;
  readonly bootstrap: AudienceBuilderBootstrap;
}): string | null {
  if (input.kind !== "project" || input.criteria.projectId == null) {
    return null;
  }

  return (
    input.bootstrap.senderOptions.find(
      (option) =>
        option.projectId === input.criteria.projectId &&
        option.status === "verified",
    )?.email ?? null
  );
}

function readProjectChipLabel(
  kind: CampaignKind,
  criteria: CampaignAudienceCriteria,
  bootstrap: AudienceBuilderBootstrap,
): string {
  if (kind === "newsletter") {
    return "All AS";
  }

  const byId = new Map(
    bootstrap.projects.flatMap((group) => [
      [group.host.id, group.host.name] as const,
      ...group.connectedSubs.map(
        (project) => [project.id, project.name] as const,
      ),
    ]),
  );
  return criteria.projectId == null
    ? "Project"
    : (byId.get(criteria.projectId) ?? "Project");
}

export function NewCampaignWizard({
  bootstrap,
  draft,
}: {
  readonly bootstrap: AudienceBuilderBootstrap;
  readonly draft: CampaignWizardDraftData;
  readonly isAdmin: boolean;
}) {
  const initialSchedule = buildDenverInputDefaults(new Date());
  const [currentStep, setCurrentStep] = useState(
    draft.state === "draft" ? 0 : 5,
  );
  const [launchType, setLaunchType] = useState<LaunchType>(draft.launchType);
  const [name, setName] = useState(draft.name ?? "");
  const [fromEmail, setFromEmail] = useState(draft.fromEmail);
  const [replyToEmail, setReplyToEmail] = useState(draft.replyToEmail);
  const [subject, setSubject] = useState(draft.subjectTemplate ?? "");
  const [preheader, setPreheader] = useState(draft.preheader ?? "");
  const [bodyPlaintext, setBodyPlaintext] = useState(
    draft.bodyTextTemplate ?? "",
  );
  const [bodyHtml, setBodyHtml] = useState(draft.bodyHtmlTemplate ?? "");
  const [criteria, setCriteria] = useState<CampaignAudienceCriteria>({
    ...draft.audienceCriteria,
    projectId: draft.audienceCriteria.projectId ?? draft.audienceCriteria.projectIds[0] ?? null,
    contactIds: draft.audienceCriteria.contactIds ?? [],
    initialFilter: deriveInitialFilter(draft),
  });
  const [countState, setCountState] = useState({
    count: draft.audienceSize ?? 0,
    hasAppliedFilters: hasAppliedAudienceFilters({
      ...draft.audienceCriteria,
      projectId:
        draft.audienceCriteria.projectId ??
        draft.audienceCriteria.projectIds[0] ??
        null,
      contactIds: draft.audienceCriteria.contactIds ?? [],
      initialFilter: deriveInitialFilter(draft),
    }),
  });
  const [previewRows, setPreviewRows] = useState<readonly AudiencePreviewRow[]>(
    [],
  );
  const [volunteerSearchQuery, setVolunteerSearchQuery] = useState("");
  const [volunteerSearchRows, setVolunteerSearchRows] = useState<
    readonly AudienceVolunteerSearchRow[]
  >([]);
  const [volunteerSearchErrorMessage, setVolunteerSearchErrorMessage] =
    useState<string | null>(null);
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
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduleDate, setScheduleDate] = useState(initialSchedule.date);
  const [scheduleTime, setScheduleTime] = useState(initialSchedule.time);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runState, setRunState] = useState(draft.state);
  const [scheduledAt, setScheduledAt] = useState(draft.scheduledAt);
  const [toast, setToast] = useState<ToastState>(null);
  const [countPending, startCountTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [volunteerSearchPending, startVolunteerSearchTransition] =
    useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const [submitPending, startSubmitTransition] = useTransition();
  const [testSendPending, startTestSendTransition] = useTransition();
  const countRequestRef = useRef(0);
  const audiencePreviewRequestRef = useRef(0);
  const volunteerSearchRequestRef = useRef(0);
  const composePreviewRequestRef = useRef(0);
  const savedFingerprintRef = useRef("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const frozen = runState !== "draft";
  const kind: CampaignKind = "project";
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
    const initialCriteria = {
      ...draft.audienceCriteria,
      projectId:
        draft.audienceCriteria.projectId ??
        draft.audienceCriteria.projectIds[0] ??
        null,
      initialFilter: deriveInitialFilter(draft),
    };
    savedFingerprintRef.current = JSON.stringify({
      launchType: draft.launchType,
      kind: "project",
      name: draft.name,
      fromEmail: draft.fromEmail,
      replyToEmail: draft.replyToEmail,
      subject: draft.subjectTemplate ?? "",
      preheader: draft.preheader ?? "",
      bodyPlaintext: draft.bodyTextTemplate ?? "",
      bodyHtml: draft.bodyHtmlTemplate ?? "",
      criteria: initialCriteria,
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
    if (criteria.projectId != null || selectedSenderOption === null) {
      return;
    }

    setCriteria((current) =>
      current.projectId === null
        ? {
            ...current,
            projectId: selectedSenderOption.projectId,
          }
        : current,
    );
  }, [criteria.projectId, selectedSenderOption]);

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
    if (currentStep !== 2) {
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
  }, [criteria, currentStep]);

  useEffect(() => {
    if (currentStep !== 2 || criteria.initialFilter !== "specific") {
      setVolunteerSearchRows([]);
      setVolunteerSearchErrorMessage(null);
      return;
    }

    if (criteria.projectId == null || volunteerSearchQuery.trim().length < 2) {
      setVolunteerSearchRows([]);
      setVolunteerSearchErrorMessage(null);
      return;
    }

    const requestId = ++volunteerSearchRequestRef.current;
    const timer = setTimeout(() => {
      startVolunteerSearchTransition(async () => {
        const result = await searchProjectVolunteersAction({
          projectId: criteria.projectId ?? null,
          query: volunteerSearchQuery,
        });
        if (requestId !== volunteerSearchRequestRef.current) {
          return;
        }

        if (!result.ok) {
          setVolunteerSearchErrorMessage(result.message);
          return;
        }

        setVolunteerSearchRows(result.data);
        setVolunteerSearchErrorMessage(null);
      });
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [
    criteria.initialFilter,
    criteria.projectId,
    currentStep,
    volunteerSearchQuery,
  ]);

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
          criteria: {
            ...result.data.audienceCriteria,
            projectId:
              result.data.audienceCriteria.projectId ??
              result.data.audienceCriteria.projectIds[0] ??
              null,
            initialFilter: criteria.initialFilter,
          },
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
    mutator: (current: CampaignAudienceCriteria) => CampaignAudienceCriteria,
  ) {
    setCriteria((current) => mutator(current));
  }

  function changeInitialFilter(value: AudienceInitialFilter) {
    updateCriteria((current) => ({
      ...current,
      initialFilter: value,
      contactIds: value === "specific" ? (current.contactIds ?? []) : [],
    }));
  }

  function changeProject(projectId: string) {
    updateCriteria((current) => ({
      ...current,
      projectId,
      projectIds: [projectId],
      contactIds:
        current.projectId === projectId ? (current.contactIds ?? []) : [],
    }));
    setVolunteerSearchQuery("");
    setVolunteerSearchRows([]);
    setVolunteerSearchErrorMessage(null);
  }

  function toggleStatus(status: string) {
    updateCriteria((current) => ({
      ...current,
      statuses: current.statuses.includes(status as never)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status as never],
    }));
  }

  function toggleVolunteer(contactId: string) {
    updateCriteria((current) => ({
      ...current,
      contactIds: (current.contactIds ?? []).includes(contactId)
        ? (current.contactIds ?? []).filter((value) => value !== contactId)
        : [...(current.contactIds ?? []), contactId],
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
      setCurrentStep(5);
      setToast({
        tone: "success",
        message:
          sendMode === "later"
            ? "Broadcast scheduled."
            : "Broadcast queued to send now.",
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

        <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
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
              <NameAndSenderStep
                name={name}
                fromEmail={fromEmail}
                senderOptions={bootstrap.senderOptions}
                frozen={frozen}
                onNameChange={setName}
                onFromEmailChange={setFromEmail}
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
                previewErrorMessage={saveState === "error" ? saveMessage : null}
                volunteerSearchQuery={volunteerSearchQuery}
                volunteerSearchRows={volunteerSearchRows}
                volunteerSearchLoading={volunteerSearchPending}
                volunteerSearchErrorMessage={volunteerSearchErrorMessage}
                projectGroups={bootstrap.projects}
                statusOptions={bootstrap.statuses}
                onInitialFilterChange={changeInitialFilter}
                onProjectChange={changeProject}
                onStatusToggle={toggleStatus}
                onVolunteerSearchQueryChange={setVolunteerSearchQuery}
                onVolunteerToggle={toggleVolunteer}
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
              />
            ) : null}

            {currentStep === 4 ? (
              <PreviewStep
                subject={subject}
                preheader={preheader}
                previewData={composePreview}
                previewLoading={previewPending}
                warningDismissed={warningDismissed}
                affectedContactsOpen={affectedContactsOpen}
                testSendOpen={testSendOpen}
                testRecipientEmail={testRecipientEmail}
                testSendPending={testSendPending}
                selectedSenderVerified={selectedSenderVerified}
                frozen={frozen}
                onBack={() => {
                  setCurrentStep(3);
                }}
                onContinue={() => {
                  void continueTo(5);
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

            {currentStep === 5 ? (
              <ReviewStep
                kind={kind}
                projectChipLabel={readProjectChipLabel(
                  kind,
                  criteria,
                  bootstrap,
                )}
                runName={name.trim().length === 0 ? null : name}
                fromEmail={fromEmail}
                subject={composePreview?.sample?.subject ?? subject}
                selectedSenderVerified={selectedSenderVerified}
                audienceSize={composePreview?.audienceSize ?? countState.count}
                sendMode={sendMode}
                scheduleDate={scheduleDate}
                scheduleTime={scheduleTime}
                frozen={frozen}
                frozenState={runState}
                frozenScheduledAt={scheduledAt}
                confirmOpen={confirmOpen}
                submitPending={submitPending}
                onBack={() => {
                  if (!frozen) {
                    setCurrentStep(4);
                  }
                }}
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
