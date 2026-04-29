import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { ZodError, z } from "zod";

import {
  mailchimpCampaignActivityRecordSchema,
  mapMailchimpRecord,
  toSafeIsoTimestamp,
  type MailchimpCampaignActivityRecord,
  uniqueStrings,
} from "@as-comms/integrations";
import type { Stage1PersistenceService } from "@as-comms/domain";
import type { SyncStateRecord } from "@as-comms/contracts";

import type { Stage1IngestService } from "../ingest/index.js";
import type { Stage1IngestResult } from "../ingest/types.js";
import {
  Stage1NonRetryableJobError,
  Stage1RetryableJobError,
  type Stage1JobFailure,
} from "../orchestration/index.js";
import { recordProjectionSeedOnce } from "../orchestration/projection-seed.js";
import { recordSyncFailureAudit } from "../orchestration/sync-failure-audit.js";
import type { Stage1SyncStateService } from "../orchestration/sync-state.js";

const mailchimpArtifactImportInputSchema = z.object({
  artifactPath: z.string().min(1),
  syncStateId: z.string().min(1),
  correlationId: z.string().min(1),
  traceId: z.string().min(1).nullable().default(null),
  receivedAt: z.string().datetime().nullable().default(null),
  limitCampaigns: z.number().int().positive().nullable().default(null),
  startAtCampaignId: z.string().min(1).nullable().default(null),
  unmatchedReportOutputRoot: z.string().min(1).nullable().default(null),
});

export type MailchimpArtifactImportInput = z.input<
  typeof mailchimpArtifactImportInputSchema
>;

export interface Stage1MailchimpArtifactImportResult {
  readonly outcome: "succeeded" | "failed";
  readonly artifactPath: string;
  readonly importedCampaignIds: readonly string[];
  readonly parsedCampaigns: number;
  readonly parsedRecords: number;
  readonly syncStateId: string;
  readonly correlationId: string;
  readonly summary: {
    readonly processed: number;
    readonly normalized: number;
    readonly duplicate: number;
    readonly reviewOpened: number;
    readonly quarantined: number;
    readonly deferred: number;
    readonly deadLetterCountIncrement: number;
    readonly skippedUnmatched: number;
    readonly skippedUnmatchedRecipients: number;
  };
  readonly checkpoint: string | null;
  readonly syncStatus: SyncStateRecord["status"];
  readonly message?: string;
  readonly unmatchedReportJsonPath?: string;
  readonly unmatchedReportCsvPath?: string;
}

interface MailchimpKnownIdentityIndex {
  readonly knownEmails: ReadonlySet<string>;
  readonly knownVolunteerIds: ReadonlySet<string>;
}

interface MailchimpUnmatchedRecipientRow {
  readonly campaignId: string;
  readonly campaignName: string | null;
  readonly audienceId: string | null;
  readonly memberId: string;
  readonly email: string | null;
  readonly platformId: string | null;
  readonly activityTypes: readonly string[];
}

type ImportedMailchimpCampaignActivityRecord =
  MailchimpCampaignActivityRecord & {
    readonly campaignName: string | null;
  };

interface Stage1MailchimpArtifactImportDependencies {
  readonly ingest: Pick<Stage1IngestService, "ingestMailchimpHistoricalRecord">;
  readonly persistence: Stage1PersistenceService;
  readonly syncState: Stage1SyncStateService;
  readonly mailchimpIdentityIndex?: MailchimpKnownIdentityIndex;
  readonly now?: () => Date;
}

const MAILCHIMP_RECORD_PROGRESS_INTERVAL = 25;
const DEFAULT_SYNC_STATE_HEARTBEAT_INTERVAL_MS = 30_000;
const emptyMailchimpKnownIdentityIndex: MailchimpKnownIdentityIndex = {
  knownEmails: new Set<string>(),
  knownVolunteerIds: new Set<string>(),
};
const consumerEmailDomains = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "msn.com",
]);
const artifactTimestampSchema = z.string().transform((value, context) => {
  const normalizedTimestamp = toSafeIsoTimestamp(value);

  if (normalizedTimestamp === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid datetime",
    });
    return z.NEVER;
  }

  return normalizedTimestamp;
});
const artifactOptionalStringSchema = z.string().optional().nullable();
const artifactMergeFieldsSchema = z.record(z.string(), z.unknown()).default({});
const mailchimpCampaignSummarySchema = z.object({
  id: z.string().min(1),
  campaign_title: artifactOptionalStringSchema,
  subject_line: artifactOptionalStringSchema,
  preview_text: artifactOptionalStringSchema,
  list_id: artifactOptionalStringSchema,
  send_time: artifactTimestampSchema,
});
const mailchimpSentToMemberSchema = z.object({
  email_id: artifactOptionalStringSchema,
  email_address: artifactOptionalStringSchema,
  merge_fields: artifactMergeFieldsSchema,
  status: artifactOptionalStringSchema,
  last_open: artifactOptionalStringSchema,
  campaign_id: artifactOptionalStringSchema,
  list_id: artifactOptionalStringSchema,
});
const mailchimpOpenEventSchema = z.object({
  timestamp: artifactTimestampSchema,
});
const mailchimpOpenDetailSchema = z.object({
  campaign_id: artifactOptionalStringSchema,
  list_id: artifactOptionalStringSchema,
  email_id: artifactOptionalStringSchema,
  email_address: artifactOptionalStringSchema,
  merge_fields: artifactMergeFieldsSchema,
  opens: z.array(mailchimpOpenEventSchema).default([]),
});
const mailchimpClickDetailSchema = z.object({
  id: z.string().min(1),
  url: artifactOptionalStringSchema,
  last_click: artifactOptionalStringSchema,
  campaign_id: artifactOptionalStringSchema,
});
const mailchimpClickMemberSchema = z.object({
  email_id: artifactOptionalStringSchema,
  email_address: artifactOptionalStringSchema,
  merge_fields: artifactMergeFieldsSchema,
  campaign_id: artifactOptionalStringSchema,
  list_id: artifactOptionalStringSchema,
  clicks: z.number().int().nonnegative().default(0),
});
const mailchimpClickMemberGroupSchema = z.object({
  linkId: z.string().min(1),
  url: artifactOptionalStringSchema,
  members: z.array(mailchimpClickMemberSchema).default([]),
});
const mailchimpUnsubscribedMemberSchema = z.object({
  email_id: artifactOptionalStringSchema,
  email_address: artifactOptionalStringSchema,
  merge_fields: artifactMergeFieldsSchema,
  timestamp: artifactTimestampSchema,
  reason: artifactOptionalStringSchema,
  campaign_id: artifactOptionalStringSchema,
  list_id: artifactOptionalStringSchema,
});
const mailchimpCampaignArtifactSchema = z.object({
  summary: mailchimpCampaignSummarySchema,
  sentTo: z.array(mailchimpSentToMemberSchema),
  openDetails: z.array(mailchimpOpenDetailSchema),
  clickDetails: z.array(mailchimpClickDetailSchema),
  clickMembers: z.array(mailchimpClickMemberGroupSchema),
  unsubscribed: z.array(mailchimpUnsubscribedMemberSchema),
});
const artifactFileNames = {
  summary: "summary.json",
  sentTo: "sent-to.json",
  openDetails: "open-details.json",
  clickDetails: "click-details.json",
  clickMembers: "click-members.json",
  unsubscribed: "unsubscribed.json",
} as const;

