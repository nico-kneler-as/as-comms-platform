"use server";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";

import {
  audienceCriteriaSchema,
  campaignWizardDraftSaveInputSchema,
  expeditionMemberStatusValues,
  normalizeExpeditionMemberStatus,
  type CampaignWizardDraftSaveInput,
  type BroadcastUploadedRecipientInput,
  type AudienceCriteria,
  type CampaignKind,
  type CampaignRunRecord,
  type ExpeditionMemberStatus,
  type LaunchType,
  type PostmarkSenderStatus,
} from "@as-comms/contracts";
import {
  buildBroadcastUnsubscribeUrls,
  createAudienceResolver,
  createMergeRenderer,
  formatOrgAddress,
  intersectSmsAudience,
  normalizeAliasEmail,
  normalizeEmailAddress,
  readFirstName,
  resolveContactsByEmail,
  resolveUploadedAudienceForRun,
  renderBroadcastEmail,
  type AudienceMember,
  type SmsBroadcastAudienceMember,
  type SmsBroadcastDropReason,
} from "@as-comms/domain";

import type { UiError, UiResult, UiSuccess } from "@/src/server/ui-result";

import { requireAdmin, requireSession } from "@/src/server/auth/session";
import {
  countBroadcastUploadedRecipients,
  getStage1WebRuntime,
  listBroadcastUploadedRecipients,
  listSendableNewsletterSubscribers,
  listEnabledOrgSenders,
  replaceBroadcastUploadedRecipients,
  searchNewsletterSubscribers,
} from "@/src/server/stage1-runtime";
import { parseRecipientCsv } from "@/src/lib/parse-recipient-csv";

import { deriveInitials } from "./campaign-preview";

const EMPTY_AUDIENCE_CRITERIA = audienceCriteriaSchema.parse({});
const RECENT_EXPEDITION_WINDOW_DAYS = 365;
const PREVIEW_LIMIT = 50;
const CAMPAIGN_DRAFT_STALE_MESSAGE =
  "This broadcast draft was changed in another tab. Reload to continue.";
const campaignWizardDraftBaselineSchema =
  campaignWizardDraftSaveInputSchema.pick({
    runId: true,
    observedUpdatedAt: true,
  });

export interface CampaignProjectOption {
  readonly id: string;
  readonly name: string;
  readonly alias: string | null;
  readonly projectAlias: string | null;
  readonly aliasHint: string | null;
  readonly connectedToProjectId: string | null;
  readonly isSubProject: boolean;
}

export interface CampaignProjectGroup {
  readonly host: CampaignProjectOption;
  readonly connectedSubs: readonly CampaignProjectOption[];
}

export interface CampaignExpeditionOption {
  readonly id: string;
  readonly name: string;
}

export interface AudienceBuilderBootstrap {
  readonly projects: readonly CampaignProjectGroup[];
  readonly expeditions: readonly CampaignExpeditionOption[];
  readonly statuses: readonly ExpeditionMemberStatus[];
  readonly senderOptions: readonly CampaignSenderOption[];
  readonly activeSmsSender: ActiveSmsSender | null;
}

export interface AudiencePreviewRow {
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  readonly project: string | null;
  readonly projectAlias: string | null;
  readonly projectAliasHint: string | null;
}

export interface AudienceCountData {
  readonly count: number;
  readonly hasAppliedFilters: boolean;
}

export interface CsvUploadSummary {
  readonly importedCount: number;
  readonly invalidSkippedCount: number;
  readonly duplicatesRemovedCount: number;
  readonly sample: readonly AudiencePreviewRow[];
}

type SmsCsvPreFreezeDropReason = "no_contact_match" | "ambiguous_match";

export interface SmsCsvDroppedAudienceRow {
  readonly email: string;
  readonly reason: SmsBroadcastDropReason;
}

export interface SmsCsvAudienceSummary {
  readonly importedCount: number;
  readonly matchedCount: number;
  readonly reachableCount: number;
  readonly droppedCount: number;
  readonly deduplicatedByPhone: number;
  readonly droppedByReason: Readonly<Record<SmsBroadcastDropReason, number>>;
  readonly droppedRows: readonly SmsCsvDroppedAudienceRow[];
}

export interface ResolvedSmsCsvAudience {
  readonly members: readonly SmsBroadcastAudienceMember[];
  readonly previewRows: readonly AudiencePreviewRow[];
  readonly summary: SmsCsvAudienceSummary;
  readonly preFreezeDroppedByReason: Readonly<
    Record<SmsCsvPreFreezeDropReason, number>
  >;
}

export type AudienceStatusCounts = Partial<
  Record<ExpeditionMemberStatus, number>
>;

type MemberStatusCountChannel = "email" | "sms";

export type CampaignSenderType = "project" | "org";

export interface CampaignSenderOption {
  readonly projectId: string | null;
  readonly projectName: string;
  readonly projectAliasLabel: string;
  readonly email: string;
  readonly connectedToProjectId: string | null;
  readonly status: PostmarkSenderStatus;
  readonly senderType: CampaignSenderType;
}

export interface ActiveSmsSender {
  readonly id: string;
  readonly displayName: string;
  readonly phoneE164: string;
}

export interface AudienceVolunteerSearchRow {
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  readonly project: string | null;
  readonly projectAlias: string | null;
  readonly projectAliasHint: string | null;
}

export interface AudienceNewsletterSubscriberSearchRow {
  readonly subscriberId: string;
  readonly email: string;
  readonly firstName: string | null;
}

export interface CampaignWizardDraftData {
  readonly runId: string;
  readonly launchType: LaunchType;
  readonly kind: CampaignKind;
  readonly name: string | null;
  readonly fromEmail: string | null;
  readonly replyToEmail: string | null;
  readonly subjectTemplate: string | null;
  readonly subjectTemplateB?: string | null;
  readonly abTestEnabled?: boolean;
  readonly bodyDesignJson: unknown;
  readonly bodyHtmlTemplate: string | null;
  readonly bodyTextTemplate: string | null;
  readonly preheader: string | null;
  readonly audienceCriteria: AudienceCriteria;
  readonly audienceSize: number | null;
  readonly state: CampaignRunRecord["state"];
  readonly scheduledAt: string | null;
  readonly updatedAt: string;
  readonly operatorEmail: string;
}

export interface ComposePreviewWarningContact {
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  readonly project: string | null;
  readonly missingTokens: readonly string[];
}

export interface ComposePreviewSample {
  readonly contactId: string;
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly project: string | null;
  readonly fromEmail: string | null;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface ComposePreviewData {
  readonly audienceSize: number;
  readonly sampleIndex: number;
  readonly sampleCount: number;
  readonly sample: ComposePreviewSample | null;
  readonly warningCount: number;
  readonly affectedContacts: readonly ComposePreviewWarningContact[];
  readonly footerAddress: string | null;
}

export async function loadSelectedAliasSignatureAction(input: {
  readonly aliasEmail: string | null;
}): Promise<UiResult<string>> {
  await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const normalizedAliasEmail = normalizeAliasEmail(input.aliasEmail);
    const signature =
      normalizedAliasEmail === null
        ? ""
        : ((await runtime.settings.aliases.findByAlias(normalizedAliasEmail))
            ?.signature ?? "");
    return successResult(signature);
  } catch (error) {
    return errorResult(
      "campaign_alias_signature_load_failed",
      error instanceof Error
        ? error.message
        : "Unable to load the sender signature.",
      true,
    );
  }
}

function newRequestId(): string {
  return randomUUID();
}

function errorResult(
  code: string,
  message: string,
  retryable = false,
): UiError {
  return {
    ok: false,
    code,
    message,
    requestId: newRequestId(),
    ...(retryable ? { retryable: true } : {}),
  };
}

function successResult<T>(data: T): UiSuccess<T> {
  return {
    ok: true,
    data,
    requestId: newRequestId(),
  };
}

