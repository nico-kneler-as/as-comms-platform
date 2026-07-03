import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  AudienceCriteria,
  CampaignKind,
  ExpeditionMemberStatus,
  LaunchType,
} from "@as-comms/contracts";

import type {
  AudienceBuilderBootstrap,
  AudienceNewsletterSubscriberSearchRow,
  AudiencePreviewRow,
  AudienceStatusCounts,
  AudienceVolunteerSearchRow,
  CampaignProjectOption,
  CampaignSenderOption,
  CampaignSenderType,
  CampaignWizardDraftData,
  ComposePreviewData,
} from "../../_lib/audience-data-source";
import {
  loadComposePreviewAction,
  loadMemberStatusCountsForProjects,
  loadSelectedAliasSignatureAction,
  previewAudienceAction,
  resolveAudienceCountAction,
  searchNewsletterSubscribersAction,
  searchProjectVolunteersAction,
} from "../../_lib/audience-data-source";
import { previewSmsBroadcast } from "../../actions";
import type {
  AudienceInitialFilter,
  CampaignAudienceCriteria,
} from "./audience-builder-step";

type AutosavePersistDraft = (successMessage: string) => Promise<boolean>;
interface SmsPreviewData {
  readonly selected: number;
  readonly reachable: number;
  readonly deduplicatedByPhone: number;
  readonly frozen: number;
  readonly unreachable: Readonly<Record<string, number>>;
  readonly totalSegments: number;
  readonly estCostUsd: number;
  readonly sampleBody: string | null;
}

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

function defaultAudienceModeForSenderType(
  senderType: CampaignSenderType | null,
): AudienceInitialFilter {
  return senderType === "org" ? "specific" : "project_status";
}

export function readAllowedAudienceModesForSenderType(
  senderType: CampaignSenderType | null,
): readonly AudienceInitialFilter[] {
  return senderType === "org"
    ? ["specific", "all_available"]
    : ["project_status", "specific"];
}

function hasAppliedAudienceFilters(
  criteria: CampaignAudienceCriteria,
): boolean {
  if (criteria.initialFilter === undefined) {
    return false;
  }

  switch (criteria.initialFilter) {
    case "all_approved":
    case "all_available":
    case "project_status":
    case "specific":
      return true;
  }
}

