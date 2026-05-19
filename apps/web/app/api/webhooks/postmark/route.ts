import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  createStage1PersistenceService,
  type CanonicalEventRecord,
  type IdentityResolutionCase,
} from "@as-comms/domain";
import {
  canonicalEventTypeSchema,
  type DeliveryStatus,
  type SuppressionReason,
} from "@as-comms/contracts";
import {
  createPostmarkClient,
  postmarkWebhookEventSchema,
  type PostmarkWebhookEvent,
} from "@as-comms/integrations";

import { readWebEnv } from "@/src/server/env";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function recipientLogId(recipient: string): string {
  return sha256(recipient.trim().toLowerCase()).slice(0, 16);
}

function toOccurredAt(event: PostmarkWebhookEvent): string {
  switch (event.RecordType) {
    case "Delivery":
      return event.DeliveredAt;
    case "Bounce":
      return event.BouncedAt;
    case "SpamComplaint":
      return event.BouncedAt;
    case "Open":
      return event.ReceivedAt;
    case "Click":
      return event.ReceivedAt;
    case "SubscriptionChange":
      return event.ChangedAt;
  }
}

function toCanonicalEventType(
  event: PostmarkWebhookEvent,
): CanonicalEventRecord["eventType"] {
  switch (event.RecordType) {
    case "Delivery":
      return canonicalEventTypeSchema.parse("campaign.email.delivered");
    case "Bounce":
      return canonicalEventTypeSchema.parse("campaign.email.bounced");
    case "SpamComplaint":
      return canonicalEventTypeSchema.parse("campaign.email.complained");
    case "Open":
      return canonicalEventTypeSchema.parse("campaign.email.opened");
    case "Click":
      return canonicalEventTypeSchema.parse("campaign.email.clicked");
    case "SubscriptionChange":
      return canonicalEventTypeSchema.parse("campaign.email.unsubscribed");
  }
}

function toAudienceEventStatus(event: PostmarkWebhookEvent): DeliveryStatus {
  switch (event.RecordType) {
    case "Delivery":
      return "delivered";
    case "Bounce":
      return "bounced";
    case "SpamComplaint":
      return "complained";
    case "Open":
      return "delivered";
    case "Click":
      return "delivered";
    case "SubscriptionChange":
      return "unsubscribed";
  }
}

function toBounceReason(event: PostmarkWebhookEvent): SuppressionReason | null {
  if (event.RecordType === "SpamComplaint") {
    return "complaint";
  }

  if (event.RecordType !== "Bounce") {
    return null;
  }

  return /softbounce/iu.test(event.Type)
    ? "soft_bounce_strike3"
    : "hard_bounce";
}

function buildProviderRecordType(event: PostmarkWebhookEvent): string {
  return `postmark_webhook_${event.RecordType.toLowerCase()}`;
}

function buildProviderRecordId(event: PostmarkWebhookEvent): string {
  const occurredAt = toOccurredAt(event);
  return (
    event.MessageID ?? `${event.Recipient}:${event.RecordType}:${occurredAt}`
  );
}

function buildIdempotencyKey(event: PostmarkWebhookEvent): string {
  return [
    "postmark",
    event.MessageID ?? event.Recipient,
    event.RecordType,
    toOccurredAt(event),
  ].join(":");
}

function buildPayloadRef(event: PostmarkWebhookEvent): string {
  return `postmark://webhooks/${event.RecordType}/${encodeURIComponent(buildProviderRecordId(event))}`;
}