function mergeMissingTokensByContact(
  ...entries: readonly Record<string, readonly string[]>[]
): Record<string, readonly string[]> {
  const merged = new Map<string, Set<string>>();

  for (const entry of entries) {
    for (const [contactId, tokens] of Object.entries(entry)) {
      const existing = merged.get(contactId) ?? new Set<string>();
      for (const token of tokens) {
        existing.add(token);
      }
      merged.set(contactId, existing);
    }
  }

  return Object.fromEntries(
    [...merged.entries()].map(([contactId, tokens]) => [
      contactId,
      [...tokens],
    ]),
  );
}

async function appendCampaignAudit(input: {
  readonly actorId: string;
  readonly action: string;
  readonly runId: string;
  readonly summary: string;
}) {
  const runtime = await getStage1WebRuntime();
  await runtime.repositories.auditEvidence.append({
    id: randomUUID(),
    actorType: "user",
    actorId: input.actorId,
    action: input.action,
    entityType: "campaign_run",
    entityId: input.runId,
    occurredAt: new Date().toISOString(),
    result: "recorded",
    policyCode: `stage5a.${input.action}`,
    metadataJson: {
      summary: input.summary,
    },
  });
}

async function resolvePrimaryAliasEmail(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
  projectId: string | null,
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  if (projectId === null) {
    return null;
  }

  const cached = cache.get(projectId);
  if (cached !== undefined) {
    return cached;
  }

  const task = (async () => {
    const project = await runtime.settings.projects.findById(projectId);
    if (project === null) {
      return null;
    }

    const primary =
      project.emails.find((email) => email.isPrimary) ?? project.emails[0];
    if (primary !== undefined) {
      const trimmed = primary.address.trim();
      return trimmed.length === 0 ? null : trimmed.toLowerCase();
    }

    if (project.connectedToProjectId !== null) {
      return resolvePrimaryAliasEmail(
        runtime,
        project.connectedToProjectId,
        cache,
      );
    }

    return null;
  })();

  cache.set(projectId, task);
  return task;
}

function formatPreviewName(input: {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly fallback: string;
}): string {
  const name = [input.firstName, input.lastName]
    .filter((value): value is string => (value?.trim().length ?? 0) > 0)
    .join(" ")
    .trim();

  return name.length > 0 ? name : input.fallback;
}

function mapUploadedRecipientPreviewRow(input: {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
}): AudiencePreviewRow {
  return {
    contactId: input.id,
    name: formatPreviewName({
      firstName: input.firstName,
      lastName: input.lastName,
      fallback: input.email,
    }),
    email: input.email,
    project: null,
    projectAlias: null,
    projectAliasHint: null,
  };
}

function buildEmptySmsBroadcastDropCounts(): Record<SmsBroadcastDropReason, number> {
  return {
    no_contact_match: 0,
    ambiguous_match: 0,
    no_consent: 0,
    revoked: 0,
    no_phone: 0,
  };
}

function dedupeSmsAudienceMembersByContactId(
  members: readonly SmsBroadcastAudienceMember[],
): readonly SmsBroadcastAudienceMember[] {
  const seenContactIds = new Set<string>();
  const deduplicatedMembers: SmsBroadcastAudienceMember[] = [];

  for (const member of members) {
    if (seenContactIds.has(member.contactId)) {
      continue;
    }

    seenContactIds.add(member.contactId);
    deduplicatedMembers.push(member);
  }

  return deduplicatedMembers;
}

function countSmsBroadcastDrops(
  droppedByReason: Readonly<Record<SmsBroadcastDropReason, number>>,
): number {
  return Object.values(droppedByReason).reduce((sum, count) => sum + count, 0);
}

function formatContactPreviewName(input: {
  readonly displayName: string;
  readonly email: string | null;
  readonly fallback: string;
}): string {
  const displayName = input.displayName.trim();
  if (displayName.length > 0) {
    return displayName;
  }

  return input.email?.trim().length ? input.email.trim() : input.fallback;
}

function hasAppliedAudienceFilters(
  criteria: AudienceCriteria,
): boolean {
  switch (readAudienceMode(criteria)) {
    case "all_approved":
    case "all_available":
    case "csv_upload":
    case "project_status":
    case "specific":
      return true;
  }
}

function readAudienceMode(
  criteria: AudienceCriteria,
) :
  | "project_status"
  | "specific"
  | "all_approved"
  | "all_available"
  | "csv_upload" {
  return criteria.initialFilter ?? "project_status";
}

function readAudienceRecipientKey(member: AudienceMember): string {
  return (
    member.contactId ?? member.newsletterSubscriberId ?? member.frozenEmail
  );
}

function normalizeAliasHint(address: string | null | undefined): string | null {
  const trimmed = address?.trim().toLowerCase() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const [local] = trimmed.split("@");
  return local && local.length > 0 ? `${local}@` : null;
}

function deriveProjectId(
  kind: CampaignKind,
  criteria: AudienceCriteria,
): string | null {
  if (kind !== "project") {
    return null;
  }

  return criteria.projectId ?? criteria.projectIds[0] ?? null;
}

async function deriveRunProjectId(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
  input: {
    readonly kind: CampaignKind;
    readonly criteria: AudienceCriteria;
    readonly fromEmail: string | null;
  },
): Promise<string | null> {
  const criteriaProjectId = deriveProjectId(input.kind, input.criteria);
  if (criteriaProjectId !== null || input.kind !== "project") {
    return criteriaProjectId;
  }

  if (readAudienceMode(input.criteria) !== "csv_upload") {
    return null;
  }

  const aliasEmail = normalizeAliasEmail(input.fromEmail);
  if (aliasEmail === null) {
    return null;
  }

  return (await runtime.settings.aliases.findByAlias(aliasEmail))?.projectId ?? null;
}

function toStoredAudienceCriteria(
  criteria: AudienceCriteria,
): Record<string, unknown> {
  return {
    projectId: criteria.projectId ?? criteria.projectIds[0] ?? null,
    projectIds: criteria.projectIds,
    statuses: criteria.statuses,
    contactIds: criteria.contactIds ?? [],
    newsletterSubscriberIds: criteria.newsletterSubscriberIds ?? [],
    ...(criteria.initialFilter === undefined
      ? {}
      : { initialFilter: criteria.initialFilter }),
  };
}

function filterAudienceMembersBySelection<
  T extends { readonly contactId: string | null },
>(
  rows: readonly T[],
  criteria: AudienceCriteria,
): readonly T[] {
  // Defense-in-depth: whenever specific individuals are selected, restrict to
  // them regardless of the (client-supplied, sometimes-missing) mode marker.
  // contactIds is only populated by the "specific" picker, so this fails safe —
  // it can never widen the audience beyond the explicit selection.
  if ((criteria.contactIds?.length ?? 0) > 0) {
    const selectedContactIds = new Set(criteria.contactIds ?? []);
    return rows.filter(
      (row) => row.contactId !== null && selectedContactIds.has(row.contactId),
    );
  }

  // "specific" mode with no selection resolves to nobody (not everybody).
  if (readAudienceMode(criteria) === "specific") {
    return [];
  }

  return rows;
}

function readPrimaryEmail(input: {
  readonly emails: readonly {
    readonly address: string;
    readonly isPrimary: boolean;
  }[];
}): string | null {
  return (
    input.emails.find((email) => email.isPrimary)?.address ??
    input.emails[0]?.address ??
    null
  );
}

function mapDraftRecord(
  record: CampaignRunRecord,
  operatorEmail: string,
): CampaignWizardDraftData {
  return {
    runId: record.id,
    launchType: record.launchType,
    kind: record.kind,
    name: record.name,
    fromEmail: record.fromEmail,
    replyToEmail: record.replyToEmail,
    subjectTemplate: record.subjectTemplate,
    subjectTemplateB: record.subjectTemplateB,
    abTestEnabled: record.abTestEnabled,
    bodyDesignJson: record.bodyDesignJson ?? null,
    bodyHtmlTemplate: record.bodyHtmlTemplate,
    bodyTextTemplate: record.bodyTextTemplate,
    preheader: record.preheader,
    audienceCriteria: audienceCriteriaSchema.parse(record.audienceCriteria),
    audienceSize: record.audienceSize,
    state: record.state,
    scheduledAt: record.scheduledAt,
    updatedAt: record.updatedAt,
    operatorEmail,
  };
}

