import { describe, expect, it } from "vitest";

import {
  createStage1RepositoryBundleFromConnection,
  smsSenders,
} from "@as-comms/db";
import { createTestStage1Context } from "@as-comms/db/test-helpers";

import { parseSeedSmsSenderConfig, seedSmsSender } from "../seed-sms-senders.js";

async function listSmsSenderRows(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
) {
  return context.db.select().from(smsSenders);
}

describe("seed-sms-senders", () => {
  it("inserts exactly one sender row with the expected values", async () => {
    const context = await createTestStage1Context();

    try {
      const repositories = createStage1RepositoryBundleFromConnection({
        db: context.db,
      });

      const result = await seedSmsSender({
        db: context.db,
        repositories,
        dryRun: false,
        config: {
          phoneE164: "+14065550143",
          displayName: "Adventure Scientists",
          monthlyCap: 4000,
        },
      });
      const rows = await listSmsSenderRows(context);

      expect(result.status).toBe("inserted");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        phoneE164: "+14065550143",
        displayName: "Adventure Scientists",
        monthlyCap: 4000,
        isActive: true,
      });
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent when run twice with the same phone number", async () => {
    const context = await createTestStage1Context();

    try {
      const repositories = createStage1RepositoryBundleFromConnection({
        db: context.db,
      });
      const config = {
        phoneE164: "+14065550144",
        displayName: "Adventure Scientists",
        monthlyCap: null,
      } as const;

      const first = await seedSmsSender({
        db: context.db,
        repositories,
        dryRun: false,
        config,
      });
      const second = await seedSmsSender({
        db: context.db,
        repositories,
        dryRun: false,
        config,
      });

      expect(first.status).toBe("inserted");
      expect(second.status).toBe("already_exists");
      await expect(listSmsSenderRows(context)).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it("throws a clear error when SMS_SENDER_PHONE_E164 is missing", () => {
    expect(() => parseSeedSmsSenderConfig({})).toThrowError(
      "SMS_SENDER_PHONE_E164 is required.",
    );
  });
});
