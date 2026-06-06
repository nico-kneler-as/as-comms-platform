"use server";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { sql } from "drizzle-orm";

import {
  cancelRunInputSchema,
  campaignSendJobName,
  campaignSendJobMaxAttempts,
  campaignSendPayloadSchema,
  scheduleSendInputSchema,
  sendNowInputSchema,
} from "@as-comms/contracts";
import {
  buildBroadcastPreheaderHtml,
  buildBroadcastUnsubscribeUrls,
  createAudienceResolver,
  createCampaignSendOrchestrator,
  createExclusionFilter,
  formatBroadcastFromHeader,
  createMergeRenderer,
} from "@as-comms/domain";
import { createPostmarkClient } from "@as-comms/integrations";
import { z } from "zod";

import type { UiError, UiSuccess } from "@/src/server/ui-result";

import { requireAdmin, requireSession } from "@/src/server/auth/session";
import { readWebEnv } from "@/src/server/env";
import {
  getStage1WebRuntime,
  withStage1WebTransaction,
  type Stage1WebRuntime,
} from "@/src/server/stage1-runtime";

import {
  buildCampaignFooterPreview,
  formatOrgAddress,
} from "./_lib/campaign-preview";
import {
  listRunRecipients,
  type RecipientFilter,
  type RecipientQueryResult,
} from "./_lib/run-recipients";

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
    Awaited<ReturnType<typeof getStage1WebRuntime>>["repositories"]["auditEvidence"],
    "append"
  >;
}) {
  const auditEvidence =
    input.auditEvidence ?? (await getStage1WebRuntime()).repositories.auditEvidence;
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
  readonly db: Pick<NonNullable<Stage1WebRuntime["connection"]>["db"], "execute">;
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

async function assertCampaignAdmin():
  Promise<{ readonly ok: true; readonly userId: string } | { readonly ok: false; readonly error: UiError }> {
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

  const hasVerifiedSender = (await input.runtime.settings.projects.listAll()).some(
    (project) =>
      readPrimaryEmail(project)?.trim().toLowerCase() === normalizedEmail &&
      project.postmarkSenderStatus === "verified",
  );
  if (!hasVerifiedSender) {
    return errorResult("campaign_sender_unverified", input.failureMessage);
  }

  return null;
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

function filterAudienceMembersBySelectedContacts<T extends { readonly contactId: string }>(
  rows: readonly T[],
  contactIds: readonly string[],
): readonly T[] {
  if (contactIds.length === 0) {
    return rows;
  }

  const selectedContactIds = new Set(contactIds);
  return rows.filter((row) => selectedContactIds.has(row.contactId));
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
      failureMessage: "Choose a verified sender alias before sending this broadcast.",
    });
    if (senderError !== null) {
      return senderError;
    }

    const scheduledAt = new Date();
    const frozen = await withStage1WebTransaction(async (transaction) => {
      const transactionalOrchestrator =
        createCampaignSendOrchestratorForRepositories(transaction);
      const frozenResult = await transactionalOrchestrator.freeze(
        parsed.runId,
        scheduledAt,
      );
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
      error instanceof Error ? error.message : "Unable to start the broadcast send.",
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
      failureMessage: "Choose a verified sender alias before scheduling this broadcast.",
    });
    if (senderError !== null) {
      return senderError;
    }

    const scheduledAt = new Date(parsed.scheduledAt);
    const frozen = await withStage1WebTransaction(async (transaction) => {
      const transactionalOrchestrator =
        createCampaignSendOrchestratorForRepositories(transaction);
      const frozenResult = await transactionalOrchestrator.freeze(
        parsed.runId,
        scheduledAt,
      );
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
      error instanceof Error ? error.message : "Unable to schedule the broadcast.",
      true,
    );
  }
}

export async function testSend(
  runId: string,
  recipientEmail: string,
): Promise<UiSuccess<CampaignTestSendData> | UiError> {
  const session = await requireSession();

  try {
    const parsed = z.object({
      runId: z.string().trim().min(1),
      recipientEmail: z.string().trim().email(),
    }).parse({
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

    const resolver = createAudienceResolver({
      repositories: {
        contacts: runtime.repositories.contacts,
        contactMemberships: runtime.repositories.contactMemberships,
        canonicalEvents: runtime.repositories.canonicalEvents,
        projectDimensions: runtime.repositories.projectDimensions,
        settingsProjects: runtime.settings.projects,
      },
    });
    const audience = filterAudienceMembersBySelectedContacts(
      await resolver.resolveAudience(run.audienceCriteria, new Date()),
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
      failureMessage: "Choose a verified sender alias before sending a test.",
    });
    if (senderError !== null) {
      return senderError;
    }
    if (fromEmail === null) {
      return errorResult(
        "campaign_test_send_missing_sender",
        "Choose a verified sender alias before sending a test.",
      );
    }

    const footerAddress = formatOrgAddress(await runtime.campaigns.orgSettings.read());
    const origin = await readRequestOrigin();
    const projectAlias =
      run.projectId === null
        ? null
        : (await runtime.settings.projects.findById(run.projectId))?.projectAlias ?? null;
    const unsubscribeUrls = buildBroadcastUnsubscribeUrls({
      appUrl: origin,
      unsubscribeToken: `preview-${run.kind}`,
    });
    const footer = buildCampaignFooterPreview({
      kind: run.kind,
      projectName: sample.frozenProjectName,
      projectAlias,
      footerAddress,
      origin,
    });
    const fromHeader = formatBroadcastFromHeader(fromEmail, projectAlias);
    const preheaderHtml = buildBroadcastPreheaderHtml(run.preheader);
    const mergeRenderer = createMergeRenderer();
    const rendered = mergeRenderer.render(
      {
        subject: run.subjectTemplate ?? "",
        bodyHtml: `${preheaderHtml}${run.bodyHtmlTemplate ?? ""}${footer.html}`,
        bodyText: [run.bodyTextTemplate ?? "", footer.text].filter(Boolean).join("\n\n"),
      },
      {
        firstName: sample.frozenFirstName,
        projectName: sample.frozenProjectName,
        aliasEmail: sample.frozenAliasEmail,
      },
    );

    await client.sendBatch({
      isTest: true,
      messages: [
        {
          From: fromHeader,
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
              Value: `<${unsubscribeUrls.scopedHref}>`,
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
    await runtime.campaigns.campaignRuns.transitionState(runId, "draft", "cancelled", {
      cancelledAt: new Date().toISOString(),
      cancelledReason: "Draft cancelled before launch.",
      lastEditedByUserId: admin.userId,
    });

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
      error instanceof Error ? error.message : "Unable to cancel the broadcast.",
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
      error instanceof Error ? error.message : "Unable to duplicate the broadcast.",
      true,
    );
  }
}
