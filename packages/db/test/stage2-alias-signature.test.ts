import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

describe("Stage 2 alias signature repository", () => {
  it("updates an alias signature and persists the stored value for later reads", async () => {
    const context = await createTestStage1Context();

    try {
      const now = new Date("2026-04-21T12:00:00.000Z");
      await context.settings.users.upsert({
        id: "user:admin",
        name: "Admin",
        email: "admin@adventurescientists.org",
        emailVerified: now,
        image: null,
        role: "admin",
        deactivatedAt: null,
        createdAt: now,
        updatedAt: now
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "project:signature",
        projectName: "Signature Project",
        source: "salesforce"
      });
      await context.settings.aliases.create({
        id: "alias:signature",
        alias: "signature@asc.internal",
        signature: "",
        projectId: "project:signature",
        createdAt: now,
        updatedAt: now,
        createdBy: "user:admin",
        updatedBy: "user:admin"
      });

      const updated = await context.settings.aliases.updateSignature({
        aliasId: "alias:signature",
        signature: "Thanks,\nAdventure Scientists",
        actorId: "user:admin"
      });
      const foundById = await context.settings.aliases.findById("alias:signature");
      const foundByAlias = await context.settings.aliases.findByAlias(
        "signature@asc.internal"
      );

      expect(updated).toMatchObject({
        id: "alias:signature",
        alias: "signature@asc.internal",
        signature: "Thanks,\nAdventure Scientists",
        projectId: "project:signature",
        updatedBy: "user:admin"
      });
      expect(foundById).toMatchObject({
        id: "alias:signature",
        signature: "Thanks,\nAdventure Scientists"
      });
      expect(foundByAlias).toMatchObject({
        id: "alias:signature",
        signature: "Thanks,\nAdventure Scientists"
      });
    } finally {
      await context.client.close();
    }
  });
});