async function createResolver() {
  const runtime = await getStage1WebRuntime();

  return createAudienceResolver({
    repositories: {
      contacts: runtime.repositories.contacts,
      contactMemberships: runtime.repositories.contactMemberships,
      canonicalEvents: runtime.repositories.canonicalEvents,
      projectDimensions: runtime.repositories.projectDimensions,
      settingsProjects: runtime.settings.projects,
    },
  });
}

async function loadUploadedAudience(
  input: {
    readonly runId: string;
    readonly fromEmail?: string | null;
    readonly projectId?: string | null;
  },
): Promise<readonly AudienceMember[]> {
  const runtime = await getStage1WebRuntime();

  return resolveUploadedAudienceForRun(
    {
      uploadedRecipients: {
        listForRun: (runId) => listBroadcastUploadedRecipients(runId),
      },
      contacts: runtime.repositories.contacts,
      settingsProjects: runtime.settings.projects,
      settingsAliases: runtime.settings.aliases,
    },
    input,
  );
}

async function loadUploadedAudiencePreview(
  runId: string,
): Promise<readonly AudiencePreviewRow[]> {
  return (await listBroadcastUploadedRecipients(runId))
    .slice(0, PREVIEW_LIMIT)
    .map((recipient) =>
      mapUploadedRecipientPreviewRow({
        id: recipient.id,
        email: recipient.email,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
      }),
    );
}

export async function resolveSmsCsvAudienceForRun(
  runId: string,
): Promise<ResolvedSmsCsvAudience> {
  const runtime = await getStage1WebRuntime();
  const uploadedRecipients = await listBroadcastUploadedRecipients(runId);
  if (uploadedRecipients.length === 0) {
    const droppedByReason = buildEmptySmsBroadcastDropCounts();

    return {
      members: [],
      previewRows: [],
      summary: {
        importedCount: 0,
        matchedCount: 0,
        reachableCount: 0,
        droppedCount: 0,
        deduplicatedByPhone: 0,
        droppedByReason,
        droppedRows: [],
      },
      preFreezeDroppedByReason: {
        no_contact_match: 0,
        ambiguous_match: 0,
      },
    };
  }

  const resolutions = await resolveContactsByEmail({
    normalizedEmails: uploadedRecipients.map((recipient) => recipient.email),
    repositories: {
      contacts: runtime.repositories.contacts,
      contactIdentities: runtime.repositories.contactIdentities,
    },
  });
  const resolutionByEmail = new Map(
    resolutions.map((resolution) => [resolution.normalizedEmail, resolution] as const),
  );
  const matchedContactIds = resolutions.flatMap((resolution) =>
    resolution.status === "matched" && resolution.contactId !== null
      ? [resolution.contactId]
      : [],
  );
  const contactsById = new Map(
    (
      await runtime.repositories.contacts.listByIds(
        [...new Set(matchedContactIds)],
      )
    ).map((contact) => [contact.id, contact] as const),
  );
  const preFreezeDroppedByReason: Record<SmsCsvPreFreezeDropReason, number> = {
    no_contact_match: 0,
    ambiguous_match: 0,
  };
  const preFreezeDroppedRowsByEmail = new Map<
    string,
    SmsCsvPreFreezeDropReason
  >();
  const droppedRows: SmsCsvDroppedAudienceRow[] = [];
  const matchedMembers: SmsBroadcastAudienceMember[] = [];
  const matchedContactIdByEmail = new Map<string, string>();
  const matchedPreviewRows: AudiencePreviewRow[] = [];

  for (const recipient of uploadedRecipients) {
    // Stored uploaded emails are lowercased by the CSV parser, but the storage
    // contract only trims. Normalize on lookup so a mixed-case stored row can
    // never be misreported as an unmatched drop.
    const resolution = resolutionByEmail.get(
      normalizeEmailAddress(recipient.email) ?? recipient.email,
    );
    if (resolution?.status !== "matched" || resolution.contactId === null) {
      const reason: SmsCsvPreFreezeDropReason =
        resolution?.status === "ambiguous_match"
          ? "ambiguous_match"
          : "no_contact_match";
      preFreezeDroppedByReason[reason] += 1;
      preFreezeDroppedRowsByEmail.set(recipient.email, reason);
      continue;
    }

    const contact = contactsById.get(resolution.contactId);
    if (contact === undefined) {
      preFreezeDroppedByReason.no_contact_match += 1;
      preFreezeDroppedRowsByEmail.set(recipient.email, "no_contact_match");
      continue;
    }

    const email = normalizeEmailAddress(contact.primaryEmail ?? "");
    matchedMembers.push({
      contactId: contact.id,
      firstName: readFirstName(contact.displayName),
      email,
      projectName: null,
    });
    matchedContactIdByEmail.set(recipient.email, contact.id);
    matchedPreviewRows.push({
      contactId: contact.id,
      name: formatContactPreviewName({
        displayName: contact.displayName,
        email,
        fallback: contact.id,
      }),
      email: email ?? "",
      project: null,
      projectAlias: null,
      projectAliasHint: null,
    });
  }

  const members = dedupeSmsAudienceMembersByContactId(matchedMembers);
  const previewRows = matchedPreviewRows.filter(
    (row, index, rows) =>
      rows.findIndex((candidate) => candidate.contactId === row.contactId) ===
      index,
  );
  const latestConsentByContactId =
    await runtime.repositories.consentRecords.findLatestByContactIds(
      members.map((member) => member.contactId),
    );
  const reachabilityByContactId = new Map<string, SmsBroadcastDropReason | null>();
  const consentStatusByContactId = new Map(
    members.map((member) => [
      member.contactId,
      latestConsentByContactId.get(member.contactId)?.status ?? null,
    ]),
  );
  const intersection = intersectSmsAudience({
    candidates: members.map((member) => {
      const latestConsent = latestConsentByContactId.get(member.contactId);
      const unreachableReason =
        latestConsent === undefined
          ? "no_consent"
          : latestConsent.status !== "opted_in"
            ? "revoked"
            : latestConsent.phoneE164.trim().length === 0
              ? "no_phone"
              : null;

      reachabilityByContactId.set(member.contactId, unreachableReason);

      return {
        contactId: member.contactId,
        phoneE164:
          latestConsent?.status === "opted_in" ? latestConsent.phoneE164 : null,
        firstName: member.firstName,
        email: member.email,
        projectName: member.projectName,
      };
    }),
    latestConsentByContactId: consentStatusByContactId,
  });
  for (const recipient of uploadedRecipients) {
    const preFreezeReason = preFreezeDroppedRowsByEmail.get(recipient.email);
    if (preFreezeReason !== undefined) {
      droppedRows.push({
        email: recipient.email,
        reason: preFreezeReason,
      });
      continue;
    }

    const contactId = matchedContactIdByEmail.get(recipient.email);
    if (contactId === undefined) {
      continue;
    }

    const unreachableReason = reachabilityByContactId.get(contactId);
    if (unreachableReason !== null && unreachableReason !== undefined) {
      droppedRows.push({
        email: recipient.email,
        reason: unreachableReason,
      });
    }
  }
  const deduplicatedByPhone =
    intersection.reachable.length -
    new Set(intersection.reachable.map((recipient) => recipient.phoneE164)).size;
  const droppedByReason = buildEmptySmsBroadcastDropCounts();

  droppedByReason.no_contact_match = preFreezeDroppedByReason.no_contact_match;
  droppedByReason.ambiguous_match = preFreezeDroppedByReason.ambiguous_match;
  droppedByReason.no_consent = intersection.unreachable.no_consent;
  droppedByReason.revoked = intersection.unreachable.revoked;
  droppedByReason.no_phone = intersection.unreachable.no_phone;

  return {
    members,
    previewRows: previewRows.slice(0, PREVIEW_LIMIT),
    summary: {
      importedCount: uploadedRecipients.length,
      matchedCount: members.length,
      reachableCount: intersection.reachableCount,
      droppedCount: countSmsBroadcastDrops(droppedByReason),
      deduplicatedByPhone,
      droppedByReason,
      droppedRows,
    },
    preFreezeDroppedByReason,
  };
}