type MailchimpCampaignSummary = z.infer<typeof mailchimpCampaignSummarySchema>;
type MailchimpCampaignArtifact = z.infer<
  typeof mailchimpCampaignArtifactSchema
>;
type MailchimpClickDetail = z.infer<typeof mailchimpClickDetailSchema>;

interface MailchimpUnmatchedRecipientSummaryRow {
  readonly email: string | null;
  readonly memberId: string;
  readonly platformId: string | null;
  readonly domain: string | null;
  readonly audienceIds: readonly string[];
  readonly campaignIds: readonly string[];
  readonly campaignNames: readonly string[];
  readonly activityTypes: readonly string[];
  readonly sameLocalDifferentDomain: boolean;
  readonly localPartCandidateEmails: readonly string[];
  readonly bucket:
    | "has_platform_id"
    | "same_local_different_domain"
    | "consumer_domain_unmatched"
    | "other_unmatched";
}

interface MailchimpUnmatchedReport {
  readonly generatedAt: string;
  readonly summary: {
    readonly reviewRows: number;
    readonly distinctMembers: number;
    readonly distinctCampaignMembers: number;
    readonly withPlatformId: number;
    readonly sameLocalDifferentDomain: number;
    readonly consumerDomainMembers: number;
  };
  readonly topDomains: readonly {
    readonly domain: string;
    readonly count: number;
  }[];
  readonly topAudiences: readonly {
    readonly audienceId: string;
    readonly count: number;
  }[];
  readonly topCampaigns: readonly {
    readonly campaignId: string;
    readonly campaignName: string | null;
    readonly audienceId: string | null;
    readonly unmatchedMembers: number;
  }[];
  readonly recipients: readonly MailchimpUnmatchedRecipientSummaryRow[];
}

