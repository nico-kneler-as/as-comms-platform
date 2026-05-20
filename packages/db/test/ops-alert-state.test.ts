import { describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { opsAlertState } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

describe("ops alert state repository", () => {
  it("returns null when the row is missing", async () => {
    const context = await createTestStage1Context();

    try {
      await expect(
        context.settings.opsAlertState.getLastSentAt(
          "integration_health",
          "gmail",
        ),
      ).resolves.toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("round-trips a sent row", async () => {
    const context = await createTestStage1Context();

    try {
      await context.settings.opsAlertState.recordSent({
        category: "worker_dead_letter",
        dedupKey: "job-123",
        sentAt: "2026-05-20T12:00:00.000Z",
        status: "sent",
      });

      await expect(
        context.settings.opsAlertState.getLastSentAt(
          "worker_dead_letter",
          "job-123",
        ),
      ).resolves.toEqual({
        lastSentAt: "2026-05-20T12:00:00.000Z",
        lastStatus: "sent",
      });
    } finally {
      await context.dispose();
    }
  });

  it("upserts idempotently for the same category and dedup key", async () => {
    const context = await createTestStage1Context();

    try {
      await context.settings.opsAlertState.recordSent({
        category: "postmark_sender",
        dedupKey: "project:alpha",
        sentAt: "2026-05-20T12:00:00.000Z",
        status: "sent",
      });
      await context.settings.opsAlertState.recordSent({
        category: "postmark_sender",
        dedupKey: "project:alpha",
        sentAt: "2026-05-20T13:00:00.000Z",
        status: "sent",
      });

      await expect(
        context.settings.opsAlertState.getLastSentAt(
          "postmark_sender",
          "project:alpha",
        ),
      ).resolves.toEqual({
        lastSentAt: "2026-05-20T13:00:00.000Z",
        lastStatus: "sent",
      });

      const rows = await context.db
        .select()
        .from(opsAlertState)
        .where(
          eq(opsAlertState.category, "postmark_sender"),
        );

      expect(rows).toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it("keeps distinct category and dedup-key rows separate", async () => {
    const context = await createTestStage1Context();

    try {
      await context.settings.opsAlertState.recordSent({
        category: "integration_health",
        dedupKey: "gmail",
        sentAt: "2026-05-20T12:00:00.000Z",
        status: "sent",
      });
      await context.settings.opsAlertState.recordSent({
        category: "integration_health",
        dedupKey: "salesforce",
        sentAt: "2026-05-20T12:30:00.000Z",
        status: "sent",
      });
      await context.settings.opsAlertState.recordSent({
        category: "worker_dead_letter",
        dedupKey: "gmail",
        sentAt: "2026-05-20T13:00:00.000Z",
        status: "sent",
      });

      const rows = await context.db.select().from(opsAlertState);

      expect(rows).toHaveLength(3);
      await expect(
        context.settings.opsAlertState.getLastSentAt(
          "integration_health",
          "salesforce",
        ),
      ).resolves.toEqual({
        lastSentAt: "2026-05-20T12:30:00.000Z",
        lastStatus: "sent",
      });
    } finally {
      await context.dispose();
    }
  });
});
