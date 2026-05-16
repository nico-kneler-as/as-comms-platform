"use server";

import { randomUUID } from "node:crypto";

import {
  cancelRunInputSchema,
  campaignSendJobName,
  campaignSendPayloadSchema,
  scheduleSendInputSchema,
  sendNowInputSchema,
} from "@as-comms/contracts";
import {
  createAudienceResolver,
  createCampaignSendOrchestrator,
  createExclusionFilter,
  createMergeRenderer,
} from "@as-comms/domain";

import type { UiError, UiSuccess } from "@/src/server/ui-result";

import { requireAdmin } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

interface CampaignActionData {
  readonly runId: string;
  readonly audienceSize?: number;
  readonly excludedCount?: number;
  readonly scheduledAt?: string | null;
  readonly state: "scheduled" | "cancelled";
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

function buildPostmarkClientForActions() {
  return {
    sendBatch(): Promise<never> {
      return Promise.reject(
        new Error("Campaign send actions never call sendBatch directly."),
      );
    },
  };
}

async function createCampaignOrchestrator() {
  const runtime = await getStage1WebRuntime();

  return {
    runtime,
    orchestrator: createCampaignSendOrchestrator({
      repositories: {
        campaignRuns: runtime.campaigns.campaignRuns,
        audienceSnapshots: runtime.campaigns.audienceSnapshots,
        settingsProjects: runtime.settings.projects,
      },
      audienceResolver: createAudienceResolver({
        repositories: {
          contacts: runtime.repositories.contacts,
          contactMemberships: runtime.repositories.contactMemberships,
          canonicalEvents: runtime.repositories.canonicalEvents,
          projectDimensions: runtime.repositories.projectDimensions,
          settingsProjects: runtime.settings.projects,
        },
      }),
      exclusionFilter: createExclusionFilter({
        repositories: {
          campaignRuns: runtime.campaigns.campaignRuns,
          contactConsent: runtime.campaigns.contactConsent,
          suppressionList: runtime.campaigns.suppressionList,
        },
      }),
      mergeRenderer: createMergeRenderer(),
      postmarkClient: buildPostmarkClientForActions(),
    }),
  };
}

async function enqueueCampaignSendJob(input: {
  readonly runId: string;
  readonly scheduledAt?: Date;
}): Promise<void> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    return;
  }

  const payload = campaignSendPayloadSchema.parse({
    runId: input.runId,
  });

  if (input.scheduledAt === undefined) {
    await runtime.connection.sql`
      select graphile_worker.add_job(
        identifier => ${campaignSendJobName},
        payload => ${JSON.stringify(payload)}::json,
        job_key => ${`campaign-send:${input.runId}`},
        job_key_mode => 'replace',
        max_attempts => 1
      )
    `;
    return;
  }

  await runtime.connection.sql`
    select graphile_worker.add_job(
      identifier => ${campaignSendJobName},
      payload => ${JSON.stringify(payload)}::json,
      run_at => ${input.scheduledAt.toISOString()}::timestamptz,
      job_key => ${`campaign-send:${input.runId}`},
      job_key_mode => 'replace',
      max_attempts => 1
    )
  `;
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
          "You must be signed in to manage campaigns.",
        ),
      };
    }

    if (error instanceof Error && error.message === "FORBIDDEN") {
      return {
        ok: false,
        error: errorResult("forbidden", "Only admins can manage campaigns."),
      };
    }

    throw error;
  }
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
    const { runtime, orchestrator } = await createCampaignOrchestrator();
    const frozen = await orchestrator.freeze(parsed.runId, new Date());
    const scheduledAt = new Date();
    await runtime.campaigns.campaignRuns.update(parsed.runId, {
      scheduledAt: scheduledAt.toISOString(),
      lastEditedByUserId: admin.userId,
    });
    await enqueueCampaignSendJob({
      runId: parsed.runId,
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
      error instanceof Error ? error.message : "Unable to start the campaign send.",
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
    const { runtime, orchestrator } = await createCampaignOrchestrator();
    const frozen = await orchestrator.freeze(parsed.runId, new Date());
    await runtime.campaigns.campaignRuns.update(parsed.runId, {
      scheduledAt: parsed.scheduledAt,
      lastEditedByUserId: admin.userId,
    });
    await enqueueCampaignSendJob({
      runId: parsed.runId,
      scheduledAt: new Date(parsed.scheduledAt),
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
      error instanceof Error ? error.message : "Unable to schedule the campaign.",
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
      error instanceof Error ? error.message : "Unable to cancel the campaign.",
      true,
    );
  }
}
