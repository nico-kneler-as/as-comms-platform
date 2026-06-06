import { randomUUID } from "node:crypto";

import type {
  AuditEvidenceRecord,
  AudienceSnapshotRecord,
  CampaignKind,
  CampaignRunRecord,
  NewAudienceSnapshot,
  OrgSettingsRecord,
  RunState,
} from "@as-comms/contracts";

import type {
  AudienceMember,
  MergeContext,
} from "./campaign-types.js";
import {
  buildBroadcastPreheaderHtml,
  buildBroadcastUnsubscribeUrls,
  escapeHtml,
  formatBroadcastFromHeader,
} from "./broadcast-email-render.js";
import type { AudienceResolver } from "./audience-resolver.js";
import type { ExclusionFilter } from "./exclusion-filter.js";
import type { MergeRenderer } from "./merge-renderer.js";
import type { SettingsProjectsRepository } from "./settings/repositories.js";

export interface CampaignSendOrchestrator {
  freeze(
    runId: string,
    at: Date,
  ): Promise<{ audienceSize: number; excludedCount: number }>;
  processSendRequest(runId: string): Promise<void>;
  cancel(runId: string, reason: string): Promise<void>;
}

interface PostmarkBatchSendResult {
  readonly ErrorCode: number;
  readonly Message: string;
  readonly MessageID: string;
  readonly SubmittedAt: string;
  readonly To: string;
}

interface PostmarkClientLike {
  sendBatch(req: {
    readonly messages: readonly {
      readonly From: string;
      readonly To: string;
      readonly ReplyTo?: string;
      readonly Subject: string;
      readonly HtmlBody?: string;
      readonly TextBody?: string;
      readonly MessageStream?: string;
      readonly Metadata?: Record<string, string>;
      readonly Headers?: readonly {
        readonly Name: string;
        readonly Value: string;
      }[];
    }[];
  }): Promise<{ readonly results: readonly PostmarkBatchSendResult[] }>;
}

interface CampaignSendRepositories {
  readonly campaignRuns: {
    findById(id: string): Promise<CampaignRunRecord | null>;
    transitionState(
      id: string,
      from: RunState,
      to: RunState,
      fields?: Partial<CampaignRunRecord>,
    ): Promise<CampaignRunRecord>;
    update(
      id: string,
      fields: Partial<CampaignRunRecord>,
    ): Promise<CampaignRunRecord>;
  };
  readonly audienceSnapshots: {
    bulkInsert(
      runId: string,
      members: readonly NewAudienceSnapshot[],
    ): Promise<void>;
    listForRun(runId: string): Promise<readonly AudienceSnapshotRecord[]>;
    update(
      id: string,
      fields: Partial<AudienceSnapshotRecord>,
    ): Promise<AudienceSnapshotRecord>;
  };
  readonly settingsProjects: Pick<SettingsProjectsRepository, "findById">;
  readonly orgSettings: {
    read(): Promise<OrgSettingsRecord>;
  };
  readonly auditEvidence?: {
    append(record: AuditEvidenceRecord): Promise<AuditEvidenceRecord>;
  };
}

function formatOrgAddress(input: OrgSettingsRecord): string | null {
  const line1 = input.physicalAddressLine1.trim();
  const line2 = input.physicalAddressLine2.trim();
  const city = input.physicalCity.trim();
  const state = input.physicalState.trim();
  const zip = input.physicalZip.trim();
  const country = input.physicalCountry.trim();
  const cityLine = [city, state, zip].filter((part) => part.length > 0).join(", ");
  const parts = [line1, line2, cityLine, country].filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join(" • ");
}

function buildUnsubscribeFooter(input: {
  readonly kind: CampaignKind;
  readonly projectName: string | null;
  readonly projectAlias: string | null;
  readonly footerAddress: string | null;
  readonly scopedHref: string;
  readonly allHref: string;
}): { readonly html: string; readonly text: string } {
  const scopedLabel =
    input.kind === "newsletter"
      ? "Unsubscribe from the AS newsletter"
      : `Unsubscribe from ${input.projectAlias ?? input.projectName ?? "this project"} emails`;
  const allLabel = "Unsubscribe from all Adventure Scientists emails";

  const linkLabels =
    input.kind === "newsletter" ? [scopedLabel] : [scopedLabel, allLabel];
  const textLinks =
    input.kind === "newsletter"
      ? `${scopedLabel}: ${input.scopedHref}`
      : `${scopedLabel}: ${input.scopedHref}\n${allLabel}: ${input.allHref}`;
  const htmlLinks =
    input.kind === "newsletter"
      ? `<a href="${escapeHtml(input.scopedHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(scopedLabel)}</a>`
      : [
          `<a href="${escapeHtml(input.scopedHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(scopedLabel)}</a>`,
          `<a href="${escapeHtml(input.allHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(allLabel)}</a>`,
        ].join(" &middot; ");

  return {
    html: [
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">',
      `<div style="color:#64748b;font-size:12px;line-height:1.6;">${htmlLinks}</div>`,
      input.footerAddress === null
        ? ""
        : `<div style="color:#64748b;font-size:12px;line-height:1.6;margin-top:8px;">${escapeHtml(input.footerAddress)}</div>`,
    ].join(""),
    text: [linkLabels.join(" · "), textLinks, input.footerAddress]
      .filter((part): part is string => part !== null && part.length > 0)
      .join("\n"),
  };
}

