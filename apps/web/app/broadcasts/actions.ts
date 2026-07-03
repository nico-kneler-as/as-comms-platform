"use server";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { sql } from "drizzle-orm";

import {
  cancelRunInputSchema,
  campaignSendJobName,
  campaignSendJobMaxAttempts,
  campaignSendPayloadSchema,
  smsBroadcastSendJobMaxAttempts,
  smsBroadcastSendJobName,
  smsBroadcastSendPayloadSchema,
  type CampaignRunRecord,
  scheduleSendInputSchema,
  sendNowInputSchema,
} from "@as-comms/contracts";
import {
  buildBroadcastUnsubscribeUrls,
  createAudienceResolver,
  createCampaignSendOrchestrator,
  createExclusionFilter,
  createMergeRenderer,
  formatOrgAddress,
  normalizeAliasEmail,
  planSmsBroadcastFreeze,
  renderSmsBroadcast,
  renderBroadcastEmail,
  type SmsBroadcastAudienceMember,
} from "@as-comms/domain";
import { tryNormalizePhoneE164 } from "@as-comms/domain/phone";
import { createPostmarkClient } from "@as-comms/integrations";
import { z } from "zod";

import type { UiError, UiSuccess } from "@/src/server/ui-result";

import { requireAdmin, requireSession } from "@/src/server/auth/session";
import { sendSmsViaTwilio } from "@/src/server/composer/twilio-send";
import { readWebEnv } from "@/src/server/env";
import { estimateSmsCostUsd } from "@/src/lib/sms-pricing";
import {
  getStage1WebRuntime,
  listEnabledOrgSenders,
  withStage1WebTransaction,
  type Stage1WebTransaction,
  type Stage1WebRuntime,
} from "@/src/server/stage1-runtime";

import {
  listRunRecipients,
  type RecipientFilter,
  type RecipientQueryResult,
} from "./_lib/run-recipients";
import { resolveStoredCampaignAudience } from "./_lib/audience-data-source";

interface CampaignActionData {
  readonly runId: string;
  readonly audienceSize?: number;
  readonly excludedCount?: number;
  readonly scheduledAt?: string | null;
  readonly state: "scheduled" | "cancelled";
}

interface CampaignTestSendData {
  readonly runId: string;
  readonly recipientEmail: string;
}

interface SmsBroadcastSendNowData {
  readonly frozen: number;
  readonly reachable: number;
  readonly selected: number;
  readonly deduplicatedByPhone: number;
  readonly unreachable: Readonly<Record<string, number>>;
}

interface SmsBroadcastPreviewData {
  readonly selected: number;
  readonly reachable: number;
  readonly deduplicatedByPhone: number;
  readonly frozen: number;
  readonly unreachable: Readonly<Record<string, number>>;
  readonly totalSegments: number;
  readonly estCostUsd: number;
  readonly sampleBody: string | null;
}

interface SmsBroadcastTestSendData {
  readonly segments: number;
}

const recipientFilterSchema = z.enum([
  "all",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "unsubscribed",
] satisfies [RecipientFilter, ...RecipientFilter[]]);
const campaignProviderSchema = z.enum(["postmark", "mailchimp"]);

