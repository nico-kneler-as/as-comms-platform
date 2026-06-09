"use client";

import type {
  AudienceCriteria,
  CampaignKind,
  ExpeditionMemberStatus,
  LaunchType,
} from "@as-comms/contracts";

import type {
  AudienceBuilderBootstrap,
  CampaignProjectOption,
  CampaignSenderOption,
  CampaignWizardDraftData,
} from "../../_lib/audience-data-source";
import { cn } from "@/lib/utils";
import { saveCampaignWizardDraftAction } from "../../_lib/audience-data-source";
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
import { useNewCampaignWizardState } from "./use-new-campaign-wizard-state";
import { type CampaignWizardStepDefinition, WizardRail } from "./wizard-rail";

const STEPS: readonly CampaignWizardStepDefinition[] = [
  {
    id: "launch",
    title: "Launch type",
    subtitle: "Pick Normal Email for Markdown sends or HTML Email for the drag-and-drop composer.",
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

export function defaultAudienceModeForLaunchType(
  launchType: LaunchType,
): AudienceInitialFilter {
  return launchType === "html_email" ? "all_approved" : "project_status";
}

function readAudienceModesForLaunchType(
  launchType: LaunchType,
): readonly AudienceInitialFilter[] {
  return launchType === "html_email"
    ? ["all_approved", "specific", "project_status"]
    : ["project_status", "specific"];
}

export function hasAppliedAudienceFilters(
  criteria: CampaignAudienceCriteria,
): boolean {
  if (criteria.initialFilter === undefined) {
    return false;
  }

  switch (criteria.initialFilter) {
    case "all_approved":
    case "project_status":
    case "specific":
      return true;
  }
}

export function deriveInitialFilter(
  draft: CampaignWizardDraftData,
): AudienceInitialFilter | undefined {
  if (draft.kind === "newsletter") {
    return "all_approved";
  }

  if ((draft.audienceCriteria.contactIds?.length ?? 0) > 0) {
    return "specific";
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

export function kindForAudienceMode(mode: AudienceInitialFilter): CampaignKind {
  return mode === "all_approved" ? "newsletter" : "project";
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
  if (senderOption === null) {
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
  readonly aliasProjects: readonly CampaignProjectOption[];
}): CampaignAudienceCriteria {
  const aliasProjectIds = input.aliasProjects.map((project) => project.id);

  if (input.mode === "all_approved") {
    return {
      ...input.current,
      initialFilter: "all_approved",
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
    };
  }

  if (input.mode === "specific") {
    return {
      ...input.current,
      initialFilter: "specific",
      projectId: aliasProjectIds[0] ?? null,
      projectIds: aliasProjectIds,
      statuses: [],
      contactIds: [],
    };
  }

  return {
    ...input.current,
    initialFilter: "project_status",
    projectId: aliasProjectIds[0] ?? null,
    projectIds: aliasProjectIds,
    statuses: [],
    contactIds: [],
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
  };
}

function toActionCriteria(
  criteria: CampaignAudienceCriteria,
): AudienceCriteria & {
  readonly initialFilter?: AudienceInitialFilter;
} {
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
    previewRows,
    previewErrorMessage,
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
    composePreviewPending,
    setSampleIndex,
    setSaveState,
    setSaveMessage,
    setWarningDismissFingerprint,
    testSendOpen,
    setTestSendOpen,
    testRecipientEmail,
    setTestRecipientEmail,
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
    saveTimeoutRef,
    autosavePersistDraftRef,
    frozen,
    kind,
    dirty,
    selectedSenderVerified,
    aliasProjects,
    previewFingerprint,
    warningDismissed,
    statusLabel,
  } = useNewCampaignWizardState({ bootstrap, draft });

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
          bodyDesignJson,
          bodyHtmlTemplate: bodyHtml.trim().length === 0 ? null : bodyHtml,
          bodyTextTemplate:
            bodyPlaintext.trim().length === 0 ? null : bodyPlaintext,
          preheader: preheader.trim().length === 0 ? null : preheader,
          audienceCriteria: toActionCriteria(criteria),
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
          bodyDesignJson: JSON.stringify(result.data.bodyDesignJson ?? null),
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
        aliasProjects,
      }),
    );
    setVolunteerSearchQuery("");
    setVolunteerSearchRows([]);
    setVolunteerSearchErrorMessage(null);
  }

  function toggleProject(projectId: string) {
    updateCriteria((current) => ({
      ...current,
      projectIds: normalizeProjectIds(
        readProjectIds(current).includes(projectId)
          ? readProjectIds(current).filter((value) => value !== projectId)
          : [...readProjectIds(current), projectId],
      ),
      projectId:
        normalizeProjectIds(
          readProjectIds(current).includes(projectId)
            ? readProjectIds(current).filter((value) => value !== projectId)
            : [...readProjectIds(current), projectId],
        )[0] ?? null,
      contactIds: [],
      statuses: [],
    }));
    setVolunteerSearchQuery("");
    setVolunteerSearchRows([]);
    setVolunteerSearchErrorMessage(null);
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
                availableModes={readAudienceModesForLaunchType(launchType)}
                hasPickedMode={hasPickedAudienceMode}
                criteria={criteria}
                countState={countState}
                previewRows={previewRows}
                countLoading={countLoading}
                previewLoading={audiencePreviewLoading}
                previewErrorMessage={previewErrorMessage}
                volunteerSearchQuery={volunteerSearchQuery}
                volunteerSearchRows={volunteerSearchRows}
                volunteerSearchLoading={volunteerSearchPending}
                volunteerSearchErrorMessage={volunteerSearchErrorMessage}
                projectOptions={aliasProjects}
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
                preheader={preheader}
                bodyPlaintext={bodyPlaintext}
                savedDesign={bodyDesignJson}
                selectedAliasSignature={selectedAliasSignature}
                frozen={frozen}
                continuePending={savePending}
                onSubjectChange={setSubject}
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
                previewLoading={composePreviewPending}
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