function buildAllProjectsCriteria(
  projectIds: readonly string[],
): AudienceCriteria {
  return audienceCriteriaSchema.parse({
    projectIds,
    statuses: [],
    contactIds: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
  });
}

function buildWindowStart(
  window: AudienceCriteria["lastActivityWindow"],
  at: Date,
): Date | null {
  switch (window) {
    case "all_time":
      return null;
    case "last_year":
      return new Date(at.getTime() - 365 * 24 * 60 * 60 * 1000);
    case "last_90_days":
      return new Date(at.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "last_30_days":
      return new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

function passesActivityWindow(
  occurredAtValues: readonly string[],
  windowStart: Date | null,
): boolean {
  if (windowStart === null) {
    return true;
  }

  return occurredAtValues.some(
    (occurredAt) => occurredAt >= windowStart.toISOString(),
  );
}

function passesHasReplied(
  eventTypes: readonly string[],
  hasReplied: AudienceCriteria["hasReplied"],
): boolean {
  if (hasReplied === "either") {
    return true;
  }

  const replied = eventTypes.includes("communication.email.inbound");
  return hasReplied === "yes" ? replied : !replied;
}

function passesHasClicked(
  eventTypes: readonly string[],
  hasClicked: AudienceCriteria["hasClicked"],
): boolean {
  if (hasClicked === "either") {
    return true;
  }

  const clicked = eventTypes.includes("campaign.email.clicked");
  return hasClicked === "yes" ? clicked : !clicked;
}

function compareMembershipsByProject(
  leftProjectName: string | null,
  leftProjectId: string | null,
  leftId: string,
  rightProjectName: string | null,
  rightProjectId: string | null,
  rightId: string,
): number {
  const leftProjectSortKey = leftProjectName ?? leftProjectId ?? "\uffff";
  const rightProjectSortKey = rightProjectName ?? rightProjectId ?? "\uffff";
  if (leftProjectSortKey !== rightProjectSortKey) {
    return leftProjectSortKey.localeCompare(rightProjectSortKey);
  }

  return leftId.localeCompare(rightId);
}

async function loadApprovedContactsAudience(
  at: Date,
): Promise<readonly AudienceMember[]> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    const settingsProjects = (await runtime.settings.projects.listAll()).filter(
      (project) => project.isActive,
    );
    const criteria = buildAllProjectsCriteria(
      settingsProjects.map((project) => project.projectId),
    );
    const resolver = await createResolver();
    return resolver.resolveAudience(criteria, at);
  }

  const rows = await runtime.connection.sql<
    {
      contactId: string;
      displayName: string;
      email: string;
      projectId: string | null;
      projectName: string | null;
    }[]
  >`
    with ranked_memberships as (
      select
        cm.contact_id,
        cm.project_id,
        pd.project_name,
        row_number() over (
          partition by cm.contact_id
          order by pd.project_name asc, cm.project_id asc, cm.id asc
        ) as row_number
      from contact_memberships cm
      join project_dimensions pd
        on pd.project_id = cm.project_id
      where pd.is_active = true
    ),
    primary_memberships as (
      select contact_id, project_id, project_name
      from ranked_memberships
      where row_number = 1
    )
    select
      c.id as "contactId",
      c.display_name as "displayName",
      lower(trim(c.primary_email)) as "email",
      pm.project_id as "projectId",
      pm.project_name as "projectName"
    from contacts c
    join primary_memberships pm
      on pm.contact_id = c.id
    where c.primary_email is not null
      and btrim(c.primary_email) <> ''
      and not exists (
        select 1
        from suppression_list sl
        where sl.normalized_email = lower(trim(c.primary_email))
          and sl.first_event_at <= ${at.toISOString()}::timestamptz
      )
      and not exists (
        select 1
        from contact_consent cc
        where cc.contact_id = c.id
          and cc.opted_out_at <= ${at.toISOString()}::timestamptz
          and cc.scope_type in ('all', 'newsletter')
      )
    order by
      pm.project_name asc nulls last,
      c.display_name asc,
      c.id asc
  `;

  return rows.map((row) => ({
    contactId: row.contactId,
    newsletterSubscriberId: null,
    frozenEmail: row.email,
    frozenFirstName: readFirstName(row.displayName),
    frozenProjectName: row.projectName,
    frozenProjectId: row.projectId,
    frozenAliasEmail: null,
  }));
}

async function loadNewsletterSubscriberAudience(): Promise<
  readonly AudienceMember[]
> {
  const rows = await listSendableNewsletterSubscribers();

  return rows.map((row) => ({
    contactId: null,
    newsletterSubscriberId: row.id,
    frozenEmail: row.email,
    frozenFirstName: row.firstName ?? null,
    frozenProjectName: null,
    frozenProjectId: null,
    frozenAliasEmail: null,
  }));
}

async function loadSpecificNewsletterSubscribersAudience(
  criteria: AudienceCriteria,
  at: Date,
): Promise<readonly AudienceMember[]> {
  void at;
  const selectedSubscriberIds = new Set(
    (criteria.newsletterSubscriberIds ?? []).filter(
      (subscriberId) => subscriberId.trim().length > 0,
    ),
  );
  if (selectedSubscriberIds.size === 0) {
    return [];
  }

  const rows = await listSendableNewsletterSubscribers();
  return rows
    .filter((row) => selectedSubscriberIds.has(row.id))
    .map((row) => ({
      contactId: null,
      newsletterSubscriberId: row.id,
      frozenEmail: row.email,
      frozenFirstName: row.firstName ?? null,
      frozenProjectName: null,
      frozenProjectId: null,
      frozenAliasEmail: null,
    }));
}

async function loadSpecificContactsAudience(
  criteria: AudienceCriteria,
  at: Date,
): Promise<readonly AudienceMember[]> {
  const selectedContactIds = [...new Set(criteria.contactIds ?? [])].filter(
    (contactId) => contactId.trim().length > 0,
  );
  if (selectedContactIds.length === 0) {
    return [];
  }

  const runtime = await getStage1WebRuntime();
  const contacts = (await runtime.repositories.contacts.listAll())
    .filter((contact) => selectedContactIds.includes(contact.id))
    .sort((left, right) => {
      const leftKey =
        left.displayName.trim().length > 0
          ? left.displayName
          : (left.primaryEmail ?? left.id);
      const rightKey =
        right.displayName.trim().length > 0
          ? right.displayName
          : (right.primaryEmail ?? right.id);
      return leftKey.localeCompare(rightKey);
    });
  if (contacts.length === 0) {
    return [];
  }

  const contactIds = contacts.map((contact) => contact.id);
  const memberships =
    await runtime.repositories.contactMemberships.listByContactIds(contactIds);
  const membershipsByContact = new Map<string, (typeof memberships)[number][]>(
    contactIds.map((contactId) => [contactId, []]),
  );
  for (const membership of memberships) {
    const existing = membershipsByContact.get(membership.contactId) ?? [];
    existing.push(membership);
    membershipsByContact.set(membership.contactId, existing);
  }

  const projectIds = [
    ...new Set(
      memberships
        .map((membership) => membership.projectId)
        .filter((projectId): projectId is string => projectId !== null),
    ),
  ];
  const projects =
    await runtime.repositories.projectDimensions.listByIds(projectIds);
  const projectsById = new Map(
    projects.map((project) => [project.projectId, project] as const),
  );

  const events =
    await runtime.repositories.canonicalEvents.listByContactIds(contactIds);
  const eventTypesByContact = new Map<string, string[]>(
    contactIds.map((contactId) => [contactId, []]),
  );
  const occurredAtValuesByContact = new Map<string, string[]>(
    contactIds.map((contactId) => [contactId, []]),
  );
  for (const event of events) {
    eventTypesByContact.set(event.contactId, [
      ...(eventTypesByContact.get(event.contactId) ?? []),
      event.eventType,
    ]);
    occurredAtValuesByContact.set(event.contactId, [
      ...(occurredAtValuesByContact.get(event.contactId) ?? []),
      event.occurredAt,
    ]);
  }

  const aliasCache = new Map<string, Promise<string | null>>();
  const windowStart = buildWindowStart(criteria.lastActivityWindow, at);

  const audience: AudienceMember[] = [];
  for (const contact of contacts) {
    const frozenEmail = contact.primaryEmail?.trim().toLowerCase() ?? "";
    if (frozenEmail.length === 0) {
      continue;
    }

    const occurredAtValues = occurredAtValuesByContact.get(contact.id) ?? [];
    if (!passesActivityWindow(occurredAtValues, windowStart)) {
      continue;
    }

    const eventTypes = eventTypesByContact.get(contact.id) ?? [];
    if (!passesHasReplied(eventTypes, criteria.hasReplied)) {
      continue;
    }
    if (!passesHasClicked(eventTypes, criteria.hasClicked)) {
      continue;
    }

    const primaryMembership = [...(membershipsByContact.get(contact.id) ?? [])]
      .filter((membership) => membership.projectId !== null)
      .sort((left, right) =>
        compareMembershipsByProject(
          projectsById.get(left.projectId ?? "")?.projectName ?? null,
          left.projectId,
          left.id,
          projectsById.get(right.projectId ?? "")?.projectName ?? null,
          right.projectId,
          right.id,
        ),
      )
      .at(0);
    const project =
      primaryMembership?.projectId == null
        ? null
        : (projectsById.get(primaryMembership.projectId) ?? null);

    audience.push({
      contactId: contact.id,
      newsletterSubscriberId: null,
      frozenEmail,
      frozenFirstName: readFirstName(contact.displayName),
      frozenProjectName: project?.projectName ?? null,
      frozenProjectId: primaryMembership?.projectId ?? null,
      frozenAliasEmail: await resolvePrimaryAliasEmail(
        runtime,
        primaryMembership?.projectId ?? null,
        aliasCache,
      ),
    });
  }

  return audience;
}

export async function resolveStoredCampaignAudience(input: {
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria;
  readonly at: Date;
  readonly runId?: string;
  readonly fromEmail?: string | null;
  readonly projectId?: string | null;
}): Promise<readonly AudienceMember[]> {
  if (readAudienceMode(input.criteria) === "csv_upload") {
    if (input.runId === undefined) {
      throw new Error("CSV-upload audiences require a campaign run id.");
    }

    return loadUploadedAudience({
      runId: input.runId,
      ...(input.fromEmail === undefined ? {} : { fromEmail: input.fromEmail }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    });
  }

  if (input.kind === "newsletter") {
    if ((input.criteria.newsletterSubscriberIds?.length ?? 0) > 0) {
      return loadSpecificNewsletterSubscribersAudience(
        input.criteria,
        input.at,
      );
    }
    if ((input.criteria.contactIds?.length ?? 0) > 0) {
      return loadSpecificContactsAudience(input.criteria, input.at);
    }
    return loadNewsletterSubscriberAudience();
  }

  const resolver = await createResolver();
  return filterAudienceMembersBySelection(
    await resolver.resolveAudience(input.criteria, input.at),
    input.criteria,
  );
}

async function resolveWizardAudience(
  input: {
    readonly kind: CampaignKind;
    readonly criteria: AudienceCriteria;
    readonly at: Date;
    readonly runId?: string;
    readonly fromEmail?: string | null;
    readonly projectId?: string | null;
  },
): Promise<readonly AudienceMember[]> {
  const parsedCriteria = audienceCriteriaSchema.parse(input.criteria);
  const mode = readAudienceMode(input.criteria);

  if (mode === "all_approved" && input.kind === "newsletter") {
    return loadApprovedContactsAudience(input.at);
  }

  if (mode === "all_available" && input.kind === "newsletter") {
    return loadNewsletterSubscriberAudience();
  }

  if (mode === "specific" && input.kind === "newsletter") {
    if (parsedCriteria.newsletterSubscriberIds.length > 0) {
      return loadSpecificNewsletterSubscribersAudience(parsedCriteria, input.at);
    }
    if (parsedCriteria.contactIds.length > 0) {
      return loadSpecificContactsAudience(parsedCriteria, input.at);
    }
    return [];
  }

  return resolveStoredCampaignAudience({
    kind: input.kind,
    criteria: parsedCriteria,
    at: input.at,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.fromEmail === undefined ? {} : { fromEmail: input.fromEmail }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
  });
}

export async function createCampaignWizardDraft(): Promise<CampaignWizardDraftData> {
  const session = await requireAdmin();
  const runtime = await getStage1WebRuntime();
  const created = await runtime.campaigns.campaignRuns.create({
    id: randomUUID(),
    kind: "project",
    launchType: "normal_email",
    projectId: null,
    name: null,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: null,
    bodyTextTemplate: null,
    preheader: null,
    audienceCriteria: toStoredAudienceCriteria(
      EMPTY_AUDIENCE_CRITERIA,
    ) as CampaignRunRecord["audienceCriteria"],
    audienceSize: null,
    createdByUserId: session.id,
    lastEditedByUserId: session.id,
  });
  await appendCampaignAudit({
    actorId: session.id,
    action: "campaign_run.created",
    runId: created.id,
    summary: "Draft created from the broadcast wizard.",
  });

  return mapDraftRecord(created, session.email);
}

export async function getCampaignWizardDraft(
  runId: string,
): Promise<CampaignWizardDraftData | null> {
  const session = await requireSession();
  const runtime = await getStage1WebRuntime();
  const run = await runtime.campaigns.campaignRuns.findById(runId);
  if (run === null) {
    return null;
  }

  return mapDraftRecord(run, session.email);
}

export async function getAudienceBuilderBootstrap(): Promise<AudienceBuilderBootstrap> {
  await requireSession();
  const runtime = await getStage1WebRuntime();
  const allConnectedProjects = (
    await runtime.settings.projects.listAll()
  ).filter(
    (project) => project.isActive || project.connectedToProjectId !== null,
  );
  const activeProjects = allConnectedProjects.filter(
    (project) => project.isActive,
  );
  const projectsById = new Map(
    allConnectedProjects.map(
      (project) => [project.projectId, project] as const,
    ),
  );

  const projectOptions = allConnectedProjects
    .map((project) => {
      const primaryEmail = readPrimaryEmail(project);
      const hostProject =
        project.connectedToProjectId === null
          ? null
          : (projectsById.get(project.connectedToProjectId) ?? null);
      const hostPrimaryEmail =
        hostProject === null ? null : readPrimaryEmail(hostProject);

      return {
        id: project.projectId,
        name: project.projectName,
        alias: project.projectAlias,
        projectAlias: project.projectAlias,
        aliasHint: normalizeAliasHint(
          project.connectedToProjectId === null
            ? primaryEmail
            : hostPrimaryEmail,
        ),
        connectedToProjectId: project.connectedToProjectId,
        isSubProject: project.connectedToProjectId !== null,
      } satisfies CampaignProjectOption;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const topLevelProjects = projectOptions.filter(
    (project) => project.connectedToProjectId === null,
  );
  const groups = topLevelProjects.map((host) => ({
    host,
    connectedSubs: projectOptions.filter(
      (project) => project.connectedToProjectId === host.id,
    ),
  }));
  const projectSenderOptions: CampaignSenderOption[] = activeProjects
    .flatMap((project) => {
      const email = readPrimaryEmail(project);
      if (email === null) {
        return [];
      }

      return [
        {
          projectId: project.projectId,
          projectName: project.projectName,
          projectAliasLabel: project.projectAlias ?? project.projectName,
          email,
          connectedToProjectId: project.connectedToProjectId,
          status: project.postmarkSenderStatus,
          senderType: "project",
        } satisfies CampaignSenderOption,
      ];
    })
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
  const orgSenderOptions = (await listEnabledOrgSenders())
    .map(
      (sender) =>
        ({
          projectId: null,
          projectName: sender.label,
          projectAliasLabel: sender.label,
          email: sender.email,
          connectedToProjectId: null,
          status: "verified",
          senderType: "org",
        }) satisfies CampaignSenderOption,
    )
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
  const senderOptions = [...projectSenderOptions, ...orgSenderOptions];
  const activeSmsSender =
    (await runtime.settings.smsSenders.listActive()).map(
      (sender) =>
        ({
          id: sender.id,
          displayName: sender.displayName,
          phoneE164: sender.phoneE164,
        }) satisfies ActiveSmsSender,
    )[0] ?? null;

  if (runtime.connection === null) {
    return {
      projects: groups,
      expeditions: [],
      statuses: expeditionMemberStatusValues,
      senderOptions,
      activeSmsSender,
    };
  }

  const minimumTouchedAt = new Date(
    Date.now() - RECENT_EXPEDITION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const expeditionRows = await runtime.connection.sql<
    {
      expeditionId: string;
      expeditionName: string | null;
    }[]
  >`
    select
      cm.expedition_id as "expeditionId",
      ed.expedition_name as "expeditionName"
    from contact_memberships cm
    left join expedition_dimensions ed
      on ed.expedition_id = cm.expedition_id
    where cm.expedition_id is not null
      and cm.created_at >= ${minimumTouchedAt.toISOString()}::timestamptz
    group by cm.expedition_id, ed.expedition_name
    order by max(cm.created_at) desc, cm.expedition_id asc
    limit 50
  `;

  return {
    projects: groups,
    expeditions: expeditionRows.map((row) => ({
      id: row.expeditionId,
      name: row.expeditionName ?? row.expeditionId,
    })),
    statuses: expeditionMemberStatusValues,
    senderOptions,
    activeSmsSender,
  };
}

async function readRequestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin !== null && origin.trim().length > 0) {
    return origin;
  }

  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

export async function resolveAudienceCountAction(input: {
  readonly runId: string;
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria;
}): Promise<UiResult<AudienceCountData>> {
  await requireSession();

  try {
    const criteria = audienceCriteriaSchema.parse(input.criteria);
    const mode = readAudienceMode(criteria);
    const count =
      mode === "csv_upload"
        ? await (async () => {
            const runtime = await getStage1WebRuntime();
            const run = await runtime.campaigns.campaignRuns.findById(input.runId);
            if (run === null) {
              throw new Error("Broadcast draft not found.");
            }

            return run.launchType === "sms"
              ? (await resolveSmsCsvAudienceForRun(input.runId)).summary
                  .matchedCount
              : await countBroadcastUploadedRecipients(input.runId);
          })()
        : (
            await resolveWizardAudience({
              runId: input.runId,
              kind: input.kind,
              criteria: input.criteria,
              at: new Date(),
            })
          ).length;

    return successResult({
      count,
      hasAppliedFilters: hasAppliedAudienceFilters({
        ...criteria,
        ...(input.criteria.initialFilter === undefined
          ? {}
          : { initialFilter: input.criteria.initialFilter }),
      }),
    });
  } catch (error) {
    return errorResult(
      "campaign_audience_count_failed",
      error instanceof Error
        ? error.message
        : "Unable to resolve the audience count.",
      true,
    );
  }
}

export async function previewAudienceAction(input: {
  readonly runId: string;
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria;
}): Promise<UiResult<readonly AudiencePreviewRow[]>> {
  await requireSession();

  try {
    const criteria = audienceCriteriaSchema.parse(input.criteria);
    if (readAudienceMode(criteria) === "csv_upload") {
      const runtime = await getStage1WebRuntime();
      const run = await runtime.campaigns.campaignRuns.findById(input.runId);
      if (run === null) {
        return errorResult("campaign_not_found", "Broadcast draft not found.");
      }

      return successResult(
        run.launchType === "sms"
          ? (await resolveSmsCsvAudienceForRun(input.runId)).previewRows
          : await loadUploadedAudiencePreview(input.runId),
      );
    }

    const runtime = await getStage1WebRuntime();
    const aliasCache = new Map<string, Promise<string | null>>();
    const settingsProjects = await runtime.settings.projects.listAll();
    const projectsById = new Map(
      settingsProjects.map((project) => [project.projectId, project] as const),
    );
    const audience = await resolveWizardAudience({
      runId: input.runId,
      kind: input.kind,
      criteria,
      at: new Date(),
    });

    return successResult(
      await Promise.all(
        audience.slice(0, PREVIEW_LIMIT).map(async (member) => {
          const project =
            member.frozenProjectId == null
              ? null
              : (projectsById.get(member.frozenProjectId) ?? null);

          return {
            contactId: readAudienceRecipientKey(member),
            name: member.frozenFirstName ?? member.frozenEmail,
            email: member.frozenEmail,
            project: member.frozenProjectName,
            projectAlias: project?.projectAlias ?? null,
            projectAliasHint: normalizeAliasHint(
              await resolvePrimaryAliasEmail(
                runtime,
                member.frozenProjectId ?? null,
                aliasCache,
              ),
            ),
          };
        }),
      ),
    );
  } catch (error) {
    return errorResult(
      "campaign_audience_preview_failed",
      error instanceof Error
        ? error.message
        : "Unable to preview the audience.",
      true,
    );
  }
}

export async function loadComposePreviewAction(input: {
  readonly runId: string;
  readonly launchType: LaunchType;
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria;
  readonly fromEmail: string | null;
  readonly subjectTemplate: string;
  readonly subjectTemplateB?: string | null;
  readonly abTestEnabled?: boolean;
  readonly preheader: string;
  readonly bodyHtmlTemplate: string;
  readonly bodyTextTemplate: string;
  readonly sampleIndex: number;
}): Promise<UiResult<ComposePreviewData>> {
  await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const mergeRenderer = createMergeRenderer();
    const audience = await resolveWizardAudience({
      runId: input.runId,
      kind: input.kind,
      criteria: input.criteria,
      at: new Date(),
      fromEmail: input.fromEmail,
    });
    const orgSettings = await runtime.campaigns.orgSettings.read();
    const footerAddress = formatOrgAddress(orgSettings);

    if (audience.length === 0) {
      return successResult({
        audienceSize: 0,
        sampleIndex: 0,
        sampleCount: 0,
        sample: null,
        warningCount: 0,
        affectedContacts: [],
        footerAddress,
      });
    }

    const missingByContact = mergeMissingTokensByContact(
      mergeRenderer.validateTokens(
        {
          subject: input.subjectTemplate,
          bodyHtml: input.bodyHtmlTemplate,
        },
        audience,
      ),
      input.abTestEnabled && (input.subjectTemplateB?.trim().length ?? 0) > 0
        ? mergeRenderer.validateTokens(
            {
              subject: input.subjectTemplateB ?? "",
              bodyHtml: "",
            },
            audience,
          )
        : {},
    );
    const missingByRecipient = new Map(Object.entries(missingByContact));
    const normalizedSampleIndex =
      ((input.sampleIndex % audience.length) + audience.length) %
      audience.length;
    const sample = audience[normalizedSampleIndex] ?? audience[0];
    const origin = await readRequestOrigin();
    const projectId =
      input.criteria.projectId ?? input.criteria.projectIds[0] ?? null;
    const projectAlias =
      projectId === null
        ? null
        : ((await runtime.settings.projects.findById(projectId))
            ?.projectAlias ?? null);
    const unsubscribeUrls = buildBroadcastUnsubscribeUrls({
      appUrl: origin,
      unsubscribeToken: `preview-${input.kind}`,
    });
    const normalizedSenderAlias = normalizeAliasEmail(input.fromEmail);
    const signature =
      normalizedSenderAlias === null
        ? null
        : ((await runtime.settings.aliases.findByAlias(normalizedSenderAlias))
            ?.signature ?? null);
    const composed = renderBroadcastEmail({
      launchType: input.launchType,
      kind: input.kind,
      projectName: sample?.frozenProjectName ?? null,
      projectAlias,
      footerAddress,
      preheader: input.preheader,
      bodyHtmlTemplate: input.bodyHtmlTemplate,
      bodyTextTemplate: input.bodyTextTemplate,
      signature,
      scopedUnsubscribeHref: unsubscribeUrls.scopedHref,
      allUnsubscribeHref: unsubscribeUrls.allHref,
      senderEmail:
        input.fromEmail ??
        sample?.frozenAliasEmail ??
        "preview@example.invalid",
    });
    const rendered = mergeRenderer.render(
      {
        subject: input.subjectTemplate,
        bodyHtml: composed.bodyHtml,
        bodyText: composed.bodyText,
      },
      {
        firstName: sample?.frozenFirstName ?? null,
        projectName: sample?.frozenProjectName ?? null,
        aliasEmail: sample?.frozenAliasEmail ?? null,
        viewInBrowserUrl: null,
      },
    );

    return successResult({
      audienceSize: audience.length,
      sampleIndex: normalizedSampleIndex,
      sampleCount: audience.length,
      sample:
        sample === undefined
          ? null
          : {
              contactId: readAudienceRecipientKey(sample),
              name: sample.frozenFirstName ?? sample.frozenEmail,
              initials: deriveInitials(
                sample.frozenFirstName,
                sample.frozenEmail,
              ),
              email: sample.frozenEmail,
              project: sample.frozenProjectName,
              fromEmail: input.fromEmail ?? sample.frozenAliasEmail,
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.text,
            },
      warningCount: missingByRecipient.size,
      affectedContacts: audience
        .filter((member) =>
          missingByRecipient.has(readAudienceRecipientKey(member)),
        )
        .map((member) => ({
          contactId: readAudienceRecipientKey(member),
          name: member.frozenFirstName ?? member.frozenEmail,
          email: member.frozenEmail,
          project: member.frozenProjectName,
          missingTokens:
            missingByRecipient.get(readAudienceRecipientKey(member)) ?? [],
        })),
      footerAddress,
    });
  } catch (error) {
    return errorResult(
      "campaign_preview_failed",
      error instanceof Error
        ? error.message
        : "Unable to render the broadcast preview.",
      true,
    );
  }
}

export async function searchProjectVolunteersAction(input: {
  readonly aliasProjectIds: readonly string[];
  readonly query: string;
}): Promise<UiResult<readonly AudienceVolunteerSearchRow[]>> {
  await requireSession();

  const aliasProjectIds = input.aliasProjectIds
    .map((projectId) => projectId.trim())
    .filter((projectId, index, values) => {
      return projectId.length > 0 && values.indexOf(projectId) === index;
    });
  const query = input.query.trim();
  if (query.length < 2) {
    return successResult([]);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const aliasCache = new Map<string, Promise<string | null>>();
    const settingsProjects = await runtime.settings.projects.listAll();
    const projectsById = new Map(
      settingsProjects.map((project) => [project.projectId, project] as const),
    );
    const contacts = await runtime.repositories.contacts.searchByQuery({
      query,
      limit: 25,
      ...(aliasProjectIds.length === 0 ? {} : { projectIds: aliasProjectIds }),
    });
    if (contacts.length === 0) {
      return successResult([]);
    }

    const memberships =
      await runtime.repositories.contactMemberships.listByContactIds(
        contacts.map((contact) => contact.id),
      );
    const membershipsByContact = new Map<
      string,
      (typeof memberships)[number][]
    >(contacts.map((contact) => [contact.id, []]));
    for (const membership of memberships) {
      if (membership.projectId === null) {
        continue;
      }

      const existing = membershipsByContact.get(membership.contactId) ?? [];
      existing.push(membership);
      membershipsByContact.set(membership.contactId, existing);
    }

    return successResult(
      await Promise.all(
        contacts
          .filter(
            (contact) =>
              (aliasProjectIds.length === 0 ||
                (membershipsByContact.get(contact.id)?.length ?? 0) > 0) &&
              (contact.primaryEmail?.trim().length ?? 0) > 0,
          )
          .map(async (contact) => {
            const primaryMembership = [
              ...(membershipsByContact.get(contact.id) ?? []),
            ]
              .sort((left, right) =>
                (
                  projectsById.get(left.projectId ?? "")?.projectName ??
                  left.projectId ??
                  ""
                ).localeCompare(
                  projectsById.get(right.projectId ?? "")?.projectName ??
                    right.projectId ??
                    "",
                ),
              )
              .at(0);
            const project =
              primaryMembership?.projectId == null
                ? null
                : (projectsById.get(primaryMembership.projectId) ?? null);

            return {
              contactId: contact.id,
              name:
                contact.displayName.trim().length > 0
                  ? contact.displayName
                  : (contact.primaryEmail ?? contact.id),
              email: contact.primaryEmail ?? "",
              project: project?.projectName ?? null,
              projectAlias: project?.projectAlias ?? null,
              projectAliasHint: normalizeAliasHint(
                await resolvePrimaryAliasEmail(
                  runtime,
                  primaryMembership?.projectId ?? null,
                  aliasCache,
                ),
              ),
            } satisfies AudienceVolunteerSearchRow;
          }),
      ),
    );
  } catch (error) {
    return errorResult(
      "campaign_volunteer_search_failed",
      error instanceof Error
        ? error.message
        : "Unable to search contacts for the selected sender.",
      true,
    );
  }
}

export async function searchNewsletterSubscribersAction(input: {
  readonly query: string;
}): Promise<UiResult<readonly AudienceNewsletterSubscriberSearchRow[]>> {
  await requireSession();

  const query = input.query.trim();
  if (query.length < 2) {
    return successResult([]);
  }

  try {
    const rows = await searchNewsletterSubscribers(query, 25);
    return successResult(
      rows.map((row) => ({
        subscriberId: row.id,
        email: row.email,
        firstName: row.firstName ?? null,
      })),
    );
  } catch (error) {
    return errorResult(
      "campaign_newsletter_subscriber_search_failed",
      error instanceof Error
        ? error.message
        : "Unable to search newsletter subscribers.",
      true,
    );
  }
}

export async function loadMemberStatusCountsForProjects(
  projectIds: readonly string[],
  channel: MemberStatusCountChannel = "email",
): Promise<UiResult<AudienceStatusCounts>> {
  await requireSession();

  const normalizedProjectIds = projectIds
    .map((projectId) => projectId.trim())
    .filter((projectId, index, values) => {
      return projectId.length > 0 && values.indexOf(projectId) === index;
    });

  if (normalizedProjectIds.length === 0) {
    return successResult({});
  }

  try {
    const runtime = await getStage1WebRuntime();
    const contacts = await runtime.repositories.contacts.listAll();
    if (contacts.length === 0) {
      return successResult({});
    }

    const selectedProjectIds = new Set(normalizedProjectIds);
    const memberships =
      await runtime.repositories.contactMemberships.listByContactIds(
        contacts.map((contact) => contact.id),
      );

    if (channel === "sms") {
      const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
      const projectContactIds = new Set<string>();
      const statusesForSelectedProjects = new Set<ExpeditionMemberStatus>();

      for (const membership of memberships) {
        if (
          membership.projectId === null ||
          !selectedProjectIds.has(membership.projectId)
        ) {
          continue;
        }

        const normalizedStatus = normalizeExpeditionMemberStatus(
          membership.status,
        );
        if (normalizedStatus === null) {
          continue;
        }

        statusesForSelectedProjects.add(normalizedStatus);
        projectContactIds.add(membership.contactId);
      }

      if (projectContactIds.size === 0) {
        return successResult({});
      }

      const latestConsentByContactId =
        await runtime.repositories.consentRecords.findLatestByContactIds(
          [...projectContactIds],
        );
      const consentStatusByContactId = new Map(
        [...projectContactIds].map((contactId) => [
          contactId,
          latestConsentByContactId.get(contactId)?.status ?? null,
        ]),
      );
      const intersection = intersectSmsAudience({
        candidates: [...projectContactIds].map((contactId) => {
          const latestConsent = latestConsentByContactId.get(contactId);

          return {
            contactId,
            phoneE164:
              latestConsent?.status === "opted_in"
                ? latestConsent.phoneE164
                : null,
            firstName: null,
            email: contactsById.get(contactId)?.primaryEmail ?? null,
            projectName: null,
          };
        }),
        latestConsentByContactId: consentStatusByContactId,
      });
      const reachableContactIds = new Set(
        intersection.reachable.map((recipient) => recipient.contactId),
      );
      const counts = new Map<ExpeditionMemberStatus, Set<string>>();

      for (const membership of memberships) {
        if (
          membership.projectId === null ||
          !selectedProjectIds.has(membership.projectId) ||
          !reachableContactIds.has(membership.contactId)
        ) {
          continue;
        }

        const normalizedStatus = normalizeExpeditionMemberStatus(
          membership.status,
        );
        if (normalizedStatus === null) {
          continue;
        }

        const existing = counts.get(normalizedStatus) ?? new Set<string>();
        existing.add(membership.contactId);
        counts.set(normalizedStatus, existing);
      }

      return successResult(
        Object.fromEntries(
          [...statusesForSelectedProjects].map((status) => [
            status,
            counts.get(status)?.size ?? 0,
          ]),
        ) as AudienceStatusCounts,
      );
    }

    const counts = new Map<ExpeditionMemberStatus, Set<string>>();

    for (const membership of memberships) {
      if (
        membership.projectId === null ||
        !selectedProjectIds.has(membership.projectId)
      ) {
        continue;
      }

      const normalizedStatus = normalizeExpeditionMemberStatus(
        membership.status,
      );
      if (normalizedStatus === null) {
        continue;
      }

      const existing = counts.get(normalizedStatus) ?? new Set<string>();
      existing.add(membership.contactId);
      counts.set(normalizedStatus, existing);
    }

    return successResult(
      Object.fromEntries(
        [...counts.entries()].map(([status, contactIds]) => [
          status,
          contactIds.size,
        ]),
      ) as AudienceStatusCounts,
    );
  } catch (error) {
    return errorResult(
      "campaign_member_status_counts_failed",
      error instanceof Error
        ? error.message
        : "Unable to load member statuses for the selected projects.",
      true,
    );
  }
}

export async function uploadBroadcastAudienceCsvAction(input: {
  readonly runId: string;
  readonly csvText: string;
}): Promise<UiResult<CsvUploadSummary>> {
  await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(input.runId);
    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }
    if (run.kind !== "project") {
      return errorResult(
        "campaign_csv_upload_sender_unsupported",
        "CSV import is only available for project senders.",
      );
    }

    const parsed = parseRecipientCsv(input.csvText);
    const uploadedRows: BroadcastUploadedRecipientInput[] =
      parsed.recipients.map((recipient) => ({
        email: recipient.email,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
      }));

    await replaceBroadcastUploadedRecipients(input.runId, uploadedRows);

    return successResult({
      importedCount: parsed.importedCount,
      invalidSkippedCount: parsed.invalidSkippedCount,
      duplicatesRemovedCount: parsed.duplicatesRemovedCount,
      sample: (await loadUploadedAudiencePreview(input.runId)).slice(0, 5),
    });
  } catch (error) {
    return errorResult(
      "campaign_csv_upload_failed",
      error instanceof Error
        ? error.message
        : "Unable to import the CSV audience.",
      true,
    );
  }
}

export async function loadSmsCsvAudienceSummaryAction(input: {
  readonly runId: string;
}): Promise<UiResult<SmsCsvAudienceSummary>> {
  await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(input.runId);
    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }
    if (run.launchType !== "sms") {
      return errorResult(
        "campaign_sms_csv_summary_invalid_launch_type",
        "This broadcast is not an SMS broadcast.",
      );
    }

    return successResult((await resolveSmsCsvAudienceForRun(input.runId)).summary);
  } catch (error) {
    return errorResult(
      "campaign_sms_csv_summary_failed",
      error instanceof Error
        ? error.message
        : "Unable to load the SMS CSV audience summary.",
      true,
    );
  }
}