const listCampaignRecipientsInputSchema = z.object({
  runId: z.string().trim().min(1),
  provider: campaignProviderSchema.default("postmark"),
  filter: recipientFilterSchema.default("all"),
  query: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

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

async function appendCampaignAudit(input: {
  readonly actorType: "user" | "system";
  readonly actorId: string;
  readonly action: string;
  readonly runId: string;
  readonly detail: string;
  readonly metadataJson?: Record<string, unknown>;
  readonly auditEvidence?: Pick<
    Awaited<
      ReturnType<typeof getStage1WebRuntime>
    >["repositories"]["auditEvidence"],
    "append"
  >;
}) {
  const auditEvidence =
    input.auditEvidence ??
    (await getStage1WebRuntime()).repositories.auditEvidence;
  await auditEvidence.append({
    id: randomUUID(),
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: "campaign_run",
    entityId: input.runId,
    occurredAt: new Date().toISOString(),
    result: "recorded",
    policyCode: `stage5a.${input.action}`,
    metadataJson: {
      detail: input.detail,
      ...(input.metadataJson ?? {}),
    },
  });
}

function buildPostmarkClientForActions() {
  return {
    sendBatch(): Promise<never> {
      return Promise.reject(
        new Error("Campaign send actions never call sendBatch directly."),
      );
    },
  };
}

function buildLivePostmarkClient() {
  const env = readWebEnv();

  if (!env.POSTMARK_SERVER_TOKEN || !env.POSTMARK_ACCOUNT_TOKEN) {
    return null;
  }

  return createPostmarkClient({
    serverToken: env.POSTMARK_SERVER_TOKEN,
    accountToken: env.POSTMARK_ACCOUNT_TOKEN,
    webhookSigningSecret: env.POSTMARK_WEBHOOK_SIGNING_SECRET ?? "unused",
    baseUrl: env.POSTMARK_BASE_URL,
  });
}

function trimNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function createCampaignSendOrchestratorForRepositories(input: {
  readonly campaigns: Stage1WebRuntime["campaigns"];
  readonly repositories: Stage1WebRuntime["repositories"];
  readonly settings: Stage1WebRuntime["settings"];
}) {
  const env = readWebEnv();
  // Web-side orchestrator only handles freeze/cancel/etc.; the worker
  // does the actual sendBatch. appUrl is still required by the deps
  // interface so unsubscribe-footer wiring stays consistent end-to-end.
  const appUrl =
    trimNonEmpty(process.env.NEXT_PUBLIC_APP_URL) ??
    trimNonEmpty(process.env.WEB_BASE_URL) ??
    "http://localhost:3000";

  return createCampaignSendOrchestrator({
    repositories: {
      campaignRuns: input.campaigns.campaignRuns,
      audienceSnapshots: input.campaigns.audienceSnapshots,
      settingsProjects: input.settings.projects,
      settingsAliases: input.settings.aliases,
      orgSettings: input.campaigns.orgSettings,
      auditEvidence: input.repositories.auditEvidence,
    },
    audienceResolver: createAudienceResolver({
      repositories: {
        contacts: input.repositories.contacts,
        contactMemberships: input.repositories.contactMemberships,
        canonicalEvents: input.repositories.canonicalEvents,
        projectDimensions: input.repositories.projectDimensions,
        settingsProjects: input.settings.projects,
      },
    }),
    exclusionFilter: createExclusionFilter({
      repositories: {
        campaignRuns: input.campaigns.campaignRuns,
        contactConsent: input.campaigns.contactConsent,
        suppressionList: input.campaigns.suppressionList,
      },
    }),
    mergeRenderer: createMergeRenderer(),
    postmarkClient: buildPostmarkClientForActions(),
    appUrl,
    broadcastMessageStream: env.POSTMARK_BROADCAST_STREAM_ID,
  });
}

async function createCampaignOrchestrator() {
  const runtime = await getStage1WebRuntime();
  return {
    runtime,
    orchestrator: createCampaignSendOrchestratorForRepositories(runtime),
  };
}

async function enqueueCampaignSendJob(input: {
  readonly db: Pick<
    NonNullable<Stage1WebRuntime["connection"]>["db"],
    "execute"
  >;
  readonly runId: string;
  readonly scheduledAt?: Date;
}): Promise<void> {
  const payload = campaignSendPayloadSchema.parse({
    runId: input.runId,
  });

  if (input.scheduledAt === undefined) {
    await input.db.execute(sql`
      select graphile_worker.add_job(
        identifier => ${campaignSendJobName},
        payload => ${JSON.stringify(payload)}::json,
        job_key => ${`campaign-send:${input.runId}`},
        job_key_mode => 'replace',
        max_attempts => ${campaignSendJobMaxAttempts}
      )
    `);
    return;
  }

  await input.db.execute(sql`
    select graphile_worker.add_job(
      identifier => ${campaignSendJobName},
      payload => ${JSON.stringify(payload)}::json,
      run_at => ${input.scheduledAt.toISOString()}::timestamptz,
      job_key => ${`campaign-send:${input.runId}`},
      job_key_mode => 'replace',
      max_attempts => ${campaignSendJobMaxAttempts}
    )
  `);
}

async function enqueueSmsBroadcastSendJob(input: {
  readonly db: Pick<
    NonNullable<Stage1WebRuntime["connection"]>["db"],
    "execute"
  >;
  readonly runId: string;
}): Promise<void> {
  const payload = smsBroadcastSendPayloadSchema.parse({
    runId: input.runId,
  });

  await input.db.execute(sql`
    select graphile_worker.add_job(
      identifier => ${smsBroadcastSendJobName},
      payload => ${JSON.stringify(payload)}::json,
      job_key => ${`sms-broadcast-send:${input.runId}`},
      job_key_mode => 'replace',
      max_attempts => ${smsBroadcastSendJobMaxAttempts}
    )
  `);
}

async function assertCampaignAdmin(): Promise<
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly error: UiError }
> {
  try {
    const user = await requireAdmin();
    return {
      ok: true,
      userId: user.id,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return {
        ok: false,
        error: errorResult(
          "unauthorized",
          "You must be signed in to manage broadcasts.",
        ),
      };
    }

    if (error instanceof Error && error.message === "FORBIDDEN") {
      return {
        ok: false,
        error: errorResult("forbidden", "Only admins can manage broadcasts."),
      };
    }

    throw error;
  }
}

async function validateVerifiedSender(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly email: string | null;
  readonly failureMessage: string;
}): Promise<UiError | null> {
  if (input.email === null) {
    return errorResult("campaign_sender_unverified", input.failureMessage);
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  if (normalizedEmail.length === 0) {
    return errorResult("campaign_sender_unverified", input.failureMessage);
  }

  const hasVerifiedSender = (
    await input.runtime.settings.projects.listAll()
  ).some(
    (project) =>
      readPrimaryEmail(project)?.trim().toLowerCase() === normalizedEmail &&
      project.postmarkSenderStatus === "verified",
  );
  if (!hasVerifiedSender) {
    const hasEnabledOrgSender = (await listEnabledOrgSenders()).some(
      (sender) => sender.email.trim().toLowerCase() === normalizedEmail,
    );
    if (hasEnabledOrgSender) {
      return null;
    }

    return errorResult("campaign_sender_unverified", input.failureMessage);
  }

  return null;
}

async function resolveSenderFieldsForRun(
  transaction: Stage1WebTransaction,
  run: CampaignRunRecord,
): Promise<Pick<CampaignRunRecord, "fromEmail" | "fromName" | "replyToEmail">> {
  if (run.projectId === null) {
    return {
      fromEmail: run.fromEmail,
      fromName: run.fromName ?? "Adventure Scientists",
      replyToEmail: run.replyToEmail ?? run.fromEmail,
    };
  }

  const project = await transaction.settings.projects.findById(run.projectId);
  const primary =
    project?.emails.find((email) => email.isPrimary) ?? project?.emails[0];
  const primaryAddress = primary?.address.trim().toLowerCase() ?? null;

  return {
    fromEmail: primaryAddress ?? run.fromEmail,
    fromName: run.fromName ?? "Adventure Scientists",
    replyToEmail: primaryAddress ?? run.replyToEmail,
  };
}

function buildAudienceSnapshot(
  member: Awaited<ReturnType<typeof resolveStoredCampaignAudience>>[number],
) {
  return {
    id: randomUUID(),
    contactId: member.contactId,
    newsletterSubscriberId: member.newsletterSubscriberId,
    frozenEmail: member.frozenEmail,
    frozenFirstName: member.frozenFirstName,
    frozenProjectName: member.frozenProjectName,
    frozenProjectId: member.frozenProjectId,
    frozenAliasEmail: member.frozenAliasEmail,
    unsubscribeToken: randomUUID(),
    deliveryStatus: "pending" as const,
    providerMessageId: null,
    sentAt: null,
    deliveredAt: null,
    bouncedAt: null,
    openedAt: null,
    clickedAt: null,
    complainedAt: null,
    unsubscribedAt: null,
    lastEventAt: null,
  };
}

async function readFrozenAudienceResult(
  transaction: Stage1WebTransaction,
  runId: string,
  audienceSize: number | null,
): Promise<{ readonly audienceSize: number; readonly excludedCount: number }> {
  const snapshots = await transaction.campaigns.audienceSnapshots.listForRun(
    runId,
  );
  return {
    audienceSize: audienceSize ?? snapshots.length,
    excludedCount: 0,
  };
}

async function freezeNewsletterAudienceForSend(input: {
  readonly transaction: Stage1WebTransaction;
  readonly runId: string;
  readonly at: Date;
}): Promise<{ readonly audienceSize: number; readonly excludedCount: number }> {
  const run = await input.transaction.campaigns.campaignRuns.findById(
    input.runId,
  );
  if (run === null) {
    throw new Error(`Campaign run ${input.runId} was not found.`);
  }

  if (run.state === "sending") {
    return readFrozenAudienceResult(
      input.transaction,
      input.runId,
      run.audienceSize,
    );
  }

  if (run.state === "scheduled") {
    const snapshots = await input.transaction.campaigns.audienceSnapshots.listForRun(
      input.runId,
    );
    if (snapshots.length > 0) {
      return {
        audienceSize: run.audienceSize ?? snapshots.length,
        excludedCount: 0,
      };
    }
  }

  if (run.state !== "draft" && run.state !== "scheduled") {
    throw new Error(
      `Campaign run ${input.runId} cannot be frozen from ${run.state}.`,
    );
  }

  const members = await resolveStoredCampaignAudience({
    kind: run.kind,
    criteria: run.audienceCriteria,
    at: input.at,
  });
  const exclusionFilter = createExclusionFilter({
    repositories: {
      campaignRuns: input.transaction.campaigns.campaignRuns,
      contactConsent: input.transaction.campaigns.contactConsent,
      suppressionList: input.transaction.campaigns.suppressionList,
    },
  });
  const exclusions = await exclusionFilter.applyExclusions(
    members,
    input.runId,
    input.at,
  );

  await input.transaction.campaigns.audienceSnapshots.bulkInsert(
    input.runId,
    exclusions.eligible.map(buildAudienceSnapshot),
  );

  const senderFields = await resolveSenderFieldsForRun(input.transaction, run);

  if (run.state === "draft") {
    await input.transaction.campaigns.campaignRuns.transitionState(
      input.runId,
      "draft",
      "scheduled",
      {
        audienceSize: exclusions.eligible.length,
        scheduledAt: run.scheduledAt ?? input.at.toISOString(),
        ...senderFields,
      },
    );
  } else {
    await input.transaction.campaigns.campaignRuns.update(input.runId, {
      audienceSize: exclusions.eligible.length,
      ...senderFields,
    });
  }

  return {
    audienceSize: exclusions.eligible.length,
    excludedCount: exclusions.excluded.length,
  };
}

async function freezeSmsBroadcastAudienceForSend(input: {
  readonly transaction: Stage1WebTransaction;
  readonly run: CampaignRunRecord;
  readonly runId: string;
  readonly actorUserId: string;
  readonly at: Date;
  readonly audience: readonly {
    readonly contactId: string;
    readonly firstName: string | null;
    readonly email: string | null;
    readonly projectName: string | null;
  }[];
}) {
  const plan = await planSmsBroadcastFreeze({
    bodyTemplate: input.run.bodyTextTemplate,
    deps: createSmsBroadcastFreezeDeps({
      audience: input.audience,
      repositories: input.transaction.repositories,
      selectedContactIds: input.run.audienceCriteria.contactIds,
    }),
  });

  await input.transaction.repositories.smsMessages.bulkInsert(
    plan.messages.map((message) => ({
      id: randomUUID(),
      twilioMessageSid: null,
      direction: "outbound",
      contactId: message.contactId,
      phoneE164: message.phoneE164,
      senderId: plan.senderId,
      broadcastRunId: input.runId,
      body: message.body,
      segments: message.segments,
      encoding: message.encoding,
      mediaUrls: null,
      sendStatus: "queued",
      failedReason: null,
      failedDetail: null,
      sentAt: null,
      receivedAt: null,
      actorId: input.actorUserId,
      createdAt: input.at,
      updatedAt: input.at,
    })),
  );

  await input.transaction.campaigns.campaignRuns.transitionState(
    input.runId,
    "draft",
    "scheduled",
    {
      audienceSize: plan.frozen,
      scheduledAt: input.at.toISOString(),
      lastEditedByUserId: input.actorUserId,
    },
  );

  return plan;
}

function mapSmsAudienceMembers(
  members: Awaited<ReturnType<typeof resolveStoredCampaignAudience>>,
): readonly SmsBroadcastAudienceMember[] {
  return members.flatMap((member) =>
    member.contactId === null
      ? []
      : [
          {
            contactId: member.contactId,
            firstName: member.frozenFirstName,
            email: member.frozenEmail,
            projectName: member.frozenProjectName,
          },
        ],
  );
}

async function resolveSmsBroadcastAudienceForRun(input: {
  readonly kind: CampaignRunRecord["kind"];
  readonly criteria: CampaignRunRecord["audienceCriteria"];
  readonly at: Date;
}): Promise<readonly SmsBroadcastAudienceMember[]> {
  return mapSmsAudienceMembers(
    await resolveStoredCampaignAudience({
      kind: input.kind,
      criteria: input.criteria,
      at: input.at,
    }),
  );
}

function createSmsBroadcastFreezeDeps(input: {
  readonly audience: readonly SmsBroadcastAudienceMember[];
  readonly repositories: Pick<
    Stage1WebRuntime["repositories"],
    "consentRecords" | "smsSenders"
  >;
  readonly selectedContactIds: readonly string[];
}) {
  return {
    resolveAudience: () => Promise.resolve(input.audience),
    loadLatestConsentByContactIds: async (contactIds: readonly string[]) => {
      const latestConsentByContactId =
        await input.repositories.consentRecords.findLatestByContactIds(
          input.selectedContactIds,
        );
      const missingContactIds = contactIds.filter(
        (contactId) => !latestConsentByContactId.has(contactId),
      );
      const consentByContactId =
        missingContactIds.length === 0
          ? latestConsentByContactId
          : new Map([
              ...latestConsentByContactId,
              ...(
                await input.repositories.consentRecords.findLatestByContactIds(
                  missingContactIds,
                )
              ),
            ]);

      return new Map(
        [...consentByContactId].map(([contactId, consent]) => [
          contactId,
          {
            status: consent.status,
            phoneE164: consent.phoneE164,
          },
        ]),
      );
    },
    resolveActiveSmsSenderId: async () => {
      const activeSenders = await input.repositories.smsSenders.listActive();
      if (activeSenders.length !== 1) {
        throw new Error(
          `expected exactly one active SMS sender, found ${String(activeSenders.length)}`,
        );
      }

      const [activeSender] = activeSenders;
      if (activeSender === undefined) {
        throw new Error("Expected exactly one active SMS sender.");
      }

      return activeSender.id;
    },
  };
}

async function validateSingleActiveSmsSender(input: {
  readonly repositories: Pick<Stage1WebRuntime["repositories"], "smsSenders">;
}): Promise<UiError | null> {
  const activeSenders = await input.repositories.smsSenders.listActive();
  if (activeSenders.length === 1) {
    return null;
  }

  return errorResult(
    "campaign_sms_preview_missing_sender",
    activeSenders.length === 0
      ? "Activate an SMS sender before loading the preview."
      : "Resolve the SMS sender configuration before loading the preview.",
  );
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

function filterAudienceMembersBySelectedContacts<
  T extends { readonly contactId: string | null },
>(rows: readonly T[], contactIds: readonly string[]): readonly T[] {
  if (contactIds.length === 0) {
    return rows;
  }

  const selectedContactIds = new Set(contactIds);
  return rows.filter(
    (row) => row.contactId !== null && selectedContactIds.has(row.contactId),
  );
}

export async function sendNow(
  runId: string,
): Promise<UiSuccess<CampaignActionData> | UiError> {
  const admin = await assertCampaignAdmin();
  if (!admin.ok) {
    return admin.error;
  }

  try {
    const parsed = sendNowInputSchema.parse({
      runId,
      actorUserId: admin.userId,
    });
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);
    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }

    const senderError = await validateVerifiedSender({
      runtime,
      email: run.fromEmail,
      failureMessage: "Choose a verified sender before sending this broadcast.",
    });
    if (senderError !== null) {
      return senderError;
    }

    const scheduledAt = new Date();
    const frozen = await withStage1WebTransaction(async (transaction) => {
      const transactionalOrchestrator =
        createCampaignSendOrchestratorForRepositories(transaction);
      const frozenResult =
        run.kind === "newsletter"
          ? await freezeNewsletterAudienceForSend({
              transaction,
              runId: parsed.runId,
              at: scheduledAt,
            })
          : await transactionalOrchestrator.freeze(parsed.runId, scheduledAt);
      await transaction.campaigns.campaignRuns.update(parsed.runId, {
        scheduledAt: scheduledAt.toISOString(),
        lastEditedByUserId: admin.userId,
      });
      await enqueueCampaignSendJob({
        db: transaction.db,
        runId: parsed.runId,
      });
      await appendCampaignAudit({
        actorType: "user",
        actorId: admin.userId,
        action: "campaign_run.scheduled",
        runId: parsed.runId,
        detail: "Send now requested; the worker will start immediately.",
        auditEvidence: transaction.repositories.auditEvidence,
      });

      return frozenResult;
    });

    return {
      ok: true,
      data: {
        runId: parsed.runId,
        audienceSize: frozen.audienceSize,
        excludedCount: frozen.excludedCount,
        scheduledAt: scheduledAt.toISOString(),
        state: "scheduled",
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_send_failed",
      error instanceof Error
        ? error.message
        : "Unable to start the broadcast send.",
      true,
    );
  }
}

export async function schedule(
  runId: string,
  sendAt: Date,
): Promise<UiSuccess<CampaignActionData> | UiError> {
  const admin = await assertCampaignAdmin();
  if (!admin.ok) {
    return admin.error;
  }

  try {
    const parsed = scheduleSendInputSchema.parse({
      runId,
      scheduledAt: sendAt.toISOString(),
      actorUserId: admin.userId,
    });
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);
    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }

    const senderError = await validateVerifiedSender({
      runtime,
      email: run.fromEmail,
      failureMessage:
        "Choose a verified sender before scheduling this broadcast.",
    });
    if (senderError !== null) {
      return senderError;
    }

    const scheduledAt = new Date(parsed.scheduledAt);
    const frozen = await withStage1WebTransaction(async (transaction) => {
      const transactionalOrchestrator =
        createCampaignSendOrchestratorForRepositories(transaction);
      const frozenResult =
        run.kind === "newsletter"
          ? await freezeNewsletterAudienceForSend({
              transaction,
              runId: parsed.runId,
              at: scheduledAt,
            })
          : await transactionalOrchestrator.freeze(parsed.runId, scheduledAt);
      await transaction.campaigns.campaignRuns.update(parsed.runId, {
        scheduledAt: parsed.scheduledAt,
        lastEditedByUserId: admin.userId,
      });
      await enqueueCampaignSendJob({
        db: transaction.db,
        runId: parsed.runId,
        scheduledAt,
      });
      await appendCampaignAudit({
        actorType: "user",
        actorId: admin.userId,
        action: "campaign_run.scheduled",
        runId: parsed.runId,
        detail: `Scheduled for ${parsed.scheduledAt}.`,
        auditEvidence: transaction.repositories.auditEvidence,
      });

      return frozenResult;
    });

    return {
      ok: true,
      data: {
        runId: parsed.runId,
        audienceSize: frozen.audienceSize,
        excludedCount: frozen.excludedCount,
        scheduledAt: parsed.scheduledAt,
        state: "scheduled",
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_schedule_failed",
      error instanceof Error
        ? error.message
        : "Unable to schedule the broadcast.",
      true,
    );
  }
}

