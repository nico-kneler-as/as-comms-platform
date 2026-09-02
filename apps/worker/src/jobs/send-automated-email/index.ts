import { createHash } from "node:crypto";

import type { Task } from "graphile-worker";

import {
  AUTOMATED_EMAIL_MERGE_FIELDS,
  renderAutomatedEmail,
  type AutomatedEmailMergeFieldKey,
  collectAutomatedEmailMergeKeys,
  resolveAutomatedEmailMergeFields,
  type AutomatedEmailSalesforceClient,
  type Stage1PersistenceService,
} from "@as-comms/domain";
import {
  automatedEmailDedupeWindowMs,
  automatedEmailSendPayloadSchema,
  type AutomatedEmailSendRecord,
  type AutomatedEmailTemplateRecord,
  type ContactRecord,
} from "@as-comms/contracts";
import {
  findRecentSendForDedupe,
  getSendLogRow,
  getTemplateById,
  updateSendStatus,
  type AutomatedEmailSendsDatabase,
} from "@as-comms/db";
import type { PostmarkClient } from "@as-comms/integrations";

import type { OpsAlertSender } from "../../ops-alert/sender.js";

export {
  automatedEmailSendJobMaxAttempts,
  automatedEmailSendJobName,
  automatedEmailSendPayloadSchema,
} from "@as-comms/contracts";
export type { AutomatedEmailSendPayload } from "@as-comms/contracts";

export interface AutomatedEmailSendTaskDependencies {
  readonly db: AutomatedEmailSendsDatabase;
  readonly persistence: Pick<
    Stage1PersistenceService,
    "persistCanonicalEvent" | "recordSourceEvidence"
  >;
  readonly sends: {
    getById(id: string): Promise<AutomatedEmailSendRecord | null>;
    findRecentForDedupe(input: {
      readonly templateId: string;
      readonly expeditionMemberId: string;
      readonly since: Date;
    }): Promise<AutomatedEmailSendRecord | null>;
    updateStatus(
      id: string,
      input: Parameters<typeof updateSendStatus>[2],
    ): Promise<AutomatedEmailSendRecord>;
  };
  readonly templates: {
    getById(id: string): Promise<AutomatedEmailTemplateRecord | null>;
  };
  readonly contacts: {
    findById(id: string): Promise<ContactRecord | null>;
  };
  readonly projects: {
    findById(projectId: string): Promise<{
      readonly projectName: string;
      readonly emails: readonly {
        readonly address: string;
        readonly isPrimary: boolean;
      }[];
    } | null>;
  };
  readonly salesforceClient: AutomatedEmailSalesforceClient | null;
  readonly postmarkClient: Pick<PostmarkClient, "sendBatch"> | null;
  readonly opsAlert: Pick<OpsAlertSender, "send">;
  readonly now?: () => Date;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isTerminal(send: AutomatedEmailSendRecord): boolean {
  return (
    send.status === "sent" ||
    send.status === "duplicate" ||
    send.status === "held" ||
    send.status === "failed"
  );
}

function toReason(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return fallback;
  }

  const code = error.code;
  return typeof code === "string" && code.length > 0
    ? `${fallback}:${code}`
    : fallback;
}

function isTransientProviderError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "retryable" in error) {
    return error.retryable === true;
  }

  if (error instanceof Error) {
    return (
      error.name === "TimeoutError" ||
      /(?:network|fetch failed|timed out|status 5\d\d)/iu.test(error.message)
    );
  }

  return false;
}

function toProjectSender(
  project: Awaited<
    ReturnType<AutomatedEmailSendTaskDependencies["projects"]["findById"]>
  >,
): string | null {
  const primary =
    project?.emails.find((email) => email.isPrimary) ?? project?.emails[0];
  const address = primary?.address.trim().toLowerCase() ?? "";
  return address.length > 0 ? address : null;
}

