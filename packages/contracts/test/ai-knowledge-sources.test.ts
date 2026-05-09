import { describe, expect, it } from "vitest";

import {
  aiKnowledgeSourceKindSchema,
  aiKnowledgeSourceSchema,
  aiKnowledgeSourcesSchema,
  aiKnowledgeSourceSyncStatusSchema,
} from "../src/index.js";

describe("AI knowledge source contracts", () => {
  it("parses a valid source entry", () => {
    const result = aiKnowledgeSourceSchema.parse({
      id: "4f84c4cb-7ee4-4df4-b0c6-385a3b6d3d70",
      url: "https://www.notion.so/3278a9129211804baa72c76a86d084d0",
      kind: "notion",
      label: null,
      enabled: true,
      last_synced_at: "2026-05-01T12:00:00.000Z",
      last_sync_status: "healthy",
      last_sync_error: null,
      source_id: "3278a9129211804baa72c76a86d084d0",
      source_content_hash: "md5:content",
      created_at: "2026-05-01T12:00:00.000Z",
      updated_at: "2026-05-01T12:00:00.000Z",
    });

    expect(result.kind).toBe("notion");
    expect(aiKnowledgeSourceKindSchema.options).toEqual([
      "notion",
      "web_page",
      "inline_text",
    ]);
    expect(aiKnowledgeSourceSyncStatusSchema.options).toEqual([
      "pending",
      "healthy",
      "stale",
      "broken",
    ]);
  });

  it("rejects malformed source entries", () => {
    const malformed = aiKnowledgeSourceSchema.safeParse({
      id: "not-a-uuid",
      url: "not-a-url",
      kind: "notion",
      label: null,
      enabled: true,
      last_synced_at: null,
      last_sync_status: null,
      last_sync_error: null,
      source_id: null,
      source_content_hash: null,
      created_at: "not-a-date",
      updated_at: "2026-05-01T12:00:00.000Z",
    });

    expect(malformed.success).toBe(false);
  });

  it("parses arrays of source entries", () => {
    const sources = aiKnowledgeSourcesSchema.parse([
      {
        id: "4f84c4cb-7ee4-4df4-b0c6-385a3b6d3d70",
        url: "https://www.adventurescientists.org/project",
        kind: "web_page",
        label: "Project page",
        enabled: true,
        last_synced_at: null,
        last_sync_status: "pending",
        last_sync_error: null,
        source_id: "hash:web",
        source_content_hash: null,
        created_at: "2026-05-01T12:00:00.000Z",
        updated_at: "2026-05-01T12:00:00.000Z",
      },
    ]);

    expect(sources).toHaveLength(1);
  });
});