export async function sendSmsBroadcastNow(rawInput: {
  readonly runId: string;
}): Promise<UiSuccess<SmsBroadcastSendNowData> | UiError> {
  const admin = await assertCampaignAdmin();
  if (!admin.ok) {
    return admin.error;
  }

  try {
    const parsed = z
      .object({
        runId: z.string().trim().min(1),
      })
      .parse(rawInput);
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);
    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }
    if (run.launchType !== "sms") {
      return errorResult(
        "campaign_sms_send_invalid_launch_type",
        "This broadcast is not an SMS broadcast.",
      );
    }
    if (run.state !== "draft") {
      return errorResult(
        "campaign_sms_send_invalid_state",
        `SMS broadcasts can only be sent from draft state. Current state: ${run.state}.`,
      );
    }

    const queuedAt = new Date();
    const audience = await resolveSmsBroadcastAudienceForRun({
      kind: run.kind,
      criteria: run.audienceCriteria,
      at: queuedAt,
    });
    const frozen = await withStage1WebTransaction((transaction) =>
      freezeSmsBroadcastAudienceForSend({
        transaction,
        run,
        runId: parsed.runId,
        actorUserId: admin.userId,
        at: queuedAt,
        audience,
      }),
    );

    if (runtime.connection === null) {
      throw new Error(
        "DATABASE_URL must be set before using the Stage 1 web runtime.",
      );
    }

    await enqueueSmsBroadcastSendJob({
      db: runtime.connection.db,
      runId: parsed.runId,
    });
    await appendCampaignAudit({
      actorType: "user",
      actorId: admin.userId,
      action: "campaign_run.scheduled",
      runId: parsed.runId,
      detail: "SMS send requested; the worker will start immediately.",
      metadataJson: {
        channel: "sms",
        frozen: frozen.frozen,
      },
    });

    return {
      ok: true,
      data: {
        frozen: frozen.frozen,
        reachable: frozen.reachable,
        selected: frozen.selectedContacts,
        deduplicatedByPhone: frozen.deduplicatedByPhone,
        unreachable: frozen.unreachable,
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_sms_send_failed",
      error instanceof Error
        ? error.message
        : "Unable to start the SMS broadcast send.",
      true,
    );
  }
}

