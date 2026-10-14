"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  audienceCriteriaSchema,
  type AudienceCriteria,
  type CampaignRunRecord,
} from "@as-comms/contracts";

import type { UiResult } from "@/src/server/ui-result";
import { requireWorkspace } from "@/src/server/auth/workspace-access";
import { enqueueSalesforceAudienceListsSync } from "@/src/server/salesforce-audience-lists/enqueue";
import {
  getStage1WebRuntime,
  listEnabledOrgSenders,
} from "@/src/server/stage1-runtime";

import {
  clearBroadcastExclusionsAction,
  previewComposedAudience,
  uploadBroadcastExclusionsCsvAction,
} from "../broadcasts/_lib/audience-data-source";

export interface DonorAppealDraft {
  readonly runId: string;
  readonly name: string | null;
  readonly fromEmail: string | null;
  readonly fromName: string | null;
  readonly replyToEmail: string | null;
  readonly subject: string | null;
  readonly preheader: string | null;
  readonly bodyHtml: string | null;
  readonly bodyText: string | null;
  readonly bodyDesignJson: unknown;
  readonly audienceCriteria: AudienceCriteria;
  readonly audienceSize: number | null;
  readonly updatedAt: string;
  readonly operatorEmail: string;
}

export interface DonorAppealBootstrap {
  readonly senders: readonly { readonly email: string; readonly label: string }[];
  readonly lists: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string | null;
    readonly status: string | null;
    readonly memberCount: number;
  }[];
  readonly lastSyncedAt: string | null;
  readonly earlierAppeals: readonly { readonly id: string; readonly name: string }[];
}

const saveSchema = z.object({
  runId: z.string().min(1),
  observedUpdatedAt: z.string().datetime(),
  name: z.string().trim().min(1),
  fromEmail: z.string().email(),
  fromName: z.string().trim().min(1),
  replyToEmail: z.string().email(),
  subject: z.string().trim().nullable(),
  preheader: z.string().trim().nullable(),
  bodyHtml: z.string().nullable(),
  bodyText: z.string().nullable(),
  bodyDesignJson: z.unknown().nullable(),
  audienceCriteria: audienceCriteriaSchema,
  audienceSize: z.number().int().nonnegative().nullable(),
});

function mapDraft(run: CampaignRunRecord, operatorEmail: string): DonorAppealDraft {
  return {
    runId: run.id,
    name: run.name,
    fromEmail: run.fromEmail,
    fromName: run.fromName,
    replyToEmail: run.replyToEmail,
    subject: run.subjectTemplate,
    preheader: run.preheader,
    bodyHtml: run.bodyHtmlTemplate,
    bodyText: run.bodyTextTemplate,
    bodyDesignJson: run.bodyDesignJson ?? null,
    audienceCriteria: audienceCriteriaSchema.parse(run.audienceCriteria),
    audienceSize: run.audienceSize,
    updatedAt: run.updatedAt,
    operatorEmail,
  };
}

async function donorRun(runId: string) {
  const access = await requireWorkspace("donors");
  const runtime = await getStage1WebRuntime();
  const run = await runtime.campaigns.campaignRuns.findById(runId);
  if (run === null) throw new Error("NOT_FOUND");
  if (run.workspace !== "donors") throw new Error("FORBIDDEN");
  return { access, runtime, run };
}

function resultError(message: string): UiResult<never> {
  return { ok: false, code: "donor_appeal_failed", message, requestId: randomUUID() };
}

export async function createDonorAppealDraft(): Promise<DonorAppealDraft> {
  const access = await requireWorkspace("donors");
  const runtime = await getStage1WebRuntime();
  const created = await runtime.campaigns.campaignRuns.create({
    id: randomUUID(),
    workspace: "donors",
    kind: "newsletter",
    launchType: "html_email",
    projectId: null,
    name: null,
    fromEmail: "donate@adventurescientists.org",
    fromName: "Adventure Scientists",
    replyToEmail: "donate@adventurescientists.org",
    subjectTemplate: null,
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: null,
    bodyDesignJson: null,
    bodyTextTemplate: null,
    preheader: null,
    audienceCriteria: audienceCriteriaSchema.parse({ initialFilter: "all_available" }),
    audienceSize: null,
    createdByUserId: access.user.id,
    lastEditedByUserId: access.user.id,
  });
  revalidatePath("/donors");
  return mapDraft(created, access.user.email);
}