function buildCanonicalEvent(input: {
  readonly event: PostmarkWebhookEvent;
  readonly sourceEvidenceId: string;
  readonly contactId: string;
}): CanonicalEventRecord {
  const eventType = toCanonicalEventType(input.event);
  const occurredAt = toOccurredAt(input.event);

  return {
    id: randomUUID(),
    contactId: input.contactId,
    eventType,
    channel: "campaign_email",
    occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: buildIdempotencyKey(input.event),
    provenance: {
      primaryProvider: "postmark",
      primarySourceEvidenceId: input.sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: buildProviderRecordType(input.event),
      sourceRecordId: buildProviderRecordId(input.event),
      messageKind: "campaign",
      campaignRef: {
        providerCampaignId: null,
        providerAudienceId: null,
        providerMessageName: input.event.Tag ?? null,
      },
      threadRef: null,
      direction: "outbound",
      notes: input.event.RecordType,
    },
    reviewState: "clear",
  };
}

function isRecipientUnsubscribe(event: PostmarkWebhookEvent): boolean {
  return (
    event.RecordType === "SubscriptionChange" &&
    event.SuppressSending &&
    (event.Origin?.toLowerCase() === "recipient" ||
      event.SuppressionReason === "ManualSuppression")
  );
}

async function writeSpamComplaintReview(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly sourceEvidenceId: string;
  readonly contactId: string;
  readonly recipient: string;
}): Promise<void> {
  const caseRecord: IdentityResolutionCase = {
    id: `postmark-spam-complaint:${input.sourceEvidenceId}`,
    sourceEvidenceId: input.sourceEvidenceId,
    candidateContactIds: [input.contactId],
    reasonCode: "identity_anchor_mismatch",
    status: "open",
    openedAt: new Date().toISOString(),
    resolvedAt: null,
    lastAttemptedAt: null,
    normalizedIdentityValues: [input.recipient.toLowerCase()],
    anchoredContactId: input.contactId,
    explanation:
      "Postmark spam complaint received for a campaign recipient. Review before any future outreach.",
  };

  await input.runtime.repositories.identityResolutionQueue.upsert(caseRecord);
}

function safeError(code: string, message: string, status: number) {
  return NextResponse.json(
    {
      ok: false,
      code,
      message,
      requestId: randomUUID(),
    },
    {
      status,
    },
  );
}

function ok() {
  return NextResponse.json({ ok: true });
}

function isUnknownRecordType(payload: unknown): boolean {
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("RecordType" in payload)
  ) {
    return false;
  }

  const recordType = (payload as { readonly RecordType?: unknown }).RecordType;
  return (
    typeof recordType === "string" &&
    ![
      "Delivery",
      "Bounce",
      "SpamComplaint",
      "Open",
      "Click",
      "SubscriptionChange",
    ].includes(recordType)
  );
}