async function alertTerminalOutcome(
  deps: AutomatedEmailSendTaskDependencies,
  send: AutomatedEmailSendRecord,
  reason: string,
  status: "held" | "failed",
  occurredAt: string,
): Promise<void> {
  try {
    await deps.opsAlert.send({
      category: "automated_email",
      dedupKey: `${send.id}:${reason}`,
      severity: status === "failed" ? "s1" : "s2",
      summary: `Automated email ${status}: ${reason}`,
      categoryLabel: "Automated email",
      detail: [
        { label: "Send ID", value: send.id },
        { label: "Template ID", value: send.templateId },
        { label: "Reason", value: reason },
      ],
      links: [],
      firstObservedAt: occurredAt,
      occurredAt,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "automated_email.ops_alert_failed",
        sendId: send.id,
        reason,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function finishTerminal(
  deps: AutomatedEmailSendTaskDependencies,
  send: AutomatedEmailSendRecord,
  input: Parameters<
    AutomatedEmailSendTaskDependencies["sends"]["updateStatus"]
  >[1],
  options: Readonly<{ alert: boolean; at: Date }>,
): Promise<void> {
  const updated = await deps.sends.updateStatus(send.id, input);
  if (
    options.alert &&
    (updated.status === "held" || updated.status === "failed")
  ) {
    await alertTerminalOutcome(
      deps,
      updated,
      updated.statusReason ?? updated.status,
      updated.status,
      options.at.toISOString(),
    );
  }
}

function buildLedgerRecords(input: {
  readonly send: AutomatedEmailSendRecord;
  readonly contactId: string;
  readonly providerMessageId: string;
  readonly occurredAt: string;
  readonly subject: string;
  readonly now: string;
}) {
  const sourceEvidenceId = `source:automated-email:${input.send.id}`;
  const eventId = `canonical:automated-email:${input.send.id}`;
  const metadata = JSON.stringify({
    templateId: input.send.templateId,
    sendId: input.send.id,
    expeditionMemberId: input.send.expeditionMemberId,
    subject: input.subject,
  });

  return {
    sourceEvidence: {
      id: sourceEvidenceId,
      provider: "postmark" as const,
      providerRecordType: "automated_email_send",
      providerRecordId: input.providerMessageId,
      receivedAt: input.now,
      occurredAt: input.occurredAt,
      payloadRef: `automated-email://sends/${input.send.id}`,
      idempotencyKey: `automated-email:source:${input.send.id}`,
      checksum: sha256(
        [input.send.id, input.providerMessageId, input.subject].join(":"),
      ),
    },
    event: {
      id: eventId,
      contactId: input.contactId,
      eventType: "automated.email.sent" as const,
      channel: "campaign_email" as const,
      occurredAt: input.occurredAt,
      contentFingerprint: null,
      sourceEvidenceId,
      idempotencyKey: `automated-email:event:${input.send.id}`,
      provenance: {
        primaryProvider: "postmark" as const,
        primarySourceEvidenceId: sourceEvidenceId,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source" as const,
        sourceRecordType: "automated_email_send",
        sourceRecordId: input.providerMessageId,
        messageKind: "campaign" as const,
        campaignRef: {
          providerCampaignId: input.send.templateId,
          providerAudienceId: input.send.id,
          providerMessageName: input.subject,
        },
        threadRef: null,
        direction: "outbound" as const,
        notes: metadata,
      },
      reviewState: "clear" as const,
    },
  };
}

export function createAutomatedEmailSendTask(
  deps: AutomatedEmailSendTaskDependencies,
): Task {
  const now = deps.now ?? (() => new Date());

  return async (payload) => {
    const { sendId } = automatedEmailSendPayloadSchema.parse(payload);
    const send = await deps.sends.getById(sendId);
    if (send === null || isTerminal(send) || send.providerMessageId !== null) {
      return;
    }

    const template = await deps.templates.getById(send.templateId);
    const currentTime = now();
    if (template === null) {
      await finishTerminal(
        deps,
        send,
        { status: "failed", statusReason: "template_not_found" },
        { alert: true, at: currentTime },
      );
      return;
    }

    const duplicate = await deps.sends.findRecentForDedupe({
      templateId: send.templateId,
      expeditionMemberId: send.expeditionMemberId,
      since: new Date(currentTime.getTime() - automatedEmailDedupeWindowMs),
    });
    if (duplicate !== null) {
      await finishTerminal(
        deps,
        send,
        { status: "duplicate", statusReason: "duplicate_recent_send" },
        { alert: false, at: currentTime },
      );
      return;
    }

    if (deps.salesforceClient === null) {
      await finishTerminal(
        deps,
        send,
        { status: "failed", statusReason: "salesforce_not_configured" },
        { alert: true, at: currentTime },
      );
      return;
    }

    let resolution;
    try {
      // Resolve ONLY the fields this template references (plus the recipient
      // email). Requesting the whole catalog would hold every send on required
      // fields the copy never uses.
      const referencedKeys = collectAutomatedEmailMergeKeys(
        template.publishedSubject ?? template.draftSubject,
        template.publishedDoc ?? template.draftDoc,
      );
      const catalogKeys = new Set<string>(
        AUTOMATED_EMAIL_MERGE_FIELDS.map((field) => field.key),
      );
      const isCatalogKey = (key: string): key is AutomatedEmailMergeFieldKey =>
        catalogKeys.has(key);
      const keysToResolve = [
        "email",
        ...referencedKeys.filter((key) => key !== "email"),
      ].filter(isCatalogKey);
      resolution = await resolveAutomatedEmailMergeFields(
        deps.salesforceClient,
        send.expeditionMemberId,
        keysToResolve,
      );
    } catch (error) {
      if (isTransientProviderError(error)) {
        throw error;
      }

      await finishTerminal(
        deps,
        send,
        { status: "failed", statusReason: "salesforce_resolve_failed" },
        { alert: true, at: currentTime },
      );
      return;
    }

    if (
      resolution.outcome === "invalid_id" ||
      resolution.outcome === "not_found"
    ) {
      await finishTerminal(
        deps,
        send,
        { status: "failed", statusReason: resolution.outcome },
        { alert: true, at: currentTime },
      );
      return;
    }

    if (resolution.missingRequired.length > 0) {
      await finishTerminal(
        deps,
        send,
        {
          status: "held",
          statusReason: `missing_required:${resolution.missingRequired.join(",")}`,
        },
        { alert: true, at: currentTime },
      );
      return;
    }

    if (template.publishedSubject === null || template.publishedDoc === null) {
      await finishTerminal(
        deps,
        send,
        { status: "held", statusReason: "no_published_copy" },
        { alert: true, at: currentTime },
      );
      return;
    }

    const project = await deps.projects.findById(template.projectId);
    if (project === null) {
      await finishTerminal(
        deps,
        send,
        { status: "failed", statusReason: "project_not_found" },
        { alert: true, at: currentTime },
      );
      return;
    }

    let rendered;
    try {
      rendered = renderAutomatedEmail({
        subjectTemplate: template.publishedSubject,
        bodyDoc: template.publishedDoc,
        values: resolution.values as Record<string, string>,
        frame: {
          projectName: project.projectName,
          reasonLine: `You're receiving this because you applied to ${project.projectName}.`,
        },
      });
    } catch (error) {
      await finishTerminal(
        deps,
        send,
        { status: "failed", statusReason: toReason(error, "render_failed") },
        { alert: true, at: currentTime },
      );
      return;
    }

    const renderedPreview = {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };

    if (!template.isActive) {
      await finishTerminal(
        deps,
        send,
        {
          status: "held",
          statusReason: "inactive_dry_run",
          renderedPreview,
        },
        { alert: false, at: currentTime },
      );
      return;
    }

    const sender = toProjectSender(project);
    if (sender === null) {
      await finishTerminal(
        deps,
        send,
        {
          status: "failed",
          statusReason: "no_project_sender",
          renderedPreview,
        },
        { alert: true, at: currentTime },
      );
      return;
    }

    if (deps.postmarkClient === null) {
      await finishTerminal(
        deps,
        send,
        {
          status: "failed",
          statusReason: "postmark_not_configured",
          renderedPreview,
        },
        { alert: true, at: currentTime },
      );
      return;
    }

    let providerResult;
    try {
      const response = await deps.postmarkClient.sendBatch({
        messages: [
          {
            From: `Adventure Scientists <${sender}>`,
            To: resolution.recipientEmail ?? "",
            ReplyTo: sender,
            Subject: rendered.subject,
            HtmlBody: rendered.html,
            TextBody: rendered.text,
            Metadata: {
              templateId: template.id,
              sendId: send.id,
              expeditionMemberId: send.expeditionMemberId,
            },
          },
        ],
      });
      providerResult = response.results[0];
    } catch (error) {
      if (isTransientProviderError(error)) {
        throw error;
      }

      await finishTerminal(
        deps,
        send,
        {
          status: "failed",
          statusReason: "postmark_send_failed",
          renderedPreview,
        },
        { alert: true, at: currentTime },
      );
      return;
    }

    if (providerResult?.ErrorCode !== 0) {
      await finishTerminal(
        deps,
        send,
        {
          status: "failed",
          statusReason: "postmark_rejected",
          renderedPreview,
          ...(providerResult === undefined
            ? {}
            : { providerMessageId: providerResult.MessageID }),
        },
        { alert: true, at: currentTime },
      );
      return;
    }

    const submittedAt = Number.isNaN(Date.parse(providerResult.SubmittedAt))
      ? currentTime.toISOString()
      : new Date(providerResult.SubmittedAt).toISOString();
    const localContact =
      resolution.contactId === null
        ? null
        : await deps.contacts.findById(resolution.contactId);
    let ledgerEventId: string | null = null;

    if (localContact !== null) {
      try {
        const ledger = buildLedgerRecords({
          send,
          contactId: localContact.id,
          providerMessageId: providerResult.MessageID,
          occurredAt: submittedAt,
          subject: rendered.subject,
          now: currentTime.toISOString(),
        });
        const sourceEvidence = await deps.persistence.recordSourceEvidence(
          ledger.sourceEvidence,
        );
        if (sourceEvidence.outcome === "conflict") {
          throw new Error("automated_email_source_evidence_conflict");
        }
        const event = await deps.persistence.persistCanonicalEvent(
          ledger.event,
        );
        if (event.outcome === "conflict") {
          throw new Error("automated_email_ledger_conflict");
        }
        ledgerEventId = event.record.id;
      } catch {
        await finishTerminal(
          deps,
          send,
          {
            status: "failed",
            statusReason: "ledger_persist_failed",
            contactId: localContact.id,
            providerMessageId: providerResult.MessageID,
            renderedPreview,
          },
          { alert: true, at: currentTime },
        );
        return;
      }
    }

    await finishTerminal(
      deps,
      send,
      {
        status: "sent",
        statusReason: null,
        contactId: localContact?.id ?? null,
        providerMessageId: providerResult.MessageID,
        ledgerEventId,
        renderedPreview,
      },
      { alert: false, at: currentTime },
    );
  };
}

export function createAutomatedEmailSendTaskDependencies(input: {
  readonly db: AutomatedEmailSendsDatabase;
  readonly persistence: Stage1PersistenceService;
  readonly contacts: AutomatedEmailSendTaskDependencies["contacts"];
  readonly projects: AutomatedEmailSendTaskDependencies["projects"];
  readonly salesforceClient: AutomatedEmailSalesforceClient | null;
  readonly postmarkClient: Pick<PostmarkClient, "sendBatch"> | null;
  readonly opsAlert: Pick<OpsAlertSender, "send">;
  readonly now?: () => Date;
}): AutomatedEmailSendTaskDependencies {
  return {
    db: input.db,
    persistence: input.persistence,
    sends: {
      getById: (id) => getSendLogRow(input.db, id),
      findRecentForDedupe: (dedupeInput) =>
        findRecentSendForDedupe(input.db, dedupeInput),
      updateStatus: (id, statusInput) =>
        updateSendStatus(input.db, id, statusInput),
    },
    templates: {
      getById: (id) => getTemplateById(input.db, id),
    },
    contacts: input.contacts,
    projects: input.projects,
    salesforceClient: input.salesforceClient,
    postmarkClient: input.postmarkClient,
    opsAlert: input.opsAlert,
    ...(input.now === undefined ? {} : { now: input.now }),
  };
}