export async function previewSmsBroadcast(rawInput: {
  readonly runId: string;
}): Promise<UiSuccess<SmsBroadcastPreviewData> | UiError> {
  const admin = await assertCampaignAdmin();
  if (!admin.ok) {
    return admin.error;
  }

  try {
    const parsed = z
      .object({
        runId: z.string().trim().min(1),
      })
      .parse(rawInput);
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);

    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }
    if (run.launchType !== "sms") {
      return errorResult(
        "campaign_sms_preview_invalid_launch_type",
        "This broadcast is not an SMS broadcast.",
      );
    }
    if (
      run.bodyTextTemplate === null ||
      run.bodyTextTemplate.trim().length === 0
    ) {
      return errorResult(
        "campaign_sms_preview_missing_body",
        "Add SMS body copy before loading the preview.",
      );
    }

    const activeSenderError = await validateSingleActiveSmsSender({
      repositories: runtime.repositories,
    });
    if (activeSenderError !== null) {
      return activeSenderError;
    }

    const previewAt = new Date();
    const audience = await resolveSmsBroadcastAudienceForRun({
      kind: run.kind,
      criteria: run.audienceCriteria,
      at: previewAt,
    });
    const plan = await planSmsBroadcastFreeze({
      bodyTemplate: run.bodyTextTemplate,
      deps: createSmsBroadcastFreezeDeps({
        audience,
        repositories: runtime.repositories,
        selectedContactIds: run.audienceCriteria.contactIds,
      }),
    });
    const env = readWebEnv();
    const totalSegments = plan.messages.reduce(
      (sum, message) => sum + message.segments,
      0,
    );

    return {
      ok: true,
      data: {
        selected: plan.selectedContacts,
        reachable: plan.reachable,
        deduplicatedByPhone: plan.deduplicatedByPhone,
        frozen: plan.frozen,
        unreachable: plan.unreachable,
        totalSegments,
        estCostUsd: estimateSmsCostUsd(
          totalSegments,
          env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT,
        ),
        sampleBody: plan.messages[0]?.body ?? null,
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_sms_preview_failed",
      error instanceof Error
        ? error.message
        : "Unable to load the SMS broadcast preview.",
      true,
    );
  }
}

