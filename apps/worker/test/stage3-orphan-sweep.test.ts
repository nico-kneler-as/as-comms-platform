import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskList } from "../src/tasks.js";
import { sweepPendingOutboundsJobName } from "../src/jobs/sweep-pending-outbounds.js";
import { createTestWorkerContext } from "./helpers.js";

describe("pending outbound orphan sweep task", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks rows older than 30 minutes as orphaned and keeps newer rows pending", async () => {
    const context = await createTestWorkerContext();
    const now = new Date("2026-04-21T12:00:00.000Z");
    const logger = { log: vi.fn() };

    try {
      await context.settings.users.upsert({
        id: "user:operator",
        name: "Operator",
        email: "operator@example.org",
        emailVerified: now,
        image: null,
        role: "operator",
        deactivatedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await context.repositories.contacts.upsert({
        id: "contact:pending-outbound",
        salesforceContactId: null,
        displayName: "Pending Outbound Contact",
        primaryEmail: "volunteer@example.org",
        primaryPhone: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      await context.repositories.pendingOutbounds.insert({
        id: "pending:old",
        fingerprint: "fp:old",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Old pending",
        bodyPlaintext: "Old body",
        bodySha256: "sha256:old",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-04-21T11:20:00.000Z",
      });
      await context.repositories.pendingOutbounds.insert({
        id: "pending:new",
        fingerprint: "fp:new",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Fresh pending",
        bodyPlaintext: "Fresh body",
        bodySha256: "sha256:new",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-04-21T11:45:00.000Z",
      });

      const taskList = createTaskList(undefined, {
        pendingOutboundSweep: {
          pendingOutbounds: context.repositories.pendingOutbounds,
          logger,
          now: () => now,
        }
      });

      const task = taskList[sweepPendingOutboundsJobName];

      if (task === undefined) {
        throw new Error("Expected pending outbound sweep task to be registered.");
      }

      await task({}, {} as never);

      expect(
        await context.repositories.pendingOutbounds.findByFingerprint("fp:old")
      ).toMatchObject({
        id: "pending:old",
        status: "orphaned",
      });
      expect(
        await context.repositories.pendingOutbounds.findByFingerprint("fp:new")
      ).toMatchObject({
        id: "pending:new",
        status: "pending",
      });
      expect(logger.log).toHaveBeenCalledWith(
        JSON.stringify({
          event: "composer.orphan_sweep.completed",
          count: 1,
          olderThan: "2026-04-21T11:30:00.000Z"
        })
      );
    } finally {
      await context.dispose();
    }
  });
});
