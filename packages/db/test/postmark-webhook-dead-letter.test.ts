import { afterEach, describe, expect, it } from "vitest";

import {
  createStage5RepositoryBundle,
  postmarkWebhookDeadLetter,
  sourceEvidenceLog,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

describe("postmark webhook dead-letter repository", () => {
  const contexts: Stage1Context[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("records rows, lists pending, marks retried, and marks terminal", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await context.db.insert(sourceEvidenceLog).values({
      id: "source-evidence-postmark-dead-letter",
      provider: "postmark",
      providerRecordType: "postmark_webhook_delivery",
      providerRecordId: "pm-dead-letter-1",
      receivedAt: new Date("2026-05-19T12:00:00.000Z"),
      occurredAt: new Date("2026-05-19T12:00:00.000Z"),
      payloadRef: "postmark://webhooks/Delivery/pm-dead-letter-1",
      idempotencyKey: "postmark:pm-dead-letter-1:Delivery:2026-05-19T12:00:00.000Z",
      checksum: "checksum:postmark-dead-letter",
      createdAt: new Date("2026-05-19T12:00:00.000Z"),
    });

    const pending = await campaigns.webhookDeadLetter.record({
      recordType: "Delivery",
      messageId: "0c62e36f-72f6-4e8c-a38e-1aecc6b4f150",
      sourceEvidenceId: "source-evidence-postmark-dead-letter",
      payloadJson: { RecordType: "Delivery" },
      failureKind: "processing_error",
      failureMessage: "temporary downstream failure",
    });
    const terminal = await campaigns.webhookDeadLetter.record({
      recordType: "UnknownFutureEvent",
      messageId: "215bdcf6-3ceb-4b2d-a2eb-e92948b18ef9",
      sourceEvidenceId: null,
      payloadJson: { RecordType: "UnknownFutureEvent" },
      failureKind: "unknown_event_type",
      failureMessage: "Unhandled Postmark RecordType",
      terminalReason: "Postmark RecordType not handled by current code",
    });

    expect(pending.status).toBe("pending");
    expect(terminal.status).toBe("terminal");

    const listedPending = await campaigns.webhookDeadLetter.listPending();
    expect(listedPending.map((row) => row.id)).toEqual([pending.id]);

    const retriedAt = new Date("2026-05-19T13:00:00.000Z");
    await campaigns.webhookDeadLetter.markRetried(pending.id, retriedAt);
    await campaigns.webhookDeadLetter.markTerminal(
      pending.id,
      "Replay exhausted after operator review",
    );

    const rows = await context.db.select().from(postmarkWebhookDeadLetter);
    const pendingRow = rows.find((row) => row.id === pending.id);
    const terminalRow = rows.find((row) => row.id === terminal.id);

    expect(pendingRow).toMatchObject({
      id: pending.id,
      retryCount: 1,
      status: "terminal",
      terminalReason: "Replay exhausted after operator review",
    });
    expect(pendingRow?.lastRetryAt?.toISOString()).toBe(
      "2026-05-19T13:00:00.000Z",
    );
    expect(terminalRow).toMatchObject({
      id: terminal.id,
      status: "terminal",
      terminalReason: "Postmark RecordType not handled by current code",
    });

    const listedPendingAfterTransitions =
      await campaigns.webhookDeadLetter.listPending();
    expect(listedPendingAfterTransitions).toEqual([]);
  });
});