export async function sendSmsBroadcastTest(rawInput: {
  readonly runId: string;
  readonly toPhoneE164: string;
}): Promise<UiSuccess<SmsBroadcastTestSendData> | UiError> {
  const admin = await assertCampaignAdmin();
  if (!admin.ok) {
    return admin.error;
  }

  try {
    const parsed = z
      .object({
        runId: z.string().trim().min(1),
        toPhoneE164: z.string().trim().min(1),
      })
      .parse(rawInput);
    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);

    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }
    if (run.launchType !== "sms") {
      return errorResult(
        "campaign_sms_test_invalid_launch_type",
        "This broadcast is not an SMS broadcast.",
      );
    }
    if (
      run.bodyTextTemplate === null ||
      run.bodyTextTemplate.trim().length === 0
    ) {
      return errorResult(
        "campaign_sms_test_missing_body",
        "Add SMS body copy before sending a test.",
      );
    }

    const normalizedPhone = tryNormalizePhoneE164(parsed.toPhoneE164);
    if (normalizedPhone === null) {
      return errorResult(
        "campaign_sms_test_invalid_phone",
        "Enter a valid phone number.",
      );
    }

    const rendered = renderSmsBroadcast({
      template: run.bodyTextTemplate,
      context: {
        firstName: null,
        email: null,
      },
    });
    const sendResult = await sendSmsViaTwilio({
      toE164: normalizedPhone,
      body: rendered.body,
    });

    return {
      ok: true,
      data: {
        segments: sendResult.segments,
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_sms_test_send_failed",
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Unable to send the SMS broadcast test.",
    );
  }
}

