import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createStage5RepositoryBundle,
  postmarkWebhookDeadLetter,
} from "@as-comms/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/webhooks/postmark/route";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

type CampaignsBundle = ReturnType<typeof createStage5RepositoryBundle>;

const FIXTURE_DIR = path.resolve(
  __dirname,
  "../../../../packages/integrations/test/fixtures/postmark",
);
const FIXTURE_MESSAGE_ID = "883953f4-6105-42a2-a16a-77a8eac79483";
const SIGNING_SECRET = "test-webhook-secret";

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8").trim();
}

function signRequest(rawBody: string): Request {
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  return new Request("http://localhost/api/webhooks/postmark", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-postmark-signature": signature,
    },
    body: rawBody,
  });
}

async function listDeadLetters(runtime: Stage1WebTestRuntime) {
  return runtime.context.db.select().from(postmarkWebhookDeadLetter);
}

async function seedRunAndSnapshot(
  runtime: Stage1WebTestRuntime,
  campaigns: CampaignsBundle,
  overrides: { projectId?: string; runKind?: "newsletter" | "project" } = {},
) {
  const projectId = overrides.projectId ?? "project-postmark";
  const runKind = overrides.runKind ?? "project";

  await runtime.context.repositories.projectDimensions.upsert({
    projectId,
    projectName: "Postmark Test Project",
    projectAlias: "postmark-test",
    connectedToProjectId: null,
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  });

  await runtime.context.repositories.contacts.upsert({
    id: "contact-postmark",
    salesforceContactId: null,
    displayName: "Postmark Test Contact",
    primaryEmail: "john@example.com",
    primaryPhone: null,
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  });

  const run = await campaigns.campaignRuns.create({
    id: `run-${runKind}-postmark`,
    kind: runKind,
    launchType: "normal_email",
    projectId: runKind === "project" ? projectId : null,
    name: null,
    fromEmail: "postmark-test@adventurescientists.org",
    fromName: "AS Test",
    replyToEmail: "postmark-test@adventurescientists.org",
    subjectTemplate: "Test",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    preheader: null,
    audienceCriteria: {
      projectId,
      projectIds: [projectId],
      statuses: [],
      contactIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: 1,
    createdByUserId: null,
    lastEditedByUserId: null,
  });

  await campaigns.audienceSnapshots.bulkInsert(run.id, [
    {
      id: "snapshot-postmark",
      contactId: "contact-postmark",
      frozenEmail: "john@example.com",
      frozenFirstName: "John",
      frozenProjectName: "Postmark Test Project",
      frozenProjectId: projectId,
      frozenAliasEmail: "postmark-test@adventurescientists.org",
      unsubscribeToken: "token-postmark",
      deliveryStatus: "sent",
      providerMessageId: FIXTURE_MESSAGE_ID,
    },
  ]);

  return { run, snapshotId: "snapshot-postmark" };
}

describe("Postmark webhook route handler", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  let campaigns: CampaignsBundle | null = null;
  const originalEnv = { ...process.env };

  function requireCampaigns(): CampaignsBundle {
    if (campaigns === null) {
      throw new Error("Test campaigns bundle not initialised.");
    }
    return campaigns;
  }

  beforeEach(async () => {
    process.env.POSTMARK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
    process.env.POSTMARK_SERVER_TOKEN = "test-server-token";
    runtime = await createStage1WebTestRuntime();
    campaigns = createStage5RepositoryBundle(runtime.context.db);
  });

  afterEach(async () => {
    campaigns = null;
    if (runtime !== null) {
      await runtime.dispose();
      runtime = null;
    }
    process.env = { ...originalEnv };
  });

  it("rejects an invalid signature with 401", async () => {
    const rawBody = loadFixture("delivery.json");
    const response = await POST(
      new Request("http://localhost/api/webhooks/postmark", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-postmark-signature": "not-the-right-signature",
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_signature",
      message: "Postmark webhook signature did not match.",
    });
  });

  it("rejects a missing signature with 400", async () => {
    const rawBody = loadFixture("delivery.json");
    const response = await POST(
      new Request("http://localhost/api/webhooks/postmark", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "missing_signature",
      message: "Missing Postmark webhook signature.",
    });
  });

  it("rejects malformed JSON with 400 after signature verification", async () => {
    const rawBody = "{not-json";
    const response = await POST(signRequest(rawBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "malformed_json",
      message: "Postmark webhook payload must be valid JSON.",
    });
  });

  it("returns 200 for unknown Postmark event types to avoid retries", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const rawBody = JSON.stringify({
      RecordType: "UnknownFutureEvent",
      MessageID: FIXTURE_MESSAGE_ID,
    });
    const response = await POST(signRequest(rawBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const deadLetters = await listDeadLetters(runtime);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toMatchObject({
      recordType: "UnknownFutureEvent",
      messageId: FIXTURE_MESSAGE_ID,
      failureKind: "unknown_event_type",
      status: "terminal",
      terminalReason: "Postmark RecordType not handled by current code",
    });
  });

  it("records schema validation failures as terminal dead-letter rows and returns 200", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const rawBody = JSON.stringify({
      RecordType: "Delivery",
      MessageID: FIXTURE_MESSAGE_ID,
    });

    const response = await POST(signRequest(rawBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const deadLetters = await listDeadLetters(runtime);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toMatchObject({
      recordType: null,
      messageId: null,
      failureKind: "schema_error",
      status: "terminal",
      terminalReason: "Malformed Postmark payload after signature verification",
    });
  });

  it("processes a Delivery event into audience_snapshots + canonical event", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns);

    const rawBody = loadFixture("delivery.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const snapshots = await campaigns.audienceSnapshots.listForRun(
      "run-project-postmark",
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.deliveryStatus).toBe("delivered");
    expect(snapshots[0]?.deliveredAt).not.toBeNull();
  });

  it("processes a Bounce event into suppression_list + audience_snapshots", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns);

    const rawBody = loadFixture("bounce.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const snapshots = await campaigns.audienceSnapshots.listForRun(
      "run-project-postmark",
    );
    expect(snapshots[0]?.deliveryStatus).toBe("bounced");

    const suppressed = await campaigns.suppressionList.isSuppressed(
      "john@example.com",
      new Date("2099-01-01T00:00:00Z"),
    );
    expect(suppressed).toBe(true);
  });

  it("processes a SpamComplaint event into suppression_list + identity review queue", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns);

    const rawBody = loadFixture("spam-complaint.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const suppressed = await campaigns.suppressionList.isSuppressed(
      "john@example.com",
      new Date("2099-01-01T00:00:00Z"),
    );
    expect(suppressed).toBe(true);

    const openForContact =
      await runtime.context.repositories.identityResolutionQueue.listOpenByContactId(
        "contact-postmark",
      );
    expect(
      openForContact.some(
        (row) =>
          row.anchoredContactId === "contact-postmark" &&
          row.id.startsWith("postmark-spam-complaint:"),
      ),
    ).toBe(true);
  });

  it("records the open event with activity='open' on the snapshot", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns);

    const rawBody = loadFixture("open.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const snapshots = await campaigns.audienceSnapshots.listForRun(
      "run-project-postmark",
    );
    expect(snapshots[0]?.openedAt).not.toBeNull();
  });

  it("records the click event with activity='click' on the snapshot", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns);

    const rawBody = loadFixture("click.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const snapshots = await campaigns.audienceSnapshots.listForRun(
      "run-project-postmark",
    );
    expect(snapshots[0]?.clickedAt).not.toBeNull();
  });

  it("records a recipient-initiated unsubscribe as contact_consent on the project scope", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns, { runKind: "project" });

    const rawBody = loadFixture("subscription-change.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const consentRows =
      await campaigns.contactConsent.listForContact("contact-postmark");
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]?.scopeType).toBe("project");
    expect(consentRows[0]?.scopeId).toBe("project-postmark");
    expect(consentRows[0]?.source).toBe("provider_event");
  });

  it("records a newsletter-kind unsubscribe with scope='newsletter'", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns, { runKind: "newsletter" });

    const rawBody = loadFixture("subscription-change.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const consentRows =
      await campaigns.contactConsent.listForContact("contact-postmark");
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]?.scopeType).toBe("newsletter");
    expect(consentRows[0]?.scopeId).toBeNull();
  });

  it("returns 200 (no-op) and records a pending dead-letter when the MessageID has no matching audience snapshot", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    // Do NOT seed a snapshot — the lookup will return null.
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const rawBody = loadFixture("delivery.json");
    const response = await POST(signRequest(rawBody));
    expect(response.status).toBe(200);

    const suppressed = await campaigns.suppressionList.isSuppressed(
      "john@example.com",
      new Date("2099-01-01T00:00:00Z"),
    );
    expect(suppressed).toBe(false);

    const deadLetters = await listDeadLetters(runtime);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toMatchObject({
      recordType: "Delivery",
      messageId: FIXTURE_MESSAGE_ID,
      failureKind: "snapshot_not_found",
      status: "pending",
      terminalReason: null,
    });
    expect(deadLetters[0]?.sourceEvidenceId).not.toBeNull();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("recipientLogId");
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain("john@example.com");
    warnSpy.mockRestore();
  });

  it("records retryable processing failures as pending dead-letter rows and returns 500", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    await seedRunAndSnapshot(runtime, requireCampaigns());

    const originalUpdateDeliveryEvent =
      runtime.runtime.campaigns.audienceSnapshots.updateDeliveryEvent.bind(
        runtime.runtime.campaigns.audienceSnapshots,
      );
    runtime.runtime.campaigns.audienceSnapshots.updateDeliveryEvent =
      () => Promise.reject(new Error("forced downstream failure"));

    const rawBody = loadFixture("delivery.json");
    const response = await POST(signRequest(rawBody));

    runtime.runtime.campaigns.audienceSnapshots.updateDeliveryEvent =
      originalUpdateDeliveryEvent;

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "processing_failed",
      message: "Postmark webhook processing failed.",
    });

    const deadLetters = await listDeadLetters(runtime);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toMatchObject({
      recordType: "Delivery",
      messageId: FIXTURE_MESSAGE_ID,
      failureKind: "processing_error",
      status: "pending",
      terminalReason: null,
    });
    expect(deadLetters[0]?.sourceEvidenceId).not.toBeNull();
  });

  it("is idempotent: re-delivering the same Delivery event does not double-write", async () => {
    if (runtime === null) {
      throw new Error("Runtime not initialized.");
    }
    const campaigns = requireCampaigns();
    await seedRunAndSnapshot(runtime, campaigns);

    const rawBody = loadFixture("delivery.json");
    const firstResponse = await POST(signRequest(rawBody));
    const secondResponse = await POST(signRequest(rawBody));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    const snapshots = await campaigns.audienceSnapshots.listForRun(
      "run-project-postmark",
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.deliveryStatus).toBe("delivered");
  });
});
