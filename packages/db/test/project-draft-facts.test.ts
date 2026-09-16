import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

const hostLinks = [
  {
    role: "homepage" as const,
    label: "Forests volunteer resources",
    url: "https://adventurescientists.org/forests-volunteer-resources",
  },
];

describe("projectDimensions.findProjectFactsForDraft", () => {
  it("resolves connected-project facts per field", async () => {
    const context = await createTestStage1Context();
    const now = new Date("2026-09-15T12:00:00.000Z");
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Restoring Butternut Forest Health",
        projectAlias: "Beech & Butternut",
        source: "salesforce",
        isActive: true,
        aiOperatingContext: "The host is in post-season planning.",
        volunteerLinks: hostLinks,
      });
      await context.settings.aliases.create({
        id: "alias:forests",
        alias: "forests@adventurescientists.org",
        signature: "",
        projectId: "host:forests",
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech-own-links",
        projectName: "Saving American Beech",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
        volunteerLinks: [
          {
            role: "homepage",
            label: "Beech volunteer resources",
            url: "https://adventurescientists.org/beech-volunteer-resources",
          },
        ],
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech-inherit",
        projectName: "Saving American Beech, inherited facts",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
        aiOperatingContext: "",
        volunteerLinks: [],
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech-none",
        projectName: "Saving American Beech, no inherited facts",
        projectAlias: "Beech",
        source: "salesforce",
        isActive: true,
        aiOperatingContext: "",
        volunteerLinks: [],
      });

      const withOwnLinks =
        await context.repositories.projectDimensions.findProjectFactsForDraft(
          "sub:beech-own-links",
        );
      const inherited =
        await context.repositories.projectDimensions.findProjectFactsForDraft(
          "sub:beech-inherit",
        );
      const none =
        await context.repositories.projectDimensions.findProjectFactsForDraft(
          "sub:beech-none",
        );

      expect(withOwnLinks?.volunteerLinks).toEqual([
        {
          role: "homepage",
          label: "Beech volunteer resources",
          url: "https://adventurescientists.org/beech-volunteer-resources",
        },
      ]);
      expect(withOwnLinks?.operatingContext).toBe(
        "The host is in post-season planning.",
      );
      expect(withOwnLinks?.senderEmail).toBe(
        "forests@adventurescientists.org",
      );
      expect(withOwnLinks?.resolvedFromProjectId).toBe("host:forests");

      expect(inherited?.volunteerLinks).toEqual(hostLinks);
      expect(inherited?.operatingContext).toBe(
        "The host is in post-season planning.",
      );
      expect(inherited?.senderEmail).toBe("forests@adventurescientists.org");
      expect(inherited?.resolvedFromProjectId).toBe("host:forests");

      expect(none?.volunteerLinks).toEqual([]);
      expect(none?.operatingContext).toBe("");
      expect(none?.senderEmail).toBeNull();
      expect(none?.resolvedFromProjectId).toBe("sub:beech-none");
    } finally {
      await context.dispose();
    }
  });
});