export async function testSend(
  runId: string,
  recipientEmail: string,
): Promise<UiSuccess<CampaignTestSendData> | UiError> {
  const session = await requireSession();

  try {
    const parsed = z
      .object({
        runId: z.string().trim().min(1),
        recipientEmail: z.string().trim().email(),
      })
      .parse({
        runId,
        recipientEmail,
      });
    const client = buildLivePostmarkClient();
    if (client === null) {
      return errorResult(
        "campaign_test_send_unavailable",
        "Postmark is not configured for test sends in this environment.",
      );
    }

    const runtime = await getStage1WebRuntime();
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);
    if (run === null) {
      return errorResult("campaign_not_found", "Broadcast draft not found.");
    }

    const audience = filterAudienceMembersBySelectedContacts(
      await resolveStoredCampaignAudience({
        kind: run.kind,
        criteria: run.audienceCriteria,
        at: new Date(),
      }),
      run.audienceCriteria.contactIds,
    );
    const sample = audience[0];
    if (sample === undefined) {
      return errorResult(
        "campaign_test_send_missing_sample",
        "Add at least one audience recipient before sending a test.",
      );
    }

    const fromEmail = run.fromEmail ?? sample.frozenAliasEmail;
    const senderError = await validateVerifiedSender({
      runtime,
      email: fromEmail,
      failureMessage: "Choose a verified sender before sending a test.",
    });
    if (senderError !== null) {
      return senderError;
    }
    if (fromEmail === null) {
      return errorResult(
        "campaign_test_send_missing_sender",
        "Choose a verified sender before sending a test.",
      );
    }

    const footerAddress = formatOrgAddress(
      await runtime.campaigns.orgSettings.read(),
    );
    const origin = await readRequestOrigin();
    const projectAlias =
      run.projectId === null
        ? null
        : ((await runtime.settings.projects.findById(run.projectId))
            ?.projectAlias ?? null);
    const normalizedSenderAlias = normalizeAliasEmail(fromEmail);
    const signature =
      normalizedSenderAlias === null
        ? null
        : ((await runtime.settings.aliases.findByAlias(normalizedSenderAlias))
            ?.signature ?? null);
    const unsubscribeUrls = buildBroadcastUnsubscribeUrls({
      appUrl: origin,
      unsubscribeToken: `preview-${run.kind}`,
    });
    const composed = renderBroadcastEmail({
      launchType: run.launchType,
      kind: run.kind,
      projectName: sample.frozenProjectName,
      projectAlias,
      footerAddress,
      preheader: run.preheader,
      bodyHtmlTemplate: run.bodyHtmlTemplate ?? "",
      bodyTextTemplate: run.bodyTextTemplate ?? "",
      signature,
      scopedUnsubscribeHref: unsubscribeUrls.scopedHref,
      allUnsubscribeHref: unsubscribeUrls.allHref,
      senderEmail: fromEmail,
    });
    const mergeRenderer = createMergeRenderer();
    const rendered = mergeRenderer.render(
      {
        subject: run.subjectTemplate ?? "",
        bodyHtml: composed.bodyHtml,
        bodyText: composed.bodyText,
      },
      {
        firstName: sample.frozenFirstName,
        projectName: sample.frozenProjectName,
        aliasEmail: sample.frozenAliasEmail,
      },
    );

    // The wizard's "Send test" surface posts to this action and the operator
    // expects the message to land in the recipient's inbox. The sandbox token
    // (`isTest: true`) only validates the request shape and does NOT deliver,
    // which historically caused "I sent a test but never got it" confusion —
    // route through the real server token so the test is a real send.
    await client.sendBatch({
      messages: [
        {
          From: composed.fromHeader,
          To: parsed.recipientEmail,
          ...(run.replyToEmail === null ? {} : { ReplyTo: run.replyToEmail }),
          Subject: rendered.subject,
          HtmlBody: rendered.html,
          TextBody: rendered.text,
          MessageStream: "broadcast",
          Metadata: {
            campaignRunId: run.id,
            campaignType: "test",
            operatorUserId: session.id,
          },
          Headers: [
            {
              Name: "List-Unsubscribe",
              Value: composed.listUnsubscribeHeaderValue,
            },
            {
              Name: "List-Unsubscribe-Post",
              Value: "List-Unsubscribe=One-Click",
            },
          ],
        },
      ],
    });

    return {
      ok: true,
      data: {
        runId: run.id,
        recipientEmail: parsed.recipientEmail,
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_test_send_failed",
      error instanceof Error
        ? error.message
        : "Unable to send the test broadcast email.",
      true,
    );
  }
}