function normalizeReason(reason: string): string | null {
  const trimmed = reason.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toMergeContext(member: AudienceMember): MergeContext {
  return {
    firstName: member.frozenFirstName,
    projectName: member.frozenProjectName,
    aliasEmail: member.frozenAliasEmail,
  };
}

function toAudienceMember(snapshot: AudienceSnapshotRecord): AudienceMember {
  return {
    contactId: snapshot.contactId,
    frozenEmail: snapshot.frozenEmail,
    frozenFirstName: snapshot.frozenFirstName,
    frozenProjectName: snapshot.frozenProjectName,
    frozenProjectId: snapshot.frozenProjectId,
    frozenAliasEmail: snapshot.frozenAliasEmail,
  };
}

async function resolveSenderFields(
  repositories: CampaignSendRepositories,
  run: CampaignRunRecord,
): Promise<Pick<CampaignRunRecord, "fromEmail" | "fromName" | "replyToEmail">> {
  if (run.projectId === null) {
    return {
      fromEmail: run.fromEmail,
      fromName: run.fromName ?? "Adventure Scientists",
      replyToEmail: run.replyToEmail ?? run.fromEmail,
    };
  }

  const project = await repositories.settingsProjects.findById(run.projectId);
  const primary =
    project?.emails.find((email) => email.isPrimary) ?? project?.emails[0];
  const primaryAddress = primary?.address.trim().toLowerCase() ?? null;

  return {
    fromEmail: primaryAddress ?? run.fromEmail,
    fromName: run.fromName ?? "Adventure Scientists",
    replyToEmail: primaryAddress ?? run.replyToEmail,
  };
}

function buildFreezeSnapshot(member: AudienceMember): NewAudienceSnapshot {
  return {
    id: randomUUID(),
    contactId: member.contactId,
    frozenEmail: member.frozenEmail,
    frozenFirstName: member.frozenFirstName,
    frozenProjectName: member.frozenProjectName,
    frozenProjectId: member.frozenProjectId,
    frozenAliasEmail: member.frozenAliasEmail,
    unsubscribeToken: randomUUID(),
    deliveryStatus: "pending",
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

function filterAudienceMembersBySelectedContacts(
  rows: readonly AudienceMember[],
  run: CampaignRunRecord,
): readonly AudienceMember[] {
  if (run.audienceCriteria.contactIds.length === 0) {
    return rows;
  }

  const selectedContactIds = new Set(run.audienceCriteria.contactIds);
  return rows.filter((row) => selectedContactIds.has(row.contactId));
}

async function appendCampaignAudit(
  repositories: CampaignSendRepositories,
  input: {
    readonly runId: string;
    readonly action: string;
    readonly occurredAt: string;
    readonly detail: string;
    readonly metadataJson?: Record<string, unknown>;
  },
): Promise<void> {
  if (repositories.auditEvidence === undefined) {
    return;
  }

  await repositories.auditEvidence.append({
    id: randomUUID(),
    actorType: "system",
    actorId: "campaign-send",
    action: input.action,
    entityType: "campaign_run",
    entityId: input.runId,
    occurredAt: input.occurredAt,
    result: "recorded",
    policyCode: `stage5a.${input.action}`,
    metadataJson: {
      detail: input.detail,
      ...(input.metadataJson ?? {}),
    },
  });
}

async function readFrozenResult(
  repositories: CampaignSendRepositories,
  runId: string,
  audienceSize: number | null,
): Promise<{ audienceSize: number; excludedCount: number }> {
  const snapshots = await repositories.audienceSnapshots.listForRun(runId);
  return {
    audienceSize: audienceSize ?? snapshots.length,
    excludedCount: 0,
  };
}

export function createCampaignSendOrchestrator(deps: {
  repositories: CampaignSendRepositories;
  audienceResolver: AudienceResolver;
  exclusionFilter: ExclusionFilter;
  mergeRenderer: MergeRenderer;
  postmarkClient: PostmarkClientLike;
  appUrl: string;
  batchSize?: number;
  logger?: Pick<Console, "error" | "info" | "warn">;
  now?: () => Date;
}): CampaignSendOrchestrator {
  const batchSize = deps.batchSize ?? 500;
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());
  const appUrl = deps.appUrl.trim();
  if (appUrl.length === 0) {
    throw new Error(
      "createCampaignSendOrchestrator requires a non-empty appUrl for unsubscribe links.",
    );
  }

  return {
    async freeze(runId, at) {
      const run = await deps.repositories.campaignRuns.findById(runId);
      if (run === null) {
        throw new Error(`Campaign run ${runId} was not found.`);
      }

      if (run.state === "sending") {
        return readFrozenResult(deps.repositories, runId, run.audienceSize);
      }
      if (run.state === "scheduled") {
        const snapshots = await deps.repositories.audienceSnapshots.listForRun(runId);
        if (snapshots.length > 0) {
          return {
            audienceSize: run.audienceSize ?? snapshots.length,
            excludedCount: 0,
          };
        }
      }
      if (run.state !== "draft" && run.state !== "scheduled") {
        throw new Error(`Campaign run ${runId} cannot be frozen from ${run.state}.`);
      }

      const members = filterAudienceMembersBySelectedContacts(
        await deps.audienceResolver.resolveAudience(run.audienceCriteria, at),
        run,
      );
      const exclusions = await deps.exclusionFilter.applyExclusions(
        members,
        runId,
        at,
      );

      await deps.repositories.audienceSnapshots.bulkInsert(
        runId,
        exclusions.eligible.map(buildFreezeSnapshot),
      );

      const senderFields = await resolveSenderFields(deps.repositories, run);

      if (run.state === "draft") {
        await deps.repositories.campaignRuns.transitionState(runId, "draft", "scheduled", {
          audienceSize: exclusions.eligible.length,
          scheduledAt: run.scheduledAt ?? at.toISOString(),
          ...senderFields,
        });
      } else {
        await deps.repositories.campaignRuns.update(runId, {
          audienceSize: exclusions.eligible.length,
          ...senderFields,
        });
      }

      return {
        audienceSize: exclusions.eligible.length,
        excludedCount: exclusions.excluded.length,
      };
    },

    async processSendRequest(runId) {
      let run = await deps.repositories.campaignRuns.findById(runId);
      if (run === null) {
        throw new Error(`Campaign run ${runId} was not found.`);
      }
      if (run.state === "cancelled" || run.state === "complete") {
        return;
      }

      const startedAt = now();
      const existingSnapshots = await deps.repositories.audienceSnapshots.listForRun(runId);
      if (
        existingSnapshots.length === 0 &&
        (run.state === "draft" || run.state === "scheduled")
      ) {
        await this.freeze(runId, startedAt);
        run = await deps.repositories.campaignRuns.findById(runId);
        if (run === null) {
          throw new Error(`Campaign run ${runId} disappeared after freeze.`);
        }
      }

      if (run.state === "scheduled") {
        run = await deps.repositories.campaignRuns.transitionState(
          runId,
          "scheduled",
          "sending",
          {
            startedAt: run.startedAt ?? startedAt.toISOString(),
          },
        );
        await appendCampaignAudit(deps.repositories, {
          runId,
          action: "campaign_run.send_started",
          occurredAt: run.startedAt ?? startedAt.toISOString(),
          detail: "Worker entered the sending state.",
        });
      }

      if (run.state === "draft") {
        throw new Error(`Campaign run ${runId} must be frozen before sending.`);
      }

      const orgSettings = await deps.repositories.orgSettings.read();
      const footerAddress = formatOrgAddress(orgSettings);
      const projectAlias =
        run.projectId === null
          ? null
          : (await deps.repositories.settingsProjects.findById(run.projectId))
              ?.projectAlias ?? null;

      const snapshots = (await deps.repositories.audienceSnapshots.listForRun(runId)).filter(
        (snapshot) => snapshot.deliveryStatus === "pending",
      );

      for (let index = 0; index < snapshots.length; index += batchSize) {
        const stateCheck = await deps.repositories.campaignRuns.findById(runId);
        if (stateCheck?.state === "cancelled") {
          return;
        }

        const batch = snapshots.slice(index, index + batchSize);
        const messages: {
          readonly snapshot: AudienceSnapshotRecord;
          readonly payload: {
            readonly From: string;
            readonly To: string;
            readonly ReplyTo?: string;
            readonly Subject: string;
            readonly HtmlBody: string;
            readonly TextBody: string;
            readonly MessageStream: "broadcast";
            readonly Metadata: Record<string, string>;
            readonly Headers: readonly {
              readonly Name: string;
              readonly Value: string;
            }[];
          };
        }[] = [];

        for (const snapshot of batch) {
          const member = toAudienceMember(snapshot);
          const finalCheck = await deps.exclusionFilter.applyExclusions(
            [member],
            runId,
            now(),
          );

          if (finalCheck.excluded.length > 0) {
            await deps.repositories.audienceSnapshots.update(snapshot.id, {
              deliveryStatus: "suppressed_at_send",
            });
            continue;
          }

          const sender = run.fromEmail ?? snapshot.frozenAliasEmail;
          if (sender === null) {
            await deps.repositories.audienceSnapshots.update(snapshot.id, {
              deliveryStatus: "failed",
            });
            logger.error(
              `Campaign run ${runId} snapshot ${snapshot.id} has no sender alias.`,
            );
            continue;
          }

          const unsubscribeUrls = buildBroadcastUnsubscribeUrls({
            appUrl,
            unsubscribeToken: snapshot.unsubscribeToken,
          });
          const footer = buildUnsubscribeFooter({
            kind: run.kind,
            projectName: snapshot.frozenProjectName,
            projectAlias,
            footerAddress,
            scopedHref: unsubscribeUrls.scopedHref,
            allHref: unsubscribeUrls.allHref,
          });
          const preheaderHtml = buildBroadcastPreheaderHtml(run.preheader);
          const fromHeader = formatBroadcastFromHeader(sender, projectAlias);

          const rendered = deps.mergeRenderer.render(
            {
              subject: run.subjectTemplate ?? "",
              bodyHtml: `${preheaderHtml}${run.bodyHtmlTemplate ?? ""}${footer.html}`,
              bodyText: [run.bodyTextTemplate ?? "", footer.text]
                .filter((part) => part.length > 0)
                .join("\n\n"),
            },
            toMergeContext(member),
          );

          messages.push({
            snapshot,
            payload: {
              From: fromHeader,
              To: snapshot.frozenEmail,
              ...(run.replyToEmail === null ? {} : { ReplyTo: run.replyToEmail }),
              Subject: rendered.subject,
              HtmlBody: rendered.html,
              TextBody: rendered.text,
              MessageStream: "broadcast",
              Metadata: {
                campaignRunId: runId,
                audienceSnapshotId: snapshot.id,
                contactId: snapshot.contactId,
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
          });
        }

        if (messages.length === 0) {
          continue;
        }

        let response: { readonly results: readonly PostmarkBatchSendResult[] };
        try {
          response = await deps.postmarkClient.sendBatch({
            messages: messages.map((message) => message.payload),
          });
        } catch (error) {
          logger.error(
            `Campaign batch send failed for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }

        for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
          const message = messages[messageIndex];
          const result = response.results[messageIndex];
          if (message === undefined || result === undefined) {
            continue;
          }

          if (result.ErrorCode === 0) {
            await deps.repositories.audienceSnapshots.update(message.snapshot.id, {
              providerMessageId: result.MessageID,
              deliveryStatus: "sent",
              sentAt: result.SubmittedAt,
              lastEventAt: result.SubmittedAt,
            });
            continue;
          }

          await deps.repositories.audienceSnapshots.update(message.snapshot.id, {
            providerMessageId: result.MessageID,
            deliveryStatus: "failed",
          });
          logger.warn(
            `Campaign run ${runId} recipient ${message.snapshot.contactId} failed with Postmark error ${String(result.ErrorCode)}: ${result.Message}`,
          );
        }
        await appendCampaignAudit(deps.repositories, {
          runId,
          action: "campaign_run.batch_sent",
          occurredAt: now().toISOString(),
          detail: `${String(messages.length)} recipients submitted to Postmark.`,
          metadataJson: {
            batchSize: messages.length,
          },
        });
      }

      const latestRun = await deps.repositories.campaignRuns.findById(runId);
      if (latestRun?.state === "cancelled") {
        return;
      }

      const remaining = (await deps.repositories.audienceSnapshots.listForRun(runId)).filter(
        (snapshot) => snapshot.deliveryStatus === "pending",
      );
      if (remaining.length > 0) {
        return;
      }

      await deps.repositories.campaignRuns.transitionState(
        runId,
        "sending",
        "complete",
        {
          completedAt: now().toISOString(),
        },
      );
      await appendCampaignAudit(deps.repositories, {
        runId,
        action: "campaign_run.completed",
        occurredAt: now().toISOString(),
        detail: "All queued recipients reached a terminal state.",
      });
    },

    async cancel(runId, reason) {
      const run = await deps.repositories.campaignRuns.findById(runId);
      if (run === null) {
        throw new Error(`Campaign run ${runId} was not found.`);
      }
      if (run.state === "cancelled") {
        return;
      }
      if (run.state === "complete" || run.state === "finalized") {
        throw new Error(`Campaign run ${runId} can no longer be cancelled.`);
      }

      await deps.repositories.campaignRuns.transitionState(
        runId,
        run.state,
        "cancelled",
        {
          cancelledAt: now().toISOString(),
          cancelledReason: normalizeReason(reason),
        },
      );
    },
  };
}