export async function getDonorAppealDraft(runId: string): Promise<DonorAppealDraft | null> {
  try {
    const { access, run } = await donorRun(runId);
    return run.state === "draft" ? mapDraft(run, access.user.email) : null;
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return null;
    throw error;
  }
}

export async function getDonorAppealBootstrap(): Promise<DonorAppealBootstrap> {
  await requireWorkspace("donors");
  const runtime = await getStage1WebRuntime();
  const [senders, lists, lastSyncedAt, earlierAppeals] = await Promise.all([
    listEnabledOrgSenders(),
    runtime.campaigns.salesforceAudienceLists.listAll(),
    runtime.campaigns.salesforceAudienceLists.lastSyncedAt(),
    runtime.campaigns.campaignRuns.listRecent({ limit: 100 }),
  ]);
  return {
    senders: senders.map((sender) => ({ email: sender.email, label: sender.label })),
    lists: lists
      .filter((list) => list.kind === "campaign")
      .map((list) => ({ id: list.id, name: list.name, type: list.campaignType, status: list.campaignStatus, memberCount: list.memberCount })),
    lastSyncedAt,
    earlierAppeals: earlierAppeals
      .filter((run) => run.kind === "newsletter" && (run.state === "complete" || run.state === "finalized") && run.resendOfRunId === null)
      .map((run) => ({ id: run.id, name: run.name ?? run.subjectTemplate ?? "Untitled appeal" })),
  };
}

export async function saveDonorAppealDraft(input: z.input<typeof saveSchema>): Promise<UiResult<DonorAppealDraft>> {
  try {
    const parsed = saveSchema.parse(input);
    const { access, runtime, run } = await donorRun(parsed.runId);
    if (run.state !== "draft") return resultError("This appeal can no longer be edited.");
    const updated = await runtime.campaigns.campaignRuns.updateDraft(parsed.runId, {
      observedUpdatedAt: parsed.observedUpdatedAt,
      workspace: "donors",
      kind: "newsletter",
      launchType: "html_email",
      projectId: null,
      name: parsed.name,
      fromEmail: parsed.fromEmail,
      fromName: parsed.fromName,
      replyToEmail: parsed.replyToEmail,
      subjectTemplate: parsed.subject,
      subjectTemplateB: null,
      abTestEnabled: false,
      bodyDesignJson: parsed.bodyDesignJson,
      bodyHtmlTemplate: parsed.bodyHtml,
      bodyTextTemplate: parsed.bodyText,
      preheader: parsed.preheader,
      audienceCriteria: parsed.audienceCriteria,
      audienceSize: parsed.audienceSize,
      lastEditedByUserId: access.user.id,
    });
    revalidatePath("/donors");
    return { ok: true, data: mapDraft(updated, access.user.email), requestId: randomUUID() };
  } catch (error) {
    return resultError(error instanceof Error ? error.message : "Unable to save this appeal.");
  }
}

export async function refreshDonorSalesforceCampaigns(): Promise<UiResult<void>> {
  await requireWorkspace("donors");
  try {
    await enqueueSalesforceAudienceListsSync({ workspace: "donors" });
    return { ok: true, data: undefined, requestId: randomUUID() };
  } catch (error) {
    return resultError(error instanceof Error ? error.message : "Unable to refresh Salesforce campaigns.");
  }
}

export async function previewDonorAppealAudience(runId: string) {
  await donorRun(runId);
  return previewComposedAudience(runId);
}

export async function uploadDonorExclusions(input: { readonly runId: string; readonly csvText: string }) {
  await donorRun(input.runId);
  return uploadBroadcastExclusionsCsvAction(input);
}

export async function clearDonorExclusions(runId: string) {
  await donorRun(runId);
  return clearBroadcastExclusionsAction(runId);
}