export async function listCampaignRecipients(input: {
  readonly runId: string;
  readonly provider?: "postmark" | "mailchimp";
  readonly filter?: RecipientFilter;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}): Promise<UiSuccess<RecipientQueryResult> | UiError> {
  await requireSession();

  try {
    const parsed = listCampaignRecipientsInputSchema.parse(input);
    const result = await listRunRecipients(parsed);

    return {
      ok: true,
      data: result,
      requestId: newRequestId(),
    };
  } catch {
    return errorResult(
      "campaign_recipients_load_failed",
      "Unable to load broadcast recipients.",
      true,
    );
  }
}

export async function cancelDraft(
  runId: string,
): Promise<UiSuccess<CampaignActionData> | UiError> {
  const admin = await assertCampaignAdmin();
  if (!admin.ok) {
    return admin.error;
  }

  try {
    const runtime = await getStage1WebRuntime();
    await runtime.campaigns.campaignRuns.transitionState(
      runId,
      "draft",
      "cancelled",
      {
        cancelledAt: new Date().toISOString(),
        cancelledReason: "Draft cancelled before launch.",
        lastEditedByUserId: admin.userId,
      },
    );

    return {
      ok: true,
      data: {
        runId,
        scheduledAt: null,
        state: "cancelled",
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_cancel_draft_failed",
      error instanceof Error ? error.message : "Unable to cancel the draft.",
      true,
    );
  }
}

export async function cancel(
  runId: string,
  reason: string,
): Promise<UiSuccess<CampaignActionData> | UiError> {
  const admin = await assertCampaignAdmin();
  if (!admin.ok) {
    return admin.error;
  }

  try {
    const parsed = cancelRunInputSchema.parse({
      runId,
      actorUserId: admin.userId,
      reason,
    });
    const { runtime, orchestrator } = await createCampaignOrchestrator();
    await orchestrator.cancel(parsed.runId, parsed.reason ?? "");
    const run = await runtime.campaigns.campaignRuns.findById(parsed.runId);
    await appendCampaignAudit({
      actorType: "user",
      actorId: admin.userId,
      action: "campaign_run.cancelled",
      runId: parsed.runId,
      detail:
        (parsed.reason?.trim().length ?? 0) > 0
          ? (parsed.reason ?? "Cancelled from the operator workflow.")
          : "Cancelled from the operator workflow.",
    });

    return {
      ok: true,
      data: {
        runId: parsed.runId,
        scheduledAt: run?.scheduledAt ?? null,
        state: "cancelled",
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_cancel_failed",
      error instanceof Error
        ? error.message
        : "Unable to cancel the broadcast.",
      true,
    );
  }
}

export async function duplicateCampaignRun(
  runId: string,
): Promise<UiSuccess<{ readonly runId: string }> | UiError> {
  const session = await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const existing = await runtime.campaigns.campaignRuns.findById(runId);
    if (existing === null) {
      return errorResult(
        "campaign_duplicate_missing",
        "Broadcast run was not found.",
      );
    }

    const duplicated = await runtime.campaigns.campaignRuns.create({
      id: randomUUID(),
      kind: existing.kind,
      launchType: existing.launchType,
      projectId: existing.projectId,
      name: existing.name,
      fromEmail: existing.fromEmail,
      fromName: existing.fromName,
      replyToEmail: existing.replyToEmail,
      subjectTemplate: existing.subjectTemplate,
      bodyHtmlTemplate: existing.bodyHtmlTemplate,
      bodyTextTemplate: existing.bodyTextTemplate,
      preheader: existing.preheader,
      audienceCriteria: existing.audienceCriteria,
      audienceSize: existing.audienceSize,
      createdByUserId: session.id,
      lastEditedByUserId: session.id,
    });

    await appendCampaignAudit({
      actorType: "user",
      actorId: session.id,
      action: "campaign_run.duplicated",
      runId: duplicated.id,
      detail: `Duplicated from ${runId}.`,
      metadataJson: {
        sourceRunId: runId,
      },
    });

    return {
      ok: true,
      data: {
        runId: duplicated.id,
      },
      requestId: newRequestId(),
    };
  } catch (error) {
    return errorResult(
      "campaign_duplicate_failed",
      error instanceof Error
        ? error.message
        : "Unable to duplicate the broadcast.",
      true,
    );
  }
}