function deriveInitialFilter(
  draft: CampaignWizardDraftData,
): AudienceInitialFilter | undefined {
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

function kindForSenderType(
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

function flattenProjectGroups(
  groups: readonly {
    readonly host: CampaignProjectOption;
    readonly connectedSubs: readonly CampaignProjectOption[];
  }[],
): readonly CampaignProjectOption[] {
  return groups.flatMap((group) => [group.host, ...group.connectedSubs]);
}

function buildDraftFingerprint(input: {
  readonly launchType: LaunchType;
  readonly kind: CampaignKind;
  readonly name: string | null;
  readonly fromEmail: string | null;
  readonly replyToEmail: string | null;
  readonly subject: string;
  readonly preheader: string;
  readonly bodyPlaintext: string;
  readonly bodyHtml: string;
  readonly bodyDesignJsonFingerprint: string;
  readonly criteria: CampaignAudienceCriteria;
  readonly audienceSize: number | null;
}): string {
  const isSmsLaunch = input.launchType === "sms";

  return JSON.stringify({
    launchType: input.launchType,
    kind: isSmsLaunch ? "project" : input.kind,
    name: input.name,
    fromEmail: isSmsLaunch ? null : input.fromEmail,
    replyToEmail: isSmsLaunch ? null : input.replyToEmail,
    subject: isSmsLaunch ? "" : input.subject,
    preheader: isSmsLaunch ? "" : input.preheader,
    bodyPlaintext: input.bodyPlaintext,
    bodyHtml: isSmsLaunch ? "" : input.bodyHtml,
    bodyDesignJson: isSmsLaunch
      ? JSON.stringify(null)
      : input.bodyDesignJsonFingerprint,
    criteria: input.criteria,
    audienceSize: input.audienceSize,
  });
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

function deriveSuggestedSenderEmail(input: {
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

function readAliasProjectsForSender(
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
      projectId: aliasProjectIds[0] ?? null,
      projectIds: aliasProjectIds,
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
    };
  }

  return {
    ...input.current,
    initialFilter: "project_status",
    projectId: aliasProjectIds[0] ?? null,
    projectIds: aliasProjectIds,
    statuses: [],
    contactIds: [],
    newsletterSubscriberIds: [],
  };
}

function clearAudienceCriteria(
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

export function useNewCampaignWizardState({
  bootstrap,
  draft,
}: {
  readonly bootstrap: AudienceBuilderBootstrap;
  readonly draft: CampaignWizardDraftData;
}) {
  const initialSchedule = buildDenverInputDefaults(new Date());
  const initialAudienceMode = deriveInitialFilter(draft);
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
  const [bodyDesignJson, setBodyDesignJson] = useState<unknown>(
    draft.bodyDesignJson ?? null,
  );
  const [selectedAliasSignature, setSelectedAliasSignature] = useState("");
  const [criteria, setCriteria] = useState<CampaignAudienceCriteria>({
    ...draft.audienceCriteria,
    projectId:
      draft.audienceCriteria.projectId ??
      draft.audienceCriteria.projectIds[0] ??
      null,
    contactIds: draft.audienceCriteria.contactIds ?? [],
    newsletterSubscriberIds:
      draft.audienceCriteria.newsletterSubscriberIds ?? [],
    initialFilter: initialAudienceMode,
  });
  const [hasPickedAudienceMode, setHasPickedAudienceMode] = useState(
    initialAudienceMode !== undefined,
  );
  const [countState, setCountState] = useState({
    count: draft.audienceSize ?? 0,
    hasAppliedFilters: hasAppliedAudienceFilters({
      ...draft.audienceCriteria,
      projectId:
        draft.audienceCriteria.projectId ??
        draft.audienceCriteria.projectIds[0] ??
        null,
      contactIds: draft.audienceCriteria.contactIds ?? [],
      newsletterSubscriberIds:
        draft.audienceCriteria.newsletterSubscriberIds ?? [],
      initialFilter: initialAudienceMode,
    }),
  });
  const [previewRows, setPreviewRows] = useState<readonly AudiencePreviewRow[]>(
    [],
  );
  const [previewErrorMessage, setPreviewErrorMessage] = useState<string | null>(
    null,
  );
  const [statusCounts, setStatusCounts] = useState<AudienceStatusCounts>({});
  const [statusCountsLoading, setStatusCountsLoading] = useState(false);
  const [statusCountsErrorMessage, setStatusCountsErrorMessage] = useState<
    string | null
  >(null);
  const [volunteerSearchQuery, setVolunteerSearchQuery] = useState("");
  const [volunteerSearchRows, setVolunteerSearchRows] = useState<
    readonly (
      | AudienceVolunteerSearchRow
      | AudienceNewsletterSubscriberSearchRow
    )[]
  >([]);
  const [volunteerSearchErrorMessage, setVolunteerSearchErrorMessage] =
    useState<string | null>(null);
  const [composePreview, setComposePreview] =
    useState<ComposePreviewData | null>(null);
  const [smsPreview, setSmsPreview] = useState<SmsPreviewData | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [warningDismissFingerprint, setWarningDismissFingerprint] = useState<
    string | null
  >(null);
  const [testSendOpen, setTestSendOpen] = useState(false);
  const [testRecipientEmail, setTestRecipientEmail] = useState(
    draft.operatorEmail,
  );
  const [testPhoneE164, setTestPhoneE164] = useState("");
  const [affectedContactsOpen, setAffectedContactsOpen] = useState(false);
  const [sendMode, setSendMode] = useState<"now" | "later">("now");
  const [scheduleDate, setScheduleDate] = useState(initialSchedule.date);
  const [scheduleTime, setScheduleTime] = useState(initialSchedule.time);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runState, setRunState] = useState(draft.state);
  const [scheduledAt, setScheduledAt] = useState(draft.scheduledAt);
  const [toast, setToast] = useState<{
    readonly tone: "success" | "error";
    readonly message: string;
  } | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [audiencePreviewLoading, setAudiencePreviewLoading] = useState(false);
  const [, startCountTransition] = useTransition();
  const [composePreviewPending, startComposePreviewTransition] =
    useTransition();
  const [smsPreviewPending, startSmsPreviewTransition] = useTransition();
  const [, startStatusCountsTransition] = useTransition();
  const [volunteerSearchPending, startVolunteerSearchTransition] =
    useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const [submitPending, startSubmitTransition] = useTransition();
  const [testSendPending, startTestSendTransition] = useTransition();
  const countRequestRef = useRef(0);
  const statusCountsRequestRef = useRef(0);
  const audiencePreviewRequestRef = useRef(0);
  const volunteerSearchRequestRef = useRef(0);
  const composePreviewRequestRef = useRef(0);
  const signatureRequestRef = useRef(0);
  const savedFingerprintRef = useRef("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLaunchTypeRef = useRef(draft.launchType);
  const previousFromEmailRef = useRef(draft.fromEmail);
  const autosavePersistDraftRef = useRef<AutosavePersistDraft | null>(null);

  const frozen = runState !== "draft";
  const previewFingerprint = useMemo(
    () => JSON.stringify({ subject, bodyPlaintext, bodyHtml }),
    [bodyHtml, bodyPlaintext, subject],
  );
  const bodyDesignJsonFingerprint = useMemo(
    () => JSON.stringify(bodyDesignJson),
    [bodyDesignJson],
  );
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
  const aliasProjects = useMemo(
    () => readAliasProjectsForSender(bootstrap, selectedSenderOption),
    [bootstrap, selectedSenderOption],
  );
  const allProjectOptions = useMemo(
    () => flattenProjectGroups(bootstrap.projects),
    [bootstrap.projects],
  );
  const selectedSenderType =
    launchType === "sms"
      ? "project"
      : (selectedSenderOption?.senderType ?? null);
  const effectiveProjectOptions =
    launchType === "sms" ? allProjectOptions : aliasProjects;
  const aliasProjectIds = useMemo(
    () =>
      normalizeProjectIds(effectiveProjectOptions.map((project) => project.id)),
    [effectiveProjectOptions],
  );
  const availableAudienceModes = useMemo(
    () => readAllowedAudienceModesForSenderType(selectedSenderType),
    [selectedSenderType],
  );
  const kind =
    launchType === "sms"
      ? "project"
      : kindForSenderType(selectedSenderType, draft.kind);
  const fingerprint = useMemo(
    () =>
      buildDraftFingerprint({
        launchType,
        kind,
        name: name.trim() || null,
        fromEmail,
        replyToEmail,
        subject,
        preheader,
        bodyPlaintext,
        bodyHtml,
        bodyDesignJsonFingerprint,
        criteria,
        audienceSize: countState.hasAppliedFilters ? countState.count : null,
      }),
    [
      bodyHtml,
      bodyDesignJsonFingerprint,
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
  const selectedSenderVerified = frozen
    ? true
    : launchType === "sms"
      ? bootstrap.activeSmsSender !== null
      : selectedSenderOption?.status === "verified";
  const suggestedSenderEmail = useMemo(
    () => deriveSuggestedSenderEmail({ kind, criteria, bootstrap }),
    [bootstrap, criteria, kind],
  );
  const selectedProjectIds = readProjectIds(criteria);
  const selectedProjectIdsKey = selectedProjectIds.join(",");
  const warningDismissed =
    warningDismissFingerprint !== null &&
    warningDismissFingerprint === previewFingerprint;

  useEffect(() => {
    const initialSenderType =
      bootstrap.senderOptions.find((option) => option.email === draft.fromEmail)
        ?.senderType ?? null;
    const initialCriteria = {
      ...draft.audienceCriteria,
      projectId:
        draft.audienceCriteria.projectId ??
        draft.audienceCriteria.projectIds[0] ??
        null,
      contactIds: draft.audienceCriteria.contactIds ?? [],
      newsletterSubscriberIds:
        draft.audienceCriteria.newsletterSubscriberIds ?? [],
      initialFilter: initialAudienceMode,
    };
    savedFingerprintRef.current = buildDraftFingerprint({
      launchType: draft.launchType,
      kind:
        draft.launchType === "sms"
          ? "project"
          : kindForSenderType(initialSenderType, draft.kind),
      name: draft.name,
      fromEmail: draft.fromEmail,
      replyToEmail: draft.replyToEmail,
      subject: draft.subjectTemplate ?? "",
      preheader: draft.preheader ?? "",
      bodyPlaintext: draft.bodyTextTemplate ?? "",
      bodyHtml: draft.bodyHtmlTemplate ?? "",
      bodyDesignJsonFingerprint: JSON.stringify(draft.bodyDesignJson ?? null),
      criteria: initialCriteria,
      audienceSize: draft.audienceSize,
    });
  }, [bootstrap.senderOptions, draft, initialAudienceMode]);

  useEffect(() => {
    if (
      launchType !== "sms" &&
      fromEmail === null &&
      suggestedSenderEmail !== null
    ) {
      setFromEmail(suggestedSenderEmail);
      setReplyToEmail(suggestedSenderEmail);
    }
  }, [fromEmail, launchType, suggestedSenderEmail]);

  useEffect(() => {
    const currentMode = criteria.initialFilter;
    if (
      !hasPickedAudienceMode ||
      currentMode === undefined ||
      selectedSenderType !== "project" ||
      effectiveProjectOptions.length === 0
    ) {
      return;
    }

    const currentProjectIds = readProjectIds(criteria);
    if (currentProjectIds.length > 0) {
      return;
    }

    setCriteria((current) =>
      buildCriteriaForMode({
        current,
        mode: currentMode,
        aliasProjects: effectiveProjectOptions,
      }),
    );
  }, [
    criteria,
    criteria.initialFilter,
    effectiveProjectOptions,
    hasPickedAudienceMode,
    selectedSenderType,
  ]);

  useEffect(() => {
    if (previousLaunchTypeRef.current === launchType) {
      return;
    }

    previousLaunchTypeRef.current = launchType;
    if (launchType === "sms") {
      // SMS starts from a blank body — the email default template (Unlayer
      // design / newsletter boilerplate) must not carry into the SMS body.
      setBodyPlaintext("");
      setBodyHtml("");
      setBodyDesignJson(null);
      setCriteria((current) => {
        if (current.initialFilter === "specific") {
          return {
            ...current,
            newsletterSubscriberIds: [],
          };
        }

        if (current.initialFilter === "project_status") {
          return current;
        }

        return clearAudienceCriteria(current);
      });
      if (
        criteria.initialFilter !== "specific" &&
        criteria.initialFilter !== "project_status"
      ) {
        setHasPickedAudienceMode(false);
      }
    }
    setVolunteerSearchQuery("");
    setVolunteerSearchRows([]);
    setVolunteerSearchErrorMessage(null);
  }, [criteria.initialFilter, launchType]);

  useEffect(() => {
    if (previousFromEmailRef.current === fromEmail) {
      return;
    }

    previousFromEmailRef.current = fromEmail;
    setCriteria((current) => {
      if (!hasPickedAudienceMode || current.initialFilter === undefined) {
        return clearAudienceCriteria(current);
      }

      const nextMode = availableAudienceModes.includes(current.initialFilter)
        ? current.initialFilter
        : defaultAudienceModeForSenderType(selectedSenderType);

      return buildCriteriaForMode({
        current,
        mode: nextMode,
        aliasProjects: effectiveProjectOptions,
      });
    });
    setVolunteerSearchQuery("");
    setVolunteerSearchRows([]);
    setVolunteerSearchErrorMessage(null);
  }, [
    availableAudienceModes,
    effectiveProjectOptions,
    fromEmail,
    hasPickedAudienceMode,
    selectedSenderType,
  ]);

  useEffect(() => {
    setReplyToEmail(fromEmail);
  }, [fromEmail]);

  useEffect(() => {
    const requestId = ++signatureRequestRef.current;

    void (async () => {
      const result = await loadSelectedAliasSignatureAction({
        aliasEmail: fromEmail,
      });
      if (requestId !== signatureRequestRef.current) {
        return;
      }

      setSelectedAliasSignature(result.ok ? result.data : "");
    })();
  }, [fromEmail]);

  useEffect(() => {
    if (!hasPickedAudienceMode || criteria.initialFilter !== "project_status") {
      setStatusCounts({});
      setStatusCountsLoading(false);
      setStatusCountsErrorMessage(null);
      return;
    }

    if (selectedProjectIds.length === 0) {
      setStatusCounts({});
      setStatusCountsLoading(false);
      setStatusCountsErrorMessage(null);
      return;
    }

    const requestId = ++statusCountsRequestRef.current;
    setStatusCountsLoading(true);
    setStatusCountsErrorMessage(null);
    startStatusCountsTransition(async () => {
      const result =
        await loadMemberStatusCountsForProjects(selectedProjectIds);
      if (requestId !== statusCountsRequestRef.current) {
        return;
      }

      if (!result.ok) {
        setStatusCounts({});
        setStatusCountsLoading(false);
        setStatusCountsErrorMessage(result.message);
        return;
      }

      setStatusCounts(result.data);
      setStatusCountsLoading(false);
      setStatusCountsErrorMessage(null);
      setCriteria((current) => {
        const availableStatuses = bootstrap.statuses.filter(
          (status) => (result.data[status] ?? 0) > 0,
        );
        const selectedStatuses = current.statuses.filter(
          (status: ExpeditionMemberStatus) =>
            availableStatuses.includes(status),
        );

        return selectedStatuses.length === current.statuses.length
          ? current
          : {
              ...current,
              statuses: selectedStatuses,
            };
      });
    });
  }, [
    bootstrap.statuses,
    criteria.initialFilter,
    hasPickedAudienceMode,
    selectedProjectIdsKey,
  ]);

  useEffect(() => {
    if (frozen) {
      setCountLoading(false);
      return;
    }

    if (!hasPickedAudienceMode || criteria.initialFilter === undefined) {
      countRequestRef.current += 1;
      setCountLoading(false);
      setCountState({ count: 0, hasAppliedFilters: false });
      return;
    }

    const audienceMode = criteria.initialFilter;
    if (audienceMode === "project_status" && criteria.statuses.length === 0) {
      countRequestRef.current += 1;
      setCountLoading(false);
      setCountState({ count: 0, hasAppliedFilters: true });
      return;
    }

    const requestId = ++countRequestRef.current;
    setCountLoading(true);
    startCountTransition(async () => {
      const result = await resolveAudienceCountAction({
        kind,
        criteria: toActionCriteria(criteria),
      });
      if (requestId !== countRequestRef.current) {
        return;
      }

      setCountLoading(false);
      if (!result.ok) {
        setSaveMessage(result.message);
        return;
      }

      setCountState(result.data);
    });
  }, [criteria, frozen, hasPickedAudienceMode, kind]);

  useEffect(() => {
    if (currentStep !== 2 || !hasPickedAudienceMode) {
      setAudiencePreviewLoading(false);
      setPreviewRows([]);
      setPreviewErrorMessage(null);
      return;
    }

    const requestId = ++audiencePreviewRequestRef.current;
    setAudiencePreviewLoading(true);
    setPreviewErrorMessage(null);
    void (async () => {
      const result = await previewAudienceAction({
        kind,
        criteria: toActionCriteria(criteria),
      });
      if (requestId !== audiencePreviewRequestRef.current) {
        return;
      }

      setAudiencePreviewLoading(false);
      if (!result.ok) {
        setPreviewErrorMessage(result.message);
        return;
      }

      setPreviewRows(result.data);
      setPreviewErrorMessage(null);
    })();
  }, [criteria, currentStep, hasPickedAudienceMode, kind]);

  useEffect(() => {
    if (
      currentStep !== 2 ||
      !hasPickedAudienceMode ||
      criteria.initialFilter !== "specific"
    ) {
      setVolunteerSearchRows([]);
      setVolunteerSearchErrorMessage(null);
      return;
    }

    if (volunteerSearchQuery.trim().length < 2) {
      setVolunteerSearchRows([]);
      setVolunteerSearchErrorMessage(null);
      return;
    }

    const requestId = ++volunteerSearchRequestRef.current;
    const timer = setTimeout(() => {
      startVolunteerSearchTransition(async () => {
        const result =
          selectedSenderType === "org"
            ? await searchNewsletterSubscribersAction({
                query: volunteerSearchQuery,
              })
            : await searchProjectVolunteersAction({
                aliasProjectIds,
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
    aliasProjectIds,
    criteria.initialFilter,
    currentStep,
    hasPickedAudienceMode,
    selectedSenderType,
    volunteerSearchQuery,
  ]);

  useEffect(() => {
    if (launchType === "sms") {
      if (currentStep < 4) {
        setSmsPreview(null);
        return;
      }

      const requestId = ++composePreviewRequestRef.current;
      const timer = setTimeout(() => {
        startSmsPreviewTransition(async () => {
          const result = await previewSmsBroadcast({
            runId: draft.runId,
          });
          if (requestId !== composePreviewRequestRef.current) {
            return;
          }

          if (!result.ok) {
            setSmsPreview(null);
            setToast({
              tone: "error",
              message: result.message,
            });
            return;
          }

          setSmsPreview(result.data);
        });
      }, 150);

      return () => {
        clearTimeout(timer);
      };
    }

    if (currentStep < 3) {
      return;
    }

    const requestId = ++composePreviewRequestRef.current;
    const timer = setTimeout(() => {
      startComposePreviewTransition(async () => {
        const result = await loadComposePreviewAction({
          launchType,
          kind,
          criteria: toActionCriteria(criteria),
          fromEmail,
          subjectTemplate: subject,
          preheader,
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
    launchType,
    kind,
    preheader,
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
      void autosavePersistDraftRef.current?.("Autosaved");
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

  return {
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
    saveTimeoutRef,
    autosavePersistDraftRef,
    frozen,
    kind,
    availableAudienceModes,
    dirty,
    selectedSenderVerified,
    selectedSenderType,
    aliasProjects,
    previewFingerprint,
    warningDismissed,
    statusLabel,
  };
}