export async function saveCampaignWizardDraftAction(
  input: CampaignWizardDraftSaveInput,
): Promise<UiResult<CampaignWizardDraftData>> {
  const session = await requireSession();

  try {
    const parsed = campaignWizardDraftSaveInputSchema.parse(input);
    const runtime = await getStage1WebRuntime();
    const audienceCriteria = parsed.audienceCriteria;
    const updated = await runtime.campaigns.campaignRuns.updateDraft(
      parsed.runId,
      {
        observedUpdatedAt: parsed.observedUpdatedAt,
        launchType: parsed.launchType,
        kind: parsed.kind,
        projectId: await deriveRunProjectId(runtime, {
          kind: parsed.kind,
          criteria: audienceCriteria,
          fromEmail: parsed.fromEmail,
        }),
        name: parsed.name,
        fromEmail: parsed.fromEmail,
        replyToEmail: parsed.replyToEmail,
        subjectTemplate: parsed.subjectTemplate,
        subjectTemplateB: parsed.subjectTemplateB,
        abTestEnabled: parsed.abTestEnabled,
        bodyDesignJson: parsed.bodyDesignJson,
        bodyHtmlTemplate: parsed.bodyHtmlTemplate,
        bodyTextTemplate: parsed.bodyTextTemplate,
        preheader: parsed.preheader,
        audienceCriteria: toStoredAudienceCriteria(
          audienceCriteria,
        ) as CampaignRunRecord["audienceCriteria"],
        audienceSize: parsed.audienceSize,
        lastEditedByUserId: session.id,
      },
    );

    return successResult(mapDraftRecord(updated, session.email));
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "StaleCampaignRunDraftError"
    ) {
      return errorResult("campaign_draft_stale", CAMPAIGN_DRAFT_STALE_MESSAGE);
    }

    return errorResult(
      "campaign_draft_save_failed",
      error instanceof Error
        ? error.message
        : "Unable to save the broadcast draft.",
      true,
    );
  }
}

export async function confirmCampaignWizardDraftCurrentAction(
  input: Pick<CampaignWizardDraftSaveInput, "runId" | "observedUpdatedAt">,
): Promise<UiResult<{ readonly updatedAt: string }>> {
  await requireSession();

  try {
    const parsed = campaignWizardDraftBaselineSchema.parse(input);
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);

    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }

    if (
      new Date(run.updatedAt).getTime() >
      new Date(parsed.observedUpdatedAt).getTime()
    ) {
      return errorResult("campaign_draft_stale", CAMPAIGN_DRAFT_STALE_MESSAGE);
    }

    return successResult({
      updatedAt: run.updatedAt,
    });
  } catch (error) {
    return errorResult(
      "campaign_draft_freshness_failed",
      error instanceof Error
        ? error.message
        : "Unable to confirm the broadcast draft state.",
      true,
    );
  }
}