async function processEvent(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
  rawBody: string,
  event: PostmarkWebhookEvent,
): Promise<void> {
  const persistence = createStage1PersistenceService(runtime.repositories);
  const occurredAt = toOccurredAt(event);
  const sourceEvidence = await persistence.recordSourceEvidence({
    id: randomUUID(),
    provider: "postmark",
    providerRecordType: buildProviderRecordType(event),
    providerRecordId: buildProviderRecordId(event),
    receivedAt: new Date().toISOString(),
    occurredAt,
    payloadRef: buildPayloadRef(event),
    idempotencyKey: buildIdempotencyKey(event),
    checksum: sha256(rawBody),
  });
  if (sourceEvidence.outcome === "conflict") {
    // Should not happen in practice — webhook events are uniquely keyed by
    // RecordType + MessageID + DeliveredAt. If we ever see a conflict, log
    // and bail rather than silently routing the event.
    console.error(
      JSON.stringify({
        event: "postmark.webhook.source_evidence_conflict",
        recordType: event.RecordType,
        messageId: event.MessageID,
      }),
    );
    return;
  }
  const sourceEvidenceId = sourceEvidence.record.id;
  void sourceEvidenceId;
  const snapshot =
    event.MessageID === null
      ? null
      : await runtime.campaigns.audienceSnapshots.findByProviderMessageId(
          event.MessageID,
        );

  if (
    event.RecordType === "SubscriptionChange" &&
    !isRecipientUnsubscribe(event)
  ) {
    return;
  }

  if (snapshot === null) {
    console.warn(
      JSON.stringify({
        event: "postmark.webhook.snapshot_not_found",
        recordType: event.RecordType,
        messageId: event.MessageID,
        recipientHash: recipientLogId(event.Recipient),
      }),
    );
    return;
  }
  const run = await runtime.campaigns.campaignRuns.findById(
    snapshot.campaignRunId,
  );
  const shouldUpdateAggregateMetrics =
    run?.state !== "finalized" ||
    run.finalizedAt === null ||
    new Date(occurredAt).getTime() <= new Date(run.finalizedAt).getTime();

  const activity: "open" | "click" | undefined =
    event.RecordType === "Open"
      ? "open"
      : event.RecordType === "Click"
        ? "click"
        : undefined;
  if (shouldUpdateAggregateMetrics) {
    await runtime.campaigns.audienceSnapshots.updateDeliveryEvent(
      snapshot.id,
      activity === undefined
        ? {
            status: toAudienceEventStatus(event),
            at: new Date(occurredAt),
            providerEventId: buildProviderRecordId(event),
          }
        : {
            status: toAudienceEventStatus(event),
            at: new Date(occurredAt),
            activity,
            providerEventId: buildProviderRecordId(event),
          },
    );
  }

  const bounceReason = toBounceReason(event);
  if (bounceReason !== null) {
    await runtime.campaigns.suppressionList.upsertFromBounce(
      event.Recipient,
      bounceReason,
      buildProviderRecordId(event),
      new Date(occurredAt),
    );
  }

  if (event.RecordType === "SpamComplaint") {
    await writeSpamComplaintReview({
      runtime,
      sourceEvidenceId,
      contactId: snapshot.contactId,
      recipient: event.Recipient,
    });
  }

  if (isRecipientUnsubscribe(event)) {
    if (run !== null) {
      await runtime.campaigns.contactConsent.recordOptOut(
        snapshot.contactId,
        run.kind === "project" && run.projectId !== null
          ? { type: "project", id: run.projectId }
          : { type: "newsletter" },
        "provider_event",
        run.id,
      );
    }
  }

  await persistence.persistCanonicalEvent(
    buildCanonicalEvent({
      event,
      sourceEvidenceId,
      contactId: snapshot.contactId,
    }),
  );
}

export async function POST(request: Request) {
  const env = readWebEnv();
  const rawBody = await request.text();
  const signature = request.headers.get("x-postmark-signature");
  const client = createPostmarkClient({
    serverToken: env.POSTMARK_SERVER_TOKEN ?? "",
    accountToken: env.POSTMARK_ACCOUNT_TOKEN ?? null,
    webhookSigningSecret: env.POSTMARK_WEBHOOK_SIGNING_SECRET ?? "",
    baseUrl: env.POSTMARK_BASE_URL,
  });

  if (signature === null || signature.trim().length === 0) {
    return safeError(
      "missing_signature",
      "Missing Postmark webhook signature.",
      400,
    );
  }

  if (!client.verifyWebhookSignature(rawBody, signature)) {
    return safeError(
      "invalid_signature",
      "Postmark webhook signature did not match.",
      401,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return safeError(
        "malformed_json",
        "Postmark webhook payload must be valid JSON.",
        400,
      );
    }

    console.error(error instanceof Error ? error.message : String(error));
    return ok();
  }

  if (isUnknownRecordType(payload)) {
    return ok();
  }

  let event: PostmarkWebhookEvent;
  try {
    event = postmarkWebhookEventSchema.parse(payload);
  } catch (error) {
    console.error("Postmark webhook payload validation failed.");
    console.error(error instanceof Error ? error.message : String(error));
    return ok();
  }

  try {
    const runtime = await getStage1WebRuntime();
    await processEvent(runtime, rawBody, event);
  } catch (error) {
    console.error("Postmark webhook processing failed.");
    console.error(error instanceof Error ? error.message : String(error));
  }

  return ok();
}
