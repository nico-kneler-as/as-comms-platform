"use client";

import type {
  AudienceCriteria,
  CampaignKind,
  ExpeditionMemberStatus,
} from "@as-comms/contracts";

import type {
  AudienceBuilderBootstrap,
  CampaignProjectOption,
  CampaignSenderOption,
  CampaignSenderType,
  CampaignWizardDraftData,
} from "../../_lib/audience-data-source";
import { cn } from "@/lib/utils";
import {
  confirmCampaignWizardDraftCurrentAction,
  saveCampaignWizardDraftAction,
  uploadBroadcastAudienceCsvAction,
} from "../../_lib/audience-data-source";
import {
  schedule,
  sendNow,
  sendSmsBroadcastNow,
  sendSmsBroadcastTest,
  testSend,
} from "../../actions";
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
import { useNewCampaignWizardState } from "./use-new-campaign-wizard-state";
import { type CampaignWizardStepDefinition, WizardRail } from "./wizard-rail";
import { WizardFooterLeftSlotProvider } from "./wizard-shell";

const STEPS: readonly CampaignWizardStepDefinition[] = [
  {
    id: "launch",
    title: "Launch type",
    subtitle:
      "Pick Normal Email for Markdown sends, HTML Email for the drag-and-drop composer, or SMS for plain-text broadcasts.",
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

export type SaveState = "idle" | "saving" | "saved" | "error";
export type ToastState = {
  readonly tone: "success" | "error";
  readonly message: string;
} | null;
type ProjectSelectionMode = "multi" | "single";

function normalizeProjectIds(projectIds: readonly string[]): string[] {
  return projectIds.filter(
    (projectId, index, values) =>
      projectId.trim().length > 0 && values.indexOf(projectId) === index,
  );
}

function readProjectIds(criteria: CampaignAudienceCriteria): string[] {
  return normalizeProjectIds([
    ...(criteria.projectId == null ? [] : [criteria.projectId]),
    ...criteria.projectIds,
  ]);
}

export function defaultAudienceModeForSenderType(
  senderType: CampaignSenderType | null,
): AudienceInitialFilter {
  return senderType === "org" ? "specific" : "project_status";
}

export function hasAppliedAudienceFilters(
  criteria: CampaignAudienceCriteria,
): boolean {
  if (criteria.initialFilter === undefined) {
    return false;
  }

  switch (criteria.initialFilter) {
    case "all_approved":
    case "all_available":
    case "csv_upload":
    case "project_status":
    case "specific":
      return true;
  }
}

export function deriveInitialFilter(
  draft: CampaignWizardDraftData,
): AudienceInitialFilter | undefined {
  if (draft.audienceCriteria.initialFilter !== undefined) {
    return draft.audienceCriteria.initialFilter;
  }

  if (
    (draft.audienceCriteria.contactIds?.length ?? 0) > 0 ||
    (draft.audienceCriteria.newsletterSubscriberIds?.length ?? 0) > 0
  ) {
    return "specific";
  }

  if (draft.kind === "newsletter") {
    return "all_available";
  }

  if (
    draft.audienceCriteria.projectId !== null ||
    draft.audienceCriteria.projectIds.length > 0 ||
    draft.audienceCriteria.statuses.length > 0
  ) {
    return "project_status";
  }

  return undefined;
}

export function kindForSenderType(
  senderType: CampaignSenderType | null,
  fallback: CampaignKind,
): CampaignKind {
  if (senderType === "org") {
    return "newsletter";
  }

  if (senderType === "project") {
    return "project";
  }

  return fallback;
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

export function buildDenverInputDefaults(now: Date): {
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

export function deriveSuggestedSenderEmail(input: {
  readonly kind: CampaignKind;
  readonly criteria: CampaignAudienceCriteria;
  readonly bootstrap: AudienceBuilderBootstrap;
}): string | null {
  if (input.kind !== "project") {
    return null;
  }

  const projectId = readProjectIds(input.criteria)[0] ?? null;
  if (projectId === null) {
    return null;
  }

  return (
    input.bootstrap.senderOptions.find(
      (option) =>
        option.projectId === projectId && option.status === "verified",
    )?.email ?? null
  );
}

export function readAliasProjectsForSender(
  bootstrap: AudienceBuilderBootstrap,
  senderOption: CampaignSenderOption | null,
): readonly CampaignProjectOption[] {
  if (
    senderOption === null ||
    senderOption.senderType === "org" ||
    senderOption.projectId === null
  ) {
    return [];
  }

  const hostProjectId =
    senderOption.connectedToProjectId ?? senderOption.projectId;
  const group =
    bootstrap.projects.find(
      (candidate) => candidate.host.id === hostProjectId,
    ) ?? null;
  if (group === null) {
    return [];
  }

  return [group.host, ...group.connectedSubs];
}

function buildCriteriaForMode(input: {
  readonly current: CampaignAudienceCriteria;
  readonly mode: AudienceInitialFilter;
  readonly projectOptions: readonly CampaignProjectOption[];
  readonly projectSelectionMode: ProjectSelectionMode;
}): CampaignAudienceCriteria {
  const availableProjectIds = normalizeProjectIds(
    input.projectOptions.map((project) => project.id),
  );
  const projectSelection =
    input.projectSelectionMode === "single"
      ? (() => {
          const selectedProjectId =
            readProjectIds(input.current).find((projectId) =>
              availableProjectIds.includes(projectId),
            ) ?? null;

          return {
            projectId: selectedProjectId,
            projectIds:
              selectedProjectId === null ? [] : [selectedProjectId],
          };
        })()
      : {
          projectId: availableProjectIds[0] ?? null,
          projectIds: availableProjectIds,
        };

  if (input.mode === "all_approved") {
    return {
      ...input.current,
      initialFilter: "all_approved",
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
    };
  }

  if (input.mode === "all_available") {
    return {
      ...input.current,
      initialFilter: "all_available",
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
    };
  }

  if (input.mode === "specific") {
    return {
      ...input.current,
      initialFilter: "specific",
      ...projectSelection,
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
    };
  }

  if (input.mode === "csv_upload") {
    return {
      ...input.current,
      initialFilter: "csv_upload",
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
    };
  }

  return {
    ...input.current,
    initialFilter: "project_status",
    ...projectSelection,
    statuses: [],
    contactIds: [],
    newsletterSubscriberIds: [],
  };
}

export function clearAudienceCriteria(
  criteria: CampaignAudienceCriteria,
): CampaignAudienceCriteria {
  return {
    ...criteria,
    initialFilter: undefined,
    projectId: null,
    projectIds: [],
    statuses: [],
    contactIds: [],
    newsletterSubscriberIds: [],
  };
}

function toActionCriteria(
  criteria: CampaignAudienceCriteria,
): AudienceCriteria {
  if (criteria.initialFilter === undefined) {
    const rest = { ...criteria };
    delete rest.initialFilter;
    return rest as Omit<CampaignAudienceCriteria, "initialFilter">;
  }

  return {
    ...criteria,
    initialFilter: criteria.initialFilter,
  };
}

function readProjectChipLabel(
  kind: CampaignKind,
  criteria: CampaignAudienceCriteria,
  bootstrap: AudienceBuilderBootstrap,
): string {
  if (kind === "newsletter") {
    return (criteria.contactIds?.length ?? 0) > 0
      ? "Specific individuals"
      : "Newsletter";
  }

  const byId = new Map(
    bootstrap.projects.flatMap((group) => [
      [group.host.id, group.host.name] as const,
      ...group.connectedSubs.map(
        (project) => [project.id, project.name] as const,
      ),
    ]),
  );
  const selectedProjectIds = readProjectIds(criteria);
  if (selectedProjectIds.length === 0) {
    return "Project";
  }

  const selectedProjectNames = selectedProjectIds
    .map((projectId) => byId.get(projectId))
    .filter((projectName): projectName is string => projectName !== undefined);
  if (selectedProjectNames.length === 0) {
    return "Project";
  }

  return selectedProjectNames.length === 1
    ? (selectedProjectNames[0] ?? "Project")
    : `${selectedProjectNames[0] ?? "Project"} +${String(selectedProjectNames.length - 1)} more`;
}

export function NewCampaignWizard({
  bootstrap,
  draft,
}: {
  readonly bootstrap: AudienceBuilderBootstrap;
  readonly draft: CampaignWizardDraftData;
  readonly isAdmin: boolean;
}) {
  const {
    currentStep,
    setCurrentStep,
    launchType,
    setLaunchType,
    name,
    setName,
    fromEmail,
    setFromEmail,
    replyToEmail,
    subject,
    setSubject,
    subjectB,
    setSubjectB,
    abTestEnabled,
    setAbTestEnabled,
    preheader,
    setPreheader,
    bodyPlaintext,
    setBodyPlaintext,
    bodyHtml,
    setBodyHtml,
    bodyDesignJson,
    setBodyDesignJson,
    selectedAliasSignature,
    criteria,
    setCriteria,
    hasPickedAudienceMode,
    setHasPickedAudienceMode,
    countState,
    setCountState,
    previewRows,
    setPreviewRows,
    previewErrorMessage,
    csvUploadSummary,
    setCsvUploadSummary,
    csvUploadErrorMessage,
    setCsvUploadErrorMessage,
    smsCsvAudienceSummary,
    smsCsvAudienceSummaryLoading,
    smsCsvAudienceSummaryErrorMessage,
    csvUploadPending,
    startCsvUploadTransition,
    setCsvUploadVersion,
    statusCounts,
    statusCountsLoading,
    statusCountsErrorMessage,
    volunteerSearchQuery,
    setVolunteerSearchQuery,
    volunteerSearchRows,
    setVolunteerSearchRows,
    volunteerSearchPending,
    volunteerSearchErrorMessage,
    setVolunteerSearchErrorMessage,
    composePreview,
    smsPreview,
    composePreviewPending,
    smsPreviewPending,
    setSampleIndex,
    setSaveState,
    setSaveMessage,
    setWarningDismissFingerprint,
    testSendOpen,
    setTestSendOpen,
    testRecipientEmail,
    setTestRecipientEmail,
    testPhoneE164,
    setTestPhoneE164,
    affectedContactsOpen,
    setAffectedContactsOpen,
    sendMode,
    setSendMode,
    scheduleDate,
    setScheduleDate,
    scheduleTime,
    setScheduleTime,
    confirmOpen,
    setConfirmOpen,
    runState,
    setRunState,
    scheduledAt,
    setScheduledAt,
    toast,
    setToast,
    countLoading,
    audiencePreviewLoading,
    savePending,
    startSaveTransition,
    submitPending,
    startSubmitTransition,
    testSendPending,
    startTestSendTransition,
    savedFingerprintRef,
    savedUpdatedAtRef,
    saveTimeoutRef,
    autosavePersistDraftRef,
    frozen,
    kind,
    availableAudienceModes,
    dirty,
    selectedSenderVerified,
    selectedSenderType,
    effectiveProjectOptions,
    projectSelectionMode,
    previewFingerprint,
    warningDismissed,
    statusLabel,
  } = useNewCampaignWizardState({ bootstrap, draft });
  const singleSelectProjects = projectSelectionMode === "single";

  function showPersistentSaveError(message: string) {
    if (saveTimeoutRef.current !== null) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    setSaveState("error");
    setSaveMessage(message);
  }

  async function confirmDraftCurrent(): Promise<boolean> {
    const result = await confirmCampaignWizardDraftCurrentAction({
      runId: draft.runId,
      observedUpdatedAt: savedUpdatedAtRef.current,
    });

    if (!result.ok) {
      showPersistentSaveError(result.message);
      return false;
    }

    savedUpdatedAtRef.current = result.data.updatedAt;
    return true;
  }

  async function persistDraft(
    successMessage: string,
    options?: { readonly requireCurrentWhenClean?: boolean },
  ): Promise<boolean> {
    if (frozen) {
      return true;
    }

    if (!dirty) {
      return options?.requireCurrentWhenClean === true
        ? await confirmDraftCurrent()
        : true;
    }

    return await new Promise<boolean>((resolve) => {
      startSaveTransition(async () => {
        setSaveState("saving");
        const isSmsLaunch = launchType === "sms";
        const result = await saveCampaignWizardDraftAction({
          runId: draft.runId,
          observedUpdatedAt: savedUpdatedAtRef.current,
          launchType,
          kind: isSmsLaunch ? "project" : kind,
          name: name.trim().length === 0 ? null : name.trim(),
          fromEmail: isSmsLaunch ? null : fromEmail,
          replyToEmail: isSmsLaunch ? null : replyToEmail,
          subjectTemplate:
            isSmsLaunch || subject.trim().length === 0 ? null : subject,
          subjectTemplateB:
            isSmsLaunch || subjectB.trim().length === 0 ? null : subjectB,
          abTestEnabled: isSmsLaunch ? false : abTestEnabled,
          bodyDesignJson: isSmsLaunch ? null : bodyDesignJson,
          bodyHtmlTemplate:
            isSmsLaunch || bodyHtml.trim().length === 0 ? null : bodyHtml,
          bodyTextTemplate:
            bodyPlaintext.trim().length === 0 ? null : bodyPlaintext,
          preheader:
            isSmsLaunch || preheader.trim().length === 0 ? null : preheader,
          audienceCriteria: toActionCriteria(criteria),
          audienceSize: countState.hasAppliedFilters ? countState.count : null,
        });

        if (!result.ok) {
          showPersistentSaveError(result.message);
          resolve(false);
          return;
        }

        savedUpdatedAtRef.current = result.data.updatedAt;
        savedFingerprintRef.current = JSON.stringify({
          launchType: result.data.launchType,
          kind: result.data.launchType === "sms" ? "project" : result.data.kind,
          name: result.data.name,
          fromEmail:
            result.data.launchType === "sms" ? null : result.data.fromEmail,
          replyToEmail:
            result.data.launchType === "sms" ? null : result.data.replyToEmail,
          subject:
            result.data.launchType === "sms"
              ? ""
              : (result.data.subjectTemplate ?? ""),
          subjectB:
            result.data.launchType === "sms"
              ? ""
              : (result.data.subjectTemplateB ?? ""),
          abTestEnabled:
            result.data.launchType === "sms"
              ? false
              : (result.data.abTestEnabled ?? false),
          preheader:
            result.data.launchType === "sms"
              ? ""
              : (result.data.preheader ?? ""),
          bodyPlaintext: result.data.bodyTextTemplate ?? "",
          bodyHtml:
            result.data.launchType === "sms"
              ? ""
              : (result.data.bodyHtmlTemplate ?? ""),
          bodyDesignJson: JSON.stringify(
            result.data.launchType === "sms"
              ? null
              : (result.data.bodyDesignJson ?? null),
          ),
          criteria: {
            ...result.data.audienceCriteria,
            projectId:
              result.data.audienceCriteria.projectId ??
              result.data.audienceCriteria.projectIds[0] ??
              null,
            contactIds: result.data.audienceCriteria.contactIds ?? [],
            newsletterSubscriberIds:
              result.data.audienceCriteria.newsletterSubscriberIds ?? [],
            initialFilter: criteria.initialFilter,
          },
          audienceSize: result.data.audienceSize,
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

  autosavePersistDraftRef.current = persistDraft;

  function updateCriteria(
    mutator: (current: CampaignAudienceCriteria) => CampaignAudienceCriteria,
  ) {
    setCriteria((current) => mutator(current));
  }

  function changeInitialFilter(value: AudienceInitialFilter) {
    setHasPickedAudienceMode(true);
    updateCriteria((current) =>
      buildCriteriaForMode({
        current,
        mode: value,
        projectOptions: effectiveProjectOptions,
        projectSelectionMode,
      }),
    );
    setVolunteerSearchQuery("");
    setVolunteerSearchRows([]);
    setVolunteerSearchErrorMessage(null);
    setCsvUploadErrorMessage(null);
  }

  function toggleProject(projectId: string) {
    updateCriteria((current) => {
      if (singleSelectProjects) {
        return {
          ...current,
          projectId,
          projectIds: [projectId],
          contactIds: [],
          newsletterSubscriberIds: [],
          statuses: [],
        };
      }

      const nextProjectIds = normalizeProjectIds(
        readProjectIds(current).includes(projectId)
          ? readProjectIds(current).filter((value) => value !== projectId)
          : [...readProjectIds(current), projectId],
      );

      return {
        ...current,
        projectIds: nextProjectIds,
        projectId: nextProjectIds[0] ?? null,
        contactIds: [],
        newsletterSubscriberIds: [],
        statuses: [],
      };
    });
    setVolunteerSearchQuery("");
    setVolunteerSearchRows([]);
    setVolunteerSearchErrorMessage(null);
    setCsvUploadErrorMessage(null);
  }

  function toggleAllStatuses(selectAll: boolean) {
    updateCriteria((current) => ({
      ...current,
      statuses: !selectAll
        ? []
        : bootstrap.statuses.filter((status) => {
            return statusCountsLoading || (statusCounts[status] ?? 0) > 0;
          }),
    }));
  }

  function toggleStatus(status: ExpeditionMemberStatus) {
    updateCriteria((current) => ({
      ...current,
      statuses: current.statuses.includes(status as never)
        ? current.statuses.filter(
            (value: ExpeditionMemberStatus) => value !== status,
          )
        : [...current.statuses, status],
    }));
  }

  function toggleVolunteer(contactId: string) {
    updateCriteria((current) => ({
      ...current,
      ...(selectedSenderType === "org"
        ? {
            newsletterSubscriberIds: (
              current.newsletterSubscriberIds ?? []
            ).includes(contactId)
              ? (current.newsletterSubscriberIds ?? []).filter(
                  (value) => value !== contactId,
                )
              : [...(current.newsletterSubscriberIds ?? []), contactId],
          }
        : {
            contactIds: (current.contactIds ?? []).includes(contactId)
              ? (current.contactIds ?? []).filter(
                  (value) => value !== contactId,
                )
              : [...(current.contactIds ?? []), contactId],
          }),
    }));
  }

  async function handleCsvUpload(csvText: string) {
    await new Promise<void>((resolve) => {
      startCsvUploadTransition(async () => {
        const result = await uploadBroadcastAudienceCsvAction({
          runId: draft.runId,
          csvText,
        });

        if (!result.ok) {
          setCsvUploadErrorMessage(result.message);
          resolve();
          return;
        }

        setCsvUploadSummary(result.data);
        setCsvUploadErrorMessage(null);
        if (launchType === "sms") {
          setCountState({
            count: 0,
            hasAppliedFilters: true,
          });
          setPreviewRows([]);
        } else {
          setCountState({
            count: result.data.importedCount,
            hasAppliedFilters: true,
          });
          setPreviewRows(result.data.sample);
        }
        setCsvUploadVersion((current) => current + 1);
        resolve();
      });
    });
  }

  async function continueTo(step: number) {
    const saved = await persistDraft("Saved");
    if (saved) {
      setCurrentStep(step);
    }
  }

  async function handleTestSend() {
    const saved = await persistDraft("Saved", {
      requireCurrentWhenClean: true,
    });
    if (!saved) {
      return;
    }

    startTestSendTransition(async () => {
      if (launchType === "sms") {
        const result = await sendSmsBroadcastTest({
          runId: draft.runId,
          toPhoneE164: testPhoneE164,
        });
        if (!result.ok) {
          setToast({
            tone: "error",
            message: result.message,
          });
          return;
        }

        setToast({
          tone: "success",
          message: `Test sent to ${testPhoneE164} (${String(result.data.segments)} segments).`,
        });
        setTestSendOpen(false);
        return;
      }

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
    const saved = await persistDraft("Saved", {
      requireCurrentWhenClean: true,
    });
    if (!saved) {
      return;
    }

    startSubmitTransition(async () => {
      if (launchType === "sms") {
        const result = await sendSmsBroadcastNow({ runId: draft.runId });
        if (!result.ok) {
          setToast({
            tone: "error",
            message: result.message,
          });
          return;
        }

        setRunState("scheduled");
        setScheduledAt(new Date().toISOString());
        setConfirmOpen(false);
        setCurrentStep(5);
        setToast({
          tone: "success",
          message: `Sending ${String(result.data.frozen)} messages; ${String(
            Math.max(result.data.selected - result.data.frozen, 0),
          )} suppressed or unreachable.`,
        });
        return;
      }

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

      <WizardFooterLeftSlotProvider value={null}>
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
            <div
              className={cn(
                "flex min-h-full w-full flex-col",
                currentStep === 3 && launchType === "html_email"
                  ? null
                  : "mx-auto max-w-3xl",
              )}
            >
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
                  launchType={launchType}
                  name={name}
                  fromEmail={fromEmail}
                  senderOptions={bootstrap.senderOptions}
                  activeSmsSender={bootstrap.activeSmsSender}
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
                  launchType={launchType}
                  availableModes={availableAudienceModes}
                  hasPickedMode={hasPickedAudienceMode}
                  criteria={criteria}
                  selectedSenderType={selectedSenderType}
                  countState={countState}
                  previewRows={previewRows}
                  countLoading={countLoading}
                  previewLoading={audiencePreviewLoading}
                  previewErrorMessage={previewErrorMessage}
                  volunteerSearchQuery={volunteerSearchQuery}
                  volunteerSearchRows={volunteerSearchRows}
                  volunteerSearchLoading={volunteerSearchPending}
                  volunteerSearchErrorMessage={volunteerSearchErrorMessage}
                  csvUploadSummary={csvUploadSummary}
                  csvUploadPending={csvUploadPending}
                  csvUploadErrorMessage={csvUploadErrorMessage}
                  smsCsvAudienceSummary={smsCsvAudienceSummary}
                  smsCsvAudienceSummaryLoading={smsCsvAudienceSummaryLoading}
                  smsCsvAudienceSummaryErrorMessage={
                    smsCsvAudienceSummaryErrorMessage
                  }
                  projectOptions={effectiveProjectOptions}
                  singleSelectProjects={singleSelectProjects}
                  statusOptions={bootstrap.statuses}
                  statusCounts={statusCounts}
                  statusCountsLoading={statusCountsLoading}
                  statusCountsErrorMessage={statusCountsErrorMessage}
                  onInitialFilterChange={changeInitialFilter}
                  onProjectChange={toggleProject}
                  onToggleAllStatuses={toggleAllStatuses}
                  onStatusToggle={toggleStatus}
                  onVolunteerSearchQueryChange={setVolunteerSearchQuery}
                  onVolunteerToggle={toggleVolunteer}
                  onCsvUpload={handleCsvUpload}
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
                  launchType={launchType}
                  subject={subject}
                  subjectB={subjectB}
                  abTestEnabled={abTestEnabled}
                  preheader={preheader}
                  bodyPlaintext={bodyPlaintext}
                  bodyHtml={bodyHtml}
                  savedDesign={bodyDesignJson}
                  selectedAliasSignature={selectedAliasSignature}
                  frozen={frozen}
                  continuePending={savePending}
                  onSubjectChange={setSubject}
                  onSubjectBChange={setSubjectB}
                  onAbTestEnabledChange={setAbTestEnabled}
                  onPreheaderChange={setPreheader}
                  onBodyChange={(value) => {
                    setBodyDesignJson(value.bodyDesignJson);
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
                  launchType={launchType}
                  subject={subject}
                  preheader={preheader}
                  previewData={composePreview}
                  smsPreviewData={smsPreview}
                  previewLoading={
                    launchType === "sms"
                      ? smsPreviewPending
                      : composePreviewPending
                  }
                  warningDismissed={warningDismissed}
                  affectedContactsOpen={affectedContactsOpen}
                  testSendOpen={testSendOpen}
                  testRecipientValue={
                    launchType === "sms" ? testPhoneE164 : testRecipientEmail
                  }
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
                  onTestRecipientValueChange={(value) => {
                    if (launchType === "sms") {
                      setTestPhoneE164(value);
                      return;
                    }

                    setTestRecipientEmail(value);
                  }}
                  onSendTest={() => {
                    void handleTestSend();
                  }}
                />
              ) : null}

              {currentStep === 5 ? (
                <ReviewStep
                  launchType={launchType}
                  projectChipLabel={readProjectChipLabel(
                    kind,
                    criteria,
                    bootstrap,
                  )}
                  runName={name.trim().length === 0 ? null : name}
                  fromEmail={launchType === "sms" ? null : fromEmail}
                  subject={composePreview?.sample?.subject ?? subject}
                  selectedSenderVerified={selectedSenderVerified}
                  audienceSize={composePreview?.audienceSize ?? countState.count}
                  smsPreviewData={smsPreview}
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
      </WizardFooterLeftSlotProvider>
    </div>
  );
}