interface MailchimpUnmatchedReportPaths {
  readonly jsonPath: string;
  readonly csvPath: string;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function readMergeFieldString(
  mergeFields: Record<string, unknown>,
  key: string,
): string | null {
  const value = mergeFields[key];

  if (typeof value !== "string") {
    return null;
  }

  return normalizeOptionalString(value);
}

function buildArtifactPayloadRef(input: {
  readonly campaignPath: string;
  readonly fileName: string;
  readonly memberId: string;
}): string {
  return `mailchimp-artifact://${encodeURIComponent(input.campaignPath)}#file=${encodeURIComponent(input.fileName)}&member=${encodeURIComponent(input.memberId)}`;
}

function buildChecksum(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function buildCampaignSnippet(summary: MailchimpCampaignSummary): string {
  return (
    normalizeOptionalString(summary.preview_text) ??
    normalizeOptionalString(summary.subject_line) ??
    normalizeOptionalString(summary.campaign_title) ??
    ""
  );
}

function resolveMemberId(input: {
  readonly emailId: string | null | undefined;
  readonly normalizedEmail: string;
}): string {
  return normalizeOptionalString(input.emailId) ?? input.normalizedEmail;
}

function sortTimestamps(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function pickEarliestTimestamp(
  values: readonly (string | null | undefined)[],
): string | null {
  const timestamps = sortTimestamps(
    values
      .map((value) =>
        value === null || value === undefined
          ? null
          : toSafeIsoTimestamp(value),
      )
      .filter((value): value is string => value !== null),
  );

  return timestamps[0] ?? null;
}

function createMailchimpActivityRecord(input: {
  readonly campaignPath: string;
  readonly receivedAt: string;
  readonly campaignId: string;
  readonly audienceId: string | null;
  readonly campaignName: string | null;
  readonly snippet: string;
  readonly activityType: MailchimpCampaignActivityRecord["activityType"];
  readonly occurredAt: string;
  readonly memberId: string;
  readonly normalizedEmail: string;
  readonly mergeFields: Record<string, unknown>;
  readonly fileName: string;
  readonly checksumData: unknown;
}): ImportedMailchimpCampaignActivityRecord {
  const providerRecordId = [
    input.campaignId,
    input.memberId,
    input.activityType,
  ].join(":");
  const baseRecord = mailchimpCampaignActivityRecordSchema.parse({
    recordType: "campaign_member_activity",
    recordId: providerRecordId,
    activityType: input.activityType,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    payloadRef: buildArtifactPayloadRef({
      campaignPath: input.campaignPath,
      fileName: input.fileName,
      memberId: input.memberId,
    }),
    checksum: buildChecksum(input.checksumData),
    normalizedEmail: input.normalizedEmail,
    salesforceContactId: null,
    volunteerIdPlainValues: uniqueStrings(
      [readMergeFieldString(input.mergeFields, "PLATFORMID") ?? ""].filter(
        (value) => value.length > 0,
      ),
    ),
    normalizedPhones: [],
    campaignId: input.campaignId,
    audienceId: input.audienceId ?? "",
    memberId: input.memberId,
    snippet: input.snippet,
  });

  return {
    ...baseRecord,
    campaignName: input.campaignName,
  };
}

function sortMailchimpRecords(
  records: readonly ImportedMailchimpCampaignActivityRecord[],
): ImportedMailchimpCampaignActivityRecord[] {
  return [...records].sort((left, right) => {
    const occurredAtOrder = left.occurredAt.localeCompare(right.occurredAt);

    if (occurredAtOrder !== 0) {
      return occurredAtOrder;
    }

    return left.recordId.localeCompare(right.recordId);
  });
}

async function readMailchimpCampaignArtifact(input: {
  readonly campaignPath: string;
}): Promise<MailchimpCampaignArtifact> {
  const [
    summaryText,
    sentToText,
    openDetailsText,
    clickDetailsText,
    clickMembersText,
    unsubscribedText,
  ] = await Promise.all([
    readFile(resolve(input.campaignPath, artifactFileNames.summary), "utf8"),
    readFile(resolve(input.campaignPath, artifactFileNames.sentTo), "utf8"),
    readFile(
      resolve(input.campaignPath, artifactFileNames.openDetails),
      "utf8",
    ),
    readFile(
      resolve(input.campaignPath, artifactFileNames.clickDetails),
      "utf8",
    ),
    readFile(
      resolve(input.campaignPath, artifactFileNames.clickMembers),
      "utf8",
    ),
    readFile(
      resolve(input.campaignPath, artifactFileNames.unsubscribed),
      "utf8",
    ),
  ] as const);

  return mailchimpCampaignArtifactSchema.parse({
    summary: JSON.parse(summaryText) as unknown,
    sentTo: JSON.parse(sentToText) as unknown,
    openDetails: JSON.parse(openDetailsText) as unknown,
    clickDetails: JSON.parse(clickDetailsText) as unknown,
    clickMembers: JSON.parse(clickMembersText) as unknown,
    unsubscribed: JSON.parse(unsubscribedText) as unknown,
  });
}

async function importMailchimpCampaignArtifactRecordsFromPath(input: {
  readonly campaignPath: string;
  readonly receivedAt: string;
}): Promise<ImportedMailchimpCampaignActivityRecord[]> {
  const artifact = await readMailchimpCampaignArtifact({
    campaignPath: input.campaignPath,
  });
  const campaignId = artifact.summary.id;
  const campaignName = normalizeOptionalString(artifact.summary.campaign_title);
  const audienceId = normalizeOptionalString(artifact.summary.list_id) ?? null;
  const campaignSnippet = buildCampaignSnippet(artifact.summary);
  const sendTime = artifact.summary.send_time;
  const records: ImportedMailchimpCampaignActivityRecord[] = [];

  const earliestOpenByMemberId = new Map<string, string>();
  const lastOpenByMemberId = new Map<string, string>();

  for (const row of artifact.sentTo) {
    const normalizedEmail = normalizeEmail(row.email_address);

    if (normalizedEmail === null) {
      continue;
    }

    const memberId = resolveMemberId({
      emailId: row.email_id,
      normalizedEmail,
    });
    const earliestOpen = pickEarliestTimestamp([row.last_open]);

    if (earliestOpen !== null) {
      lastOpenByMemberId.set(memberId, earliestOpen);
    }

    records.push(
      createMailchimpActivityRecord({
        campaignPath: input.campaignPath,
        receivedAt: input.receivedAt,
        campaignId,
        audienceId: normalizeOptionalString(row.list_id) ?? audienceId,
        campaignName,
        snippet: campaignSnippet,
        activityType: "sent",
        occurredAt: sendTime,
        memberId,
        normalizedEmail,
        mergeFields: row.merge_fields,
        fileName: artifactFileNames.sentTo,
        checksumData: {
          campaignId,
          activityType: "sent",
          memberId,
          row,
        },
      }),
    );
  }

  for (const row of artifact.openDetails) {
    const normalizedEmail = normalizeEmail(row.email_address);

    if (normalizedEmail === null) {
      continue;
    }

    const memberId = resolveMemberId({
      emailId: row.email_id,
      normalizedEmail,
    });
    const earliestOpen = pickEarliestTimestamp(
      row.opens.map((open) => open.timestamp),
    );

    if (earliestOpen === null) {
      continue;
    }

    earliestOpenByMemberId.set(memberId, earliestOpen);
    records.push(
      createMailchimpActivityRecord({
        campaignPath: input.campaignPath,
        receivedAt: input.receivedAt,
        campaignId,
        audienceId: normalizeOptionalString(row.list_id) ?? audienceId,
        campaignName,
        snippet: campaignSnippet,
        activityType: "opened",
        occurredAt: earliestOpen,
        memberId,
        normalizedEmail,
        mergeFields: row.merge_fields,
        fileName: artifactFileNames.openDetails,
        checksumData: {
          campaignId,
          activityType: "opened",
          memberId,
          opens: row.opens,
        },
      }),
    );
  }

  const clickedMembers = new Map<
    string,
    {
      normalizedEmail: string;
      mergeFields: Record<string, unknown>;
      audienceId: string | null;
      clickedUrls: string[];
      linkIds: string[];
    }
  >();
  const clickDetailById = new Map<string, MailchimpClickDetail>(
    artifact.clickDetails.map((detail) => [detail.id, detail]),
  );

  for (const group of artifact.clickMembers) {
    for (const member of group.members) {
      const normalizedEmail = normalizeEmail(member.email_address);

      if (normalizedEmail === null) {
        continue;
      }

      const memberId = resolveMemberId({
        emailId: member.email_id,
        normalizedEmail,
      });
      const clickedUrl =
        normalizeOptionalString(group.url) ??
        normalizeOptionalString(clickDetailById.get(group.linkId)?.url ?? null);
      const existing = clickedMembers.get(memberId);

      if (existing === undefined) {
        clickedMembers.set(memberId, {
          normalizedEmail,
          mergeFields: member.merge_fields,
          audienceId: normalizeOptionalString(member.list_id) ?? audienceId,
          clickedUrls: uniqueStrings([clickedUrl ?? ""].filter(Boolean)),
          linkIds: [group.linkId],
        });
        continue;
      }

      existing.clickedUrls = uniqueStrings([
        ...existing.clickedUrls,
        clickedUrl ?? "",
      ]);
      existing.linkIds = uniqueStrings([...existing.linkIds, group.linkId]);
    }
  }

  for (const [memberId, clickedMember] of clickedMembers.entries()) {
    const occurredAt =
      earliestOpenByMemberId.get(memberId) ??
      lastOpenByMemberId.get(memberId) ??
      sendTime;
    const clickSnippet = clickedMember.clickedUrls[0] ?? campaignSnippet;

    records.push(
      createMailchimpActivityRecord({
        campaignPath: input.campaignPath,
        receivedAt: input.receivedAt,
        campaignId,
        audienceId: clickedMember.audienceId,
        campaignName,
        snippet: clickSnippet,
        activityType: "clicked",
        occurredAt,
        memberId,
        normalizedEmail: clickedMember.normalizedEmail,
        mergeFields: clickedMember.mergeFields,
        fileName: artifactFileNames.clickMembers,
        checksumData: {
          campaignId,
          activityType: "clicked",
          memberId,
          clickedUrls: clickedMember.clickedUrls,
          linkIds: clickedMember.linkIds,
        },
      }),
    );
  }

  for (const row of artifact.unsubscribed) {
    const normalizedEmail = normalizeEmail(row.email_address);

    if (normalizedEmail === null) {
      continue;
    }

    const memberId = resolveMemberId({
      emailId: row.email_id,
      normalizedEmail,
    });

    records.push(
      createMailchimpActivityRecord({
        campaignPath: input.campaignPath,
        receivedAt: input.receivedAt,
        campaignId,
        audienceId: normalizeOptionalString(row.list_id) ?? audienceId,
        campaignName,
        snippet: campaignSnippet,
        activityType: "unsubscribed",
        occurredAt: row.timestamp,
        memberId,
        normalizedEmail,
        mergeFields: row.merge_fields,
        fileName: artifactFileNames.unsubscribed,
        checksumData: {
          campaignId,
          activityType: "unsubscribed",
          memberId,
          timestamp: row.timestamp,
          reason: normalizeOptionalString(row.reason),
        },
      }),
    );
  }

  return sortMailchimpRecords(records);
}

function normalizeEmailLocalPart(email: string): string {
  const [localPart = ""] = email.toLowerCase().split("@");
  return localPart.split("+")[0] ?? localPart;
}

function resolveDomain(email: string | null): string | null {
  if (email === null) {
    return null;
  }

  const [, domain] = email.toLowerCase().split("@");
  return domain?.trim().length ? domain.trim() : null;
}

function classifyRecipientBucket(input: {
  readonly platformId: string | null;
  readonly sameLocalDifferentDomain: boolean;
  readonly domain: string | null;
}): MailchimpUnmatchedRecipientSummaryRow["bucket"] {
  if (input.platformId !== null) {
    return "has_platform_id";
  }

  if (input.sameLocalDifferentDomain) {
    return "same_local_different_domain";
  }

  if (input.domain !== null && consumerEmailDomains.has(input.domain)) {
    return "consumer_domain_unmatched";
  }

  return "other_unmatched";
}

function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function slugifyReportId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function buildMailchimpUnmatchedReport(input: {
  readonly generatedAt: string;
  readonly recipients: readonly MailchimpUnmatchedRecipientRow[];
  readonly knownIdentityIndex: MailchimpKnownIdentityIndex;
}): MailchimpUnmatchedReport {
  const localPartToKnownEmails = new Map<string, Set<string>>();

  for (const email of input.knownIdentityIndex.knownEmails) {
    const localPart = normalizeEmailLocalPart(email);

    if (!localPartToKnownEmails.has(localPart)) {
      localPartToKnownEmails.set(localPart, new Set());
    }

    localPartToKnownEmails.get(localPart)?.add(email);
  }

  const memberSummaryMap = new Map<
    string,
    {
      email: string | null;
      memberId: string;
      platformId: string | null;
      domain: string | null;
      audienceIds: Set<string>;
      campaignIds: Set<string>;
      campaignNames: Set<string>;
      activityTypes: Set<string>;
      sameLocalDifferentDomain: boolean;
      localPartCandidateEmails: Set<string>;
    }
  >();
  const campaignCounts = new Map<
    string,
    {
      campaignId: string;
      campaignName: string | null;
      audienceId: string | null;
      memberIds: Set<string>;
    }
  >();
  const domainCounts = new Map<string, number>();
  const audienceCounts = new Map<string, number>();

  for (const recipient of input.recipients) {
    const memberSummary = memberSummaryMap.get(recipient.memberId) ?? {
      email: recipient.email,
      memberId: recipient.memberId,
      platformId: recipient.platformId,
      domain: resolveDomain(recipient.email),
      audienceIds: new Set<string>(),
      campaignIds: new Set<string>(),
      campaignNames: new Set<string>(),
      activityTypes: new Set<string>(),
      sameLocalDifferentDomain: false,
      localPartCandidateEmails: new Set<string>(),
    };

    if (recipient.audienceId !== null) {
      memberSummary.audienceIds.add(recipient.audienceId);
      audienceCounts.set(
        recipient.audienceId,
        (audienceCounts.get(recipient.audienceId) ?? 0) + 1,
      );
    }

    memberSummary.campaignIds.add(recipient.campaignId);
    if (recipient.campaignName !== null) {
      memberSummary.campaignNames.add(recipient.campaignName);
    }
    for (const activityType of recipient.activityTypes) {
      memberSummary.activityTypes.add(activityType);
    }

    if (memberSummary.email !== null) {
      const localPart = normalizeEmailLocalPart(memberSummary.email);
      const candidates = Array.from(
        localPartToKnownEmails.get(localPart) ?? new Set<string>(),
      ).filter((candidateEmail) => candidateEmail !== memberSummary.email);

      if (candidates.length > 0) {
        memberSummary.sameLocalDifferentDomain = true;
        for (const candidateEmail of candidates) {
          memberSummary.localPartCandidateEmails.add(candidateEmail);
        }
      }
    }

    memberSummaryMap.set(recipient.memberId, memberSummary);

    const campaignSummary = campaignCounts.get(recipient.campaignId) ?? {
      campaignId: recipient.campaignId,
      campaignName: recipient.campaignName,
      audienceId: recipient.audienceId,
      memberIds: new Set<string>(),
    };
    campaignSummary.memberIds.add(recipient.memberId);
    campaignCounts.set(recipient.campaignId, campaignSummary);

    const domain = resolveDomain(recipient.email);
    if (domain !== null) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
  }

  const recipients = Array.from(memberSummaryMap.values())
    .map((memberSummary) => {
      const domain = memberSummary.domain;
      const sameLocalDifferentDomain = memberSummary.sameLocalDifferentDomain;

      return {
        email: memberSummary.email,
        memberId: memberSummary.memberId,
        platformId: memberSummary.platformId,
        domain,
        audienceIds: Array.from(memberSummary.audienceIds).sort(),
        campaignIds: Array.from(memberSummary.campaignIds).sort(),
        campaignNames: Array.from(memberSummary.campaignNames).sort(),
        activityTypes: Array.from(memberSummary.activityTypes).sort(),
        sameLocalDifferentDomain,
        localPartCandidateEmails: Array.from(
          memberSummary.localPartCandidateEmails,
        ).sort(),
        bucket: classifyRecipientBucket({
          platformId: memberSummary.platformId,
          sameLocalDifferentDomain,
          domain,
        }),
      };
    })
    .sort((left, right) => {
      if (left.email === null && right.email === null) {
        return left.memberId.localeCompare(right.memberId);
      }

      if (left.email === null) {
        return 1;
      }

      if (right.email === null) {
        return -1;
      }

      return left.email.localeCompare(right.email);
    });

  return {
    generatedAt: input.generatedAt,
    summary: {
      reviewRows: input.recipients.reduce(
        (total, recipient) => total + recipient.activityTypes.length,
        0,
      ),
      distinctMembers: recipients.length,
      distinctCampaignMembers: input.recipients.length,
      withPlatformId: recipients.filter(
        (recipient) => recipient.platformId !== null,
      ).length,
      sameLocalDifferentDomain: recipients.filter(
        (recipient) => recipient.sameLocalDifferentDomain,
      ).length,
      consumerDomainMembers: recipients.filter(
        (recipient) =>
          recipient.domain !== null &&
          consumerEmailDomains.has(recipient.domain),
      ).length,
    },
    topDomains: Array.from(domainCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([domain, count]) => ({
        domain,
        count,
      })),
    topAudiences: Array.from(audienceCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([audienceId, count]) => ({
        audienceId,
        count,
      })),
    topCampaigns: Array.from(campaignCounts.values())
      .sort((left, right) => right.memberIds.size - left.memberIds.size)
      .slice(0, 20)
      .map((campaignSummary) => ({
        campaignId: campaignSummary.campaignId,
        campaignName: campaignSummary.campaignName,
        audienceId: campaignSummary.audienceId,
        unmatchedMembers: campaignSummary.memberIds.size,
      })),
    recipients,
  };
}

async function writeMailchimpUnmatchedReport(input: {
  readonly outputRoot: string;
  readonly reportId: string;
  readonly report: MailchimpUnmatchedReport;
}): Promise<MailchimpUnmatchedReportPaths> {
  await mkdir(input.outputRoot, {
    recursive: true,
  });

  const reportId = slugifyReportId(input.reportId);
  const jsonPath = resolve(input.outputRoot, `${reportId}.json`);
  const csvPath = resolve(input.outputRoot, `${reportId}.csv`);
  const csvLines = [
    [
      "email",
      "member_id",
      "platform_id",
      "domain",
      "bucket",
      "audience_ids",
      "campaign_ids",
      "campaign_names",
      "activity_types",
      "same_local_different_domain",
      "local_part_candidate_emails",
    ].join(","),
    ...input.report.recipients.map((recipient) =>
      [
        recipient.email ?? "",
        recipient.memberId,
        recipient.platformId ?? "",
        recipient.domain ?? "",
        recipient.bucket,
        recipient.audienceIds.join("|"),
        recipient.campaignIds.join("|"),
        recipient.campaignNames.join("|"),
        recipient.activityTypes.join("|"),
        recipient.sameLocalDifferentDomain ? "true" : "false",
        recipient.localPartCandidateEmails.join("|"),
      ]
        .map(escapeCsvValue)
        .join(","),
    ),
  ];

  await writeFile(
    jsonPath,
    `${JSON.stringify(input.report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(csvPath, `${csvLines.join("\n")}\n`, "utf8");

  return {
    jsonPath,
    csvPath,
  };
}

function summarizeIngestResults(
  results: readonly Stage1IngestResult[],
  input?: {
    readonly skippedUnmatched: number;
    readonly skippedUnmatchedRecipients: number;
  },
) {
  return {
    processed: results.length,
    normalized: results.filter((result) => result.outcome === "normalized")
      .length,
    duplicate: results.filter((result) => result.outcome === "duplicate")
      .length,
    reviewOpened: results.filter((result) => result.outcome === "review_opened")
      .length,
    quarantined: results.filter((result) => result.outcome === "quarantined")
      .length,
    deferred: results.filter((result) => result.outcome === "deferred").length,
    deadLetterCountIncrement: results.filter(
      (result) => result.outcome === "quarantined",
    ).length,
    skippedUnmatched: input?.skippedUnmatched ?? 0,
    skippedUnmatchedRecipients: input?.skippedUnmatchedRecipients ?? 0,
  };
}

function isOccurredAtRecord(
  record: unknown,
): record is { readonly occurredAt: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    "occurredAt" in record &&
    typeof record.occurredAt === "string"
  );
}

function calculateHistoricalWindow(records: readonly unknown[]): {
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly checkpoint: string | null;
} {
  const occurredAtValues = records
    .filter(isOccurredAtRecord)
    .map((record) => record.occurredAt)
    .sort((left, right) => left.localeCompare(right));
  const windowStart = occurredAtValues[0] ?? null;
  const checkpoint = occurredAtValues.at(-1) ?? null;

  return {
    windowStart,
    windowEnd: checkpoint,
    checkpoint,
  };
}

function buildImportFailure(error: unknown): Stage1JobFailure {
  const message = error instanceof Error ? error.message : String(error);

  if (
    error instanceof Stage1NonRetryableJobError ||
    error instanceof ZodError
  ) {
    return {
      disposition: "non_retryable",
      retryable: false,
      message,
    };
  }

  return {
    disposition:
      error instanceof Stage1RetryableJobError ? "retryable" : "retryable",
    retryable: true,
    message,
  };
}

function readSyncStateHeartbeatIntervalMs(): number {
  const parsed = Number(process.env.SYNC_STATE_HEARTBEAT_INTERVAL_MS ?? "30000");

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SYNC_STATE_HEARTBEAT_INTERVAL_MS;
  }

  return parsed;
}

function buildMailchimpRecordCursor(
  campaignId: string,
  nextRecordIndex: number,
): string {
  return `${campaignId}:record:${String(nextRecordIndex)}`;
}

function parseMailchimpRecordCursor(cursor: string | null): {
  readonly campaignId: string;
  readonly nextRecordIndex: number;
} | null {
  if (cursor === null) {
    return null;
  }

  const marker = ":record:";
  const markerIndex = cursor.lastIndexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const campaignId = cursor.slice(0, markerIndex).trim();
  const nextRecordIndexValue = cursor.slice(markerIndex + marker.length).trim();
  const nextRecordIndex = Number.parseInt(nextRecordIndexValue, 10);

  if (
    campaignId.length === 0 ||
    Number.isNaN(nextRecordIndex) ||
    nextRecordIndex < 0
  ) {
    return null;
  }

  return {
    campaignId,
    nextRecordIndex,
  };
}

function resolveMailchimpResumePlan(
  cursor: string | null,
  campaignIds: readonly string[],
): {
  readonly completedCampaignIds: ReadonlySet<string>;
  readonly resumeCampaignId: string | null;
  readonly resumeNextRecordIndex: number;
} {
  const recordCursor = parseMailchimpRecordCursor(cursor);

  if (recordCursor !== null) {
    const resumeCampaignIndex = campaignIds.indexOf(recordCursor.campaignId);

    if (resumeCampaignIndex !== -1) {
      return {
        completedCampaignIds: new Set(
          campaignIds.slice(0, resumeCampaignIndex),
        ),
        resumeCampaignId: recordCursor.campaignId,
        resumeNextRecordIndex: recordCursor.nextRecordIndex,
      };
    }
  }

  if (cursor !== null) {
    const completedCampaignIndex = campaignIds.indexOf(cursor);

    if (completedCampaignIndex !== -1) {
      return {
        completedCampaignIds: new Set(
          campaignIds.slice(0, completedCampaignIndex + 1),
        ),
        resumeCampaignId: campaignIds[completedCampaignIndex + 1] ?? null,
        resumeNextRecordIndex: 0,
      };
    }
  }

  return {
    completedCampaignIds: new Set<string>(),
    resumeCampaignId: campaignIds[0] ?? null,
    resumeNextRecordIndex: 0,
  };
}

function shouldCheckpointMailchimpCampaignRecord(
  nextRecordIndex: number,
  recordCount: number,
): boolean {
  return (
    nextRecordIndex === recordCount ||
    nextRecordIndex % MAILCHIMP_RECORD_PROGRESS_INTERVAL === 0
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveCampaignArtifactPaths(input: {
  readonly artifactPath: string;
  readonly limitCampaigns: number | null;
  readonly startAtCampaignId: string | null;
}): Promise<string[]> {
  const resolvedArtifactPath = resolve(input.artifactPath);
  const summaryPath = resolve(resolvedArtifactPath, "summary.json");

  if (await pathExists(summaryPath)) {
    return [resolvedArtifactPath];
  }

  const entries = await readdir(resolvedArtifactPath, {
    withFileTypes: true,
  });
  const campaignPaths: string[] = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const campaignPath = resolve(resolvedArtifactPath, entry.name);

    if (await pathExists(resolve(campaignPath, "summary.json"))) {
      campaignPaths.push(campaignPath);
    }
  }

  const startIndex =
    input.startAtCampaignId === null
      ? 0
      : campaignPaths.findIndex(
          (campaignPath) => basename(campaignPath) === input.startAtCampaignId,
        );

  if (input.startAtCampaignId !== null && startIndex === -1) {
    throw new Error(
      `Could not find Mailchimp campaign artifact ${input.startAtCampaignId} under ${input.artifactPath}.`,
    );
  }

  const resumedCampaignPaths = campaignPaths.slice(
    startIndex === -1 ? 0 : startIndex,
  );

  return input.limitCampaigns === null
    ? resumedCampaignPaths
    : resumedCampaignPaths.slice(0, input.limitCampaigns);
}

async function findExistingDuplicateResult(
  persistence: Stage1PersistenceService,
  mapped: ReturnType<typeof mapMailchimpRecord>,
): Promise<Stage1IngestResult | null> {
  if (
    mapped.outcome !== "command" ||
    mapped.command.kind !== "canonical_event"
  ) {
    return null;
  }

  const existingSourceEvidence =
    await persistence.findSourceEvidenceByIdempotencyKey(
      mapped.command.input.sourceEvidence.idempotencyKey,
    );

  if (existingSourceEvidence === null) {
    return null;
  }

  const existingCanonicalEvent =
    await persistence.findCanonicalEventByIdempotencyKey(
      mapped.command.input.canonicalEvent.idempotencyKey,
    );

  if (existingCanonicalEvent === null) {
    return null;
  }

  return {
    outcome: "duplicate",
    ingestMode: "historical",
    provider: "mailchimp",
    sourceRecordType: mapped.sourceRecordType,
    sourceRecordId: mapped.sourceRecordId,
    commandKind: "canonical_event",
    sourceEvidenceId: existingSourceEvidence.id,
    canonicalEventId: existingCanonicalEvent.id,
    contactId: existingCanonicalEvent.contactId,
  };
}

function createMailchimpIdentityPresenceResolver(
  dependencies: Stage1MailchimpArtifactImportDependencies,
) {
  const emailCache = new Map<string, Promise<boolean>>();
  const volunteerIdCache = new Map<string, Promise<boolean>>();
  const knownIdentityIndex = dependencies.mailchimpIdentityIndex;

  const hasKnownEmail = (normalizedEmail: string): Promise<boolean> => {
    const cached = emailCache.get(normalizedEmail);

    if (cached !== undefined) {
      return cached;
    }

    const lookup =
      knownIdentityIndex !== undefined
        ? Promise.resolve(knownIdentityIndex.knownEmails.has(normalizedEmail))
        : dependencies.persistence.repositories.contactIdentities
            .listByNormalizedValue({
              kind: "email",
              normalizedValue: normalizedEmail,
            })
            .then((rows) => rows.length > 0);
    emailCache.set(normalizedEmail, lookup);

    return lookup;
  };

  const hasKnownVolunteerId = (volunteerId: string): Promise<boolean> => {
    const cached = volunteerIdCache.get(volunteerId);

    if (cached !== undefined) {
      return cached;
    }

    const lookup =
      knownIdentityIndex !== undefined
        ? Promise.resolve(knownIdentityIndex.knownVolunteerIds.has(volunteerId))
        : dependencies.persistence.repositories.contactIdentities
            .listByNormalizedValue({
              kind: "volunteer_id_plain",
              normalizedValue: volunteerId,
            })
            .then((rows) => rows.length > 0);
    volunteerIdCache.set(volunteerId, lookup);

    return lookup;
  };

  return {
    async hasKnownIdentity(record: MailchimpCampaignActivityRecord) {
      if (record.salesforceContactId !== null) {
        return true;
      }

      if (await hasKnownEmail(record.normalizedEmail)) {
        return true;
      }

      for (const volunteerId of record.volunteerIdPlainValues) {
        if (await hasKnownVolunteerId(volunteerId)) {
          return true;
        }
      }

      return false;
    },
  };
}

export function createStage1MailchimpArtifactImportService(
  dependencies: Stage1MailchimpArtifactImportDependencies,
) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async importArtifacts(
      input: MailchimpArtifactImportInput,
    ): Promise<Stage1MailchimpArtifactImportResult> {
      const parsedInput = mailchimpArtifactImportInputSchema.parse(input);
      const receivedAt = parsedInput.receivedAt ?? now().toISOString();
      const campaignPaths = await resolveCampaignArtifactPaths({
        artifactPath: parsedInput.artifactPath,
        limitCampaigns: parsedInput.limitCampaigns,
        startAtCampaignId: parsedInput.startAtCampaignId,
      });
      const importedCampaignIds = campaignPaths.map((campaignPath) =>
        basename(campaignPath),
      );

      if (campaignPaths.length === 0) {
        throw new Error(
          `No Mailchimp campaign artifacts were found under ${parsedInput.artifactPath}.`,
        );
      }

      const startedSyncState = await dependencies.syncState.startWindow({
        syncStateId: parsedInput.syncStateId,
        scope: "provider",
        provider: "mailchimp",
        jobType: "historical_backfill",
        cursor: null,
        checkpoint: null,
        windowStart: null,
        windowEnd: null,
      });
      const resumePlan = resolveMailchimpResumePlan(
        startedSyncState.cursor,
        importedCampaignIds,
      );

      let parsedRecords = 0;
      const ingestResults: Stage1IngestResult[] = [];
      let windowStart: string | null = startedSyncState.windowStart;
      let checkpoint: string | null = startedSyncState.windowEnd;
      let unmatchedReportPaths: {
        readonly jsonPath: string;
        readonly csvPath: string;
      } | null = null;
      let skippedUnmatched = 0;
      const skippedRecipients = new Map<
        string,
        {
          campaignId: string;
          campaignName: string | null;
          audienceId: string | null;
          memberId: string;
          email: string | null;
          platformId: string | null;
          activityTypes: Set<string>;
        }
      >();
      const identityPresenceResolver =
        createMailchimpIdentityPresenceResolver(dependencies);
      let pendingDeadLetterCountIncrement = 0;
      let latestCursor = startedSyncState.cursor;
      const heartbeatIntervalMs = readSyncStateHeartbeatIntervalMs();
      const heartbeatTimer = setInterval(() => {
        void dependencies.syncState
          .heartbeat({ syncStateId: parsedInput.syncStateId })
          .catch(() => {
            // Best-effort only; the stale-running sweeper handles missed heartbeats.
          });
      }, heartbeatIntervalMs);
      heartbeatTimer.unref();

      try {
        for (const campaignPath of campaignPaths) {
          const campaignId = basename(campaignPath);

          if (resumePlan.completedCampaignIds.has(campaignId)) {
            continue;
          }

          const records = await importMailchimpCampaignArtifactRecordsFromPath({
            campaignPath,
            receivedAt,
          });
          parsedRecords += records.length;
          const campaignWindow = calculateHistoricalWindow(records);

          if (
            campaignWindow.windowStart !== null &&
            (windowStart === null || campaignWindow.windowStart < windowStart)
          ) {
            windowStart = campaignWindow.windowStart;
          }

          if (
            campaignWindow.checkpoint !== null &&
            (checkpoint === null || campaignWindow.checkpoint > checkpoint)
          ) {
            checkpoint = campaignWindow.checkpoint;
          }

          const resumeNextRecordIndex =
            resumePlan.resumeCampaignId === campaignId
              ? Math.min(resumePlan.resumeNextRecordIndex, records.length)
              : 0;

          for (
            let recordIndex = 0;
            recordIndex < records.length;
            recordIndex += 1
          ) {
            const record = records[recordIndex];

            if (record === undefined) {
              continue;
            }

            const hasKnownIdentity =
              await identityPresenceResolver.hasKnownIdentity(record);
            const nextRecordIndex = recordIndex + 1;

            if (!hasKnownIdentity) {
              skippedUnmatched += 1;
              const skippedKey = `${record.campaignId}:${record.memberId}`;
              const existingSkippedRecipient =
                skippedRecipients.get(skippedKey);

              if (existingSkippedRecipient === undefined) {
                skippedRecipients.set(skippedKey, {
                  campaignId: record.campaignId,
                  campaignName: record.campaignName,
                  audienceId:
                    record.audienceId.trim().length === 0
                      ? null
                      : record.audienceId,
                  memberId: record.memberId,
                  email: record.normalizedEmail,
                  platformId: record.volunteerIdPlainValues[0] ?? null,
                  activityTypes: new Set([record.activityType]),
                });
              } else {
                existingSkippedRecipient.activityTypes.add(record.activityType);
              }
            } else if (recordIndex >= resumeNextRecordIndex) {
              const mapped = mapMailchimpRecord(record);
              const duplicateResult = await findExistingDuplicateResult(
                dependencies.persistence,
                mapped,
              );
              const ingestResult =
                duplicateResult ??
                (await dependencies.ingest.ingestMailchimpHistoricalRecord(
                  record,
                ));
              ingestResults.push(ingestResult);
              if (ingestResult.outcome === "quarantined") {
                pendingDeadLetterCountIncrement += 1;
              }

              if (
                ingestResult.outcome === "deferred" ||
                ingestResult.outcome === "quarantined" ||
                ingestResult.canonicalEventId === null
              ) {
              } else if (
                duplicateResult === null &&
                mapped.outcome === "command" &&
                mapped.command.kind === "canonical_event"
              ) {
                await recordProjectionSeedOnce(dependencies.persistence, {
                  canonicalEventId: mapped.command.input.canonicalEvent.id,
                  summary: mapped.command.input.canonicalEvent.summary,
                  snippet: mapped.command.input.canonicalEvent.snippet ?? "",
                  occurredAt: mapped.command.input.sourceEvidence.receivedAt,
                });
              }
            }

            if (
              recordIndex >= resumeNextRecordIndex &&
              shouldCheckpointMailchimpCampaignRecord(
                nextRecordIndex,
                records.length,
              )
            ) {
              latestCursor =
                nextRecordIndex === records.length
                  ? campaignId
                  : buildMailchimpRecordCursor(campaignId, nextRecordIndex);
              await dependencies.syncState.recordBatchProgress({
                syncStateId: parsedInput.syncStateId,
                scope: "provider",
                provider: "mailchimp",
                jobType: "historical_backfill",
                cursor: latestCursor,
                checkpoint,
                windowStart,
                windowEnd: checkpoint,
                deadLetterCountIncrement: pendingDeadLetterCountIncrement,
              });
              pendingDeadLetterCountIncrement = 0;
            }
          }

          if (records.length === 0) {
            latestCursor = campaignId;
            await dependencies.syncState.recordBatchProgress({
              syncStateId: parsedInput.syncStateId,
              scope: "provider",
              provider: "mailchimp",
              jobType: "historical_backfill",
              cursor: latestCursor,
              checkpoint,
              windowStart,
              windowEnd: checkpoint,
              deadLetterCountIncrement: pendingDeadLetterCountIncrement,
            });
            pendingDeadLetterCountIncrement = 0;
          }
        }

        if (skippedRecipients.size > 0) {
          const unmatchedRecipients: MailchimpUnmatchedRecipientRow[] =
            Array.from(skippedRecipients.values()).map((recipient) => ({
              campaignId: recipient.campaignId,
              campaignName: recipient.campaignName,
              audienceId: recipient.audienceId,
              memberId: recipient.memberId,
              email: recipient.email,
              platformId: recipient.platformId,
              activityTypes: Array.from(recipient.activityTypes).sort(),
            }));
          const report = buildMailchimpUnmatchedReport({
            generatedAt: now().toISOString(),
            recipients: unmatchedRecipients,
            knownIdentityIndex:
              dependencies.mailchimpIdentityIndex ??
              emptyMailchimpKnownIdentityIndex,
          });

          unmatchedReportPaths = await writeMailchimpUnmatchedReport({
            outputRoot:
              parsedInput.unmatchedReportOutputRoot ??
              resolve(parsedInput.artifactPath, "..", "unmatched-reports"),
            reportId: parsedInput.syncStateId,
            report,
          });
        }

        const summary = summarizeIngestResults(ingestResults, {
          skippedUnmatched,
          skippedUnmatchedRecipients: skippedRecipients.size,
        });
        const completedSyncState = await dependencies.syncState.completeWindow({
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "mailchimp",
          jobType: "historical_backfill",
          cursor: importedCampaignIds.at(-1) ?? null,
          checkpoint,
          windowStart,
          windowEnd: checkpoint,
          parityPercent: null,
          freshnessP95Seconds: null,
          freshnessP99Seconds: null,
          completedAt: now().toISOString(),
        });

        return {
          outcome: "succeeded",
          artifactPath: parsedInput.artifactPath,
          importedCampaignIds,
          parsedCampaigns: campaignPaths.length,
          parsedRecords,
          syncStateId: parsedInput.syncStateId,
          correlationId: parsedInput.correlationId,
          summary,
          checkpoint,
          syncStatus: completedSyncState.status,
          ...(unmatchedReportPaths === null
            ? {}
            : {
                unmatchedReportJsonPath: unmatchedReportPaths.jsonPath,
                unmatchedReportCsvPath: unmatchedReportPaths.csvPath,
              }),
        };
      } catch (error) {
        const failure = buildImportFailure(error);
        const failedSyncState = await dependencies.syncState.failWindow({
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "mailchimp",
          jobType: "historical_backfill",
          cursor: latestCursor,
          checkpoint,
          windowStart,
          windowEnd: checkpoint,
          deadLetterCountIncrement: pendingDeadLetterCountIncrement,
          deadLettered: false,
        });
        await recordSyncFailureAudit(dependencies.persistence, {
          syncStateId: parsedInput.syncStateId,
          scope: "provider",
          provider: "mailchimp",
          jobType: "historical_backfill",
          checkpoint,
          windowStart,
          windowEnd: checkpoint,
          failure,
          occurredAt: now().toISOString(),
          actorId: "stage1-mailchimp-artifact-import",
        });

        return {
          outcome: "failed",
          artifactPath: parsedInput.artifactPath,
          importedCampaignIds,
          parsedCampaigns: campaignPaths.length,
          parsedRecords,
          syncStateId: parsedInput.syncStateId,
          correlationId: parsedInput.correlationId,
          summary: {
            ...summarizeIngestResults(ingestResults, {
              skippedUnmatched,
              skippedUnmatchedRecipients: skippedRecipients.size,
            }),
          },
          checkpoint,
          syncStatus: failedSyncState.status,
          message: failure.message,
          ...(unmatchedReportPaths === null
            ? {}
            : {
                unmatchedReportJsonPath: unmatchedReportPaths.jsonPath,
                unmatchedReportCsvPath: unmatchedReportPaths.csvPath,
              }),
        };
      } finally {
        clearInterval(heartbeatTimer);
      }
    },
  };
}
