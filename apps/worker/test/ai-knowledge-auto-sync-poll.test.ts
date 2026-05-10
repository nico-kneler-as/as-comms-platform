import { afterEach, describe, expect, it, vi } from "vitest";

import { synthesizeProjectKnowledgeJobName } from "@as-comms/contracts";

import { pollAiKnowledgeAutoSyncJobName } from "../src/orchestration/poll-ai-knowledge-auto-sync.js";
import { createStage1TaskList } from "../src/orchestration/tasks.js";
import { createTestWorkerContext } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("AI knowledge auto-sync poll task", () => {
  it("enqueues only due projects with configured schedule, alias, and enabled sources", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));

    const context = await createTestWorkerContext();

    try {
      await context.repositories.projectDimensions.upsert({
          projectId: "project:daily-due",
          projectName: "Daily Due",
          projectAlias: "Daily Due",
          source: "salesforce",
          isActive: true,
          aiKnowledgeSources: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              kind: "web_page",
              url: "https://example.test/daily-due",
              label: null,
              enabled: true,
              last_synced_at: "2026-05-08T09:00:00.000Z",
              last_sync_status: "healthy",
              last_sync_error: null,
              source_id: "daily-due",
              source_content_hash: "hash:daily-due",
              created_at: "2026-05-08T09:00:00.000Z",
              updated_at: "2026-05-08T09:00:00.000Z",
            },
          ],
          aiAutoSyncSchedule: "daily",
          aiOptimizedSynthesizedAt: "2026-05-08T11:00:00.000Z",
        });
      await context.repositories.projectDimensions.upsert({
          projectId: "project:weekly-due",
          projectName: "Weekly Due",
          projectAlias: "Weekly Due",
          source: "salesforce",
          isActive: true,
          aiKnowledgeSources: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              kind: "notion",
              url: "https://www.notion.so/weekly-due",
              label: null,
              enabled: true,
              last_synced_at: "2026-05-01T09:00:00.000Z",
              last_sync_status: "healthy",
              last_sync_error: null,
              source_id: "weekly-due",
              source_content_hash: "hash:weekly-due",
              created_at: "2026-05-01T09:00:00.000Z",
              updated_at: "2026-05-01T09:00:00.000Z",
            },
          ],
          aiAutoSyncSchedule: "weekly",
          aiOptimizedSynthesizedAt: "2026-05-01T11:00:00.000Z",
        });
      await context.repositories.projectDimensions.upsert({
          projectId: "project:daily-fresh",
          projectName: "Daily Fresh",
          projectAlias: "Daily Fresh",
          source: "salesforce",
          isActive: true,
          aiKnowledgeSources: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind: "web_page",
              url: "https://example.test/daily-fresh",
              label: null,
              enabled: true,
              last_synced_at: "2026-05-09T09:00:00.000Z",
              last_sync_status: "healthy",
              last_sync_error: null,
              source_id: "daily-fresh",
              source_content_hash: "hash:daily-fresh",
              created_at: "2026-05-09T09:00:00.000Z",
              updated_at: "2026-05-09T09:00:00.000Z",
            },
          ],
          aiAutoSyncSchedule: "daily",
          aiOptimizedSynthesizedAt: "2026-05-09T01:00:00.000Z",
        });
      await context.repositories.projectDimensions.upsert({
          projectId: "project:inactive",
          projectName: "Inactive",
          projectAlias: null,
          source: "salesforce",
          isActive: false,
          aiKnowledgeSources: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              kind: "web_page",
              url: "https://example.test/no-alias",
              label: null,
              enabled: true,
              last_synced_at: "2026-05-01T09:00:00.000Z",
              last_sync_status: "healthy",
              last_sync_error: null,
              source_id: "no-alias",
              source_content_hash: "hash:no-alias",
              created_at: "2026-05-01T09:00:00.000Z",
              updated_at: "2026-05-01T09:00:00.000Z",
            },
          ],
          aiAutoSyncSchedule: "daily",
          aiOptimizedSynthesizedAt: null,
        });
      await context.repositories.projectDimensions.upsert({
          projectId: "project:never",
          projectName: "Never",
          projectAlias: "Never",
          source: "salesforce",
          isActive: true,
          aiKnowledgeSources: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              kind: "web_page",
              url: "https://example.test/never",
              label: null,
              enabled: true,
              last_synced_at: "2026-05-01T09:00:00.000Z",
              last_sync_status: "healthy",
              last_sync_error: null,
              source_id: "never",
              source_content_hash: "hash:never",
              created_at: "2026-05-01T09:00:00.000Z",
              updated_at: "2026-05-01T09:00:00.000Z",
            },
          ],
          aiAutoSyncSchedule: "never",
          aiOptimizedSynthesizedAt: null,
        });

      const addJob = vi.fn(() => Promise.resolve({ id: "job:auto-sync" }));
      const task =
        createStage1TaskList(context.orchestration, {
          aiKnowledgeAutoSync: {
            projectDimensions: context.repositories.projectDimensions,
          },
        })[pollAiKnowledgeAutoSyncJobName];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected AI knowledge auto-sync poll task to be registered.");
      }

      await task({}, { addJob } as never);

      expect(addJob).toHaveBeenCalledTimes(2);
      expect(addJob).toHaveBeenNthCalledWith(
        1,
        synthesizeProjectKnowledgeJobName,
        expect.objectContaining({
          projectId: "project:daily-due",
          skipIfHashUnchanged: true,
        }),
        {
          jobKey: "ai-knowledge-auto-sync:project:daily-due",
          jobKeyMode: "replace",
          maxAttempts: 1,
        },
      );
      expect(addJob).toHaveBeenNthCalledWith(
        2,
        synthesizeProjectKnowledgeJobName,
        expect.objectContaining({
          projectId: "project:weekly-due",
          skipIfHashUnchanged: true,
        }),
        {
          jobKey: "ai-knowledge-auto-sync:project:weekly-due",
          jobKeyMode: "replace",
          maxAttempts: 1,
        },
      );
    } finally {
      await context.dispose();
    }
  });
});
