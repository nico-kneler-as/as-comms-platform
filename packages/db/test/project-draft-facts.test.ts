import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

const timestamp = "2026-09-15T12:00:00.000Z";

const source = (input: {
  readonly id: string;
  readonly url: string;
  readonly kind: "notion" | "web_page";
  readonly label: string | null;
  readonly enabled: boolean;
  readonly lastSyncStatus: "healthy" | "broken";
}) => ({
  id: input.id,
  url: input.url,
  kind: input.kind,
  label: input.label,
  enabled: input.enabled,
  last_synced_at: timestamp,
  last_sync_status: input.lastSyncStatus,
  last_sync_error: null,
  source_id: null,
  source_content_hash: null,
  created_at: timestamp,
  updated_at: timestamp,
});

const hostSources = [
  source({
    id: "11111111-1111-4111-8111-111111111111",
    url: "https://adventurescientists.org/forests-volunteer-resources",
    kind: "web_page",
    label: "Forests volunteer resources",
    enabled: true,
    lastSyncStatus: "healthy",
  }),
];

describe("projectDimensions.findProjectFactsForDraft", () => {
  it("derives shareable links from enabled web-page sources with per-field host fallback", async () => {
    const context = await createTestStage1Context();
    const now = new Date(timestamp);
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Restoring Butternut Forest Health",
        projectAlias: "Beech & Butternut",
        source: "salesforce",
        isActive: true,
        aiOperatingContext: "The host is in post-season planning.",
        aiKnowledgeSources: hostSources,
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
        aiKnowledgeSources: [
          source({
            id: "22222222-2222-4222-8222-222222222222",
            url: "https://adventurescientists.org/beech-volunteer-resources",
            kind: "web_page",
            label: "Beech volunteer resources",
            enabled: true,
            lastSyncStatus: "healthy",
          }),
          source({
            id: "33333333-3333-4333-8333-333333333333",
            url: "https://www.notion.so/beech-internal",
            kind: "notion",
            label: "Internal Beech notes",
            enabled: true,
            lastSyncStatus: "healthy",
          }),
          source({
            id: "44444444-4444-4444-8444-444444444444",
            url: "https://adventurescientists.org/disabled-beech-page",
            kind: "web_page",
            label: "Disabled Beech page",
            enabled: false,
            lastSyncStatus: "healthy",
          }),
          // A broken fetch does not make a public URL unsafe to share.
          source({
            id: "55555555-5555-4555-8555-555555555555",
            url: "https://adventurescientists.org/beech-arcgis-map",
            kind: "web_page",
            label: null,
            enabled: true,
            lastSyncStatus: "broken",
          }),
          source({
            id: "66666666-6666-4666-8666-666666666666",
            url: "https://adventurescientists.org/beech-field-manual",
            kind: "web_page",
            label: "",
            enabled: true,
            lastSyncStatus: "healthy",
          }),
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
        aiKnowledgeSources: [
          source({
            id: "77777777-7777-4777-8777-777777777777",
            url: "https://www.notion.so/beech-internal",
            kind: "notion",
            label: "Internal Beech notes",
            enabled: true,
            lastSyncStatus: "healthy",
          }),
          source({
            id: "88888888-8888-4888-8888-888888888888",
            url: "https://adventurescientists.org/disabled-beech-page",
            kind: "web_page",
            label: "Disabled Beech page",
            enabled: false,
            lastSyncStatus: "healthy",
          }),
        ],
      });

      const withOwnLinks =
        await context.repositories.projectDimensions.findProjectFactsForDraft(
          "sub:beech-own-links",
        );
      const inherited =
        await context.repositories.projectDimensions.findProjectFactsForDraft(
          "sub:beech-inherit",
        );

      expect(withOwnLinks?.shareableLinks).toEqual([
        {
          label: "Beech volunteer resources",
          url: "https://adventurescientists.org/beech-volunteer-resources",
        },
        {
          label: "https://adventurescientists.org/beech-arcgis-map",
          url: "https://adventurescientists.org/beech-arcgis-map",
        },
        {
          label: "https://adventurescientists.org/beech-field-manual",
          url: "https://adventurescientists.org/beech-field-manual",
        },
      ]);
      expect(withOwnLinks?.operatingContext).toBe(
        "The host is in post-season planning.",
      );
      expect(withOwnLinks?.senderEmail).toBe(
        "forests@adventurescientists.org",
      );
      expect(withOwnLinks?.resolvedFromProjectId).toBe("host:forests");

      expect(inherited?.shareableLinks).toEqual([
        {
          label: "Forests volunteer resources",
          url: "https://adventurescientists.org/forests-volunteer-resources",
        },
      ]);
      expect(inherited?.operatingContext).toBe(
        "The host is in post-season planning.",
      );
      expect(inherited?.senderEmail).toBe("forests@adventurescientists.org");
      expect(inherited?.resolvedFromProjectId).toBe("host:forests");
    } finally {
      await context.dispose();
    }
  });
});
