import { describe, expect, it } from "vitest";

import type { ProjectDimensionRecord, ProjectKnowledgeEntryRecord } from "@as-comms/contracts";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
import type { NotionClient } from "@as-comms/integrations";

import { migrateNotionChildDbsToProjectKnowledge } from "../src/ops/migrate-notion-child-dbs-to-project-knowledge.js";

const TRAINING_DB_ID = "11111111111111111111111111111111";
const PROJECT_PAGE_ID = "22222222222222222222222222222222";
const CANONICAL_DB_ID = "33333333333333333333333333333333";
const SNIPPET_DB_ID = "44444444444444444444444444444444";
const PATTERN_DB_ID = "55555555555555555555555555555555";

function richText(value: string) {
  return {
    type: "rich_text",
    rich_text: [{ plain_text: value }]
  };
}

function title(value: string) {
  return {
    type: "title",
    title: [{ plain_text: value }]
  };
}

function select(value: string) {
  return {
    type: "select",
    select: { name: value }
  };
}

function checkbox(value: boolean) {
  return {
    type: "checkbox",
    checkbox: value
  };
}

function buildClient(input?: {
  readonly projectSlug?: string;
}): NotionClient {
  const projectSlug = input?.projectSlug ?? "whitebark-pine";

  return {
    retrievePage() {
      return Promise.resolve({});
    },
    listBlockChildren() {
      return Promise.resolve({
        results: [
          {
            id: CANONICAL_DB_ID,
            type: "child_database",
            child_database: { title: "Whitebark Pine Canonical Replies" }
          },
          {
            id: SNIPPET_DB_ID,
            type: "child_database",
            child_database: { title: "Whitebark Pine Approved Snippets" }
          },
          {
            id: PATTERN_DB_ID,
            type: "child_database",
            child_database: { title: "Whitebark Pine Support Patterns" }
          }
        ],
        has_more: false
      });
    },
    queryDatabase({ databaseId }) {
      const normalizedDatabaseId = databaseId.replaceAll("-", "");
      if (normalizedDatabaseId === TRAINING_DB_ID) {
        return Promise.resolve({
          results: [
            {
              id: PROJECT_PAGE_ID,
              url: "https://notion.so/project",
              last_edited_time: "2026-04-24T12:00:00.000Z",
              properties: {
                Name: title("Whitebark Pine"),
                "Project ID": richText(projectSlug)
              }
            }
          ],
          has_more: false
        });
      }

      if (normalizedDatabaseId === CANONICAL_DB_ID) {
        return Promise.resolve({
          results: [
            {
              id: "66666666666666666666666666666666",
              url: "https://notion.so/canonical",
              last_edited_time: "2026-04-24T12:00:00.000Z",
              properties: {
                "Question Summary": title("Current field kit list"),
                "Issue Type": select("Trip planning"),
                "Volunteer Stage": select("Applied"),
                "Reply Strategy": richText("Point to the current kit checklist."),
                "Masked Example": richText("Hi {NAME}, here is the kit checklist."),
                "Approved for AI": checkbox(true),
                "Source Basis": richText("Human-authored canonical")
              }
            }
          ],
          has_more: false
        });
      }

      if (normalizedDatabaseId === SNIPPET_DB_ID) {
        return Promise.resolve({
          results: [
            {
              id: "77777777777777777777777777777777",
              url: "https://notion.so/snippet",
              last_edited_time: "2026-04-24T12:00:00.000Z",
              properties: {
                Name: title("Portal link"),
                "Snippet content": richText("Use the volunteer portal link."),
                "Approved for AI": checkbox(true)
              }
            }
          ],
          has_more: false
        });
      }

      return Promise.resolve({
        results: [
          {
            id: "88888888888888888888888888888888",
            url: "https://notion.so/pattern",
            last_edited_time: "2026-04-24T12:00:00.000Z",
            properties: {
              Name: title("Late training"),
              "Issue Type": select("Training"),
              "Recommended Pattern": richText("Acknowledge the delay and provide the next step."),
              "Use Sources": richText("Training guide"),
              "Avoid Saying": richText("Guaranteed placement")
            }
          }
        ],
        has_more: false
      });
    }
  };
}

function buildRepositories(input?: {
  readonly existingSummaries?: readonly string[];
  readonly inserted?: ProjectKnowledgeEntryRecord[];
}): Stage1RepositoryBundle {
  const project: ProjectDimensionRecord = {
    projectId: "sf-project-whitebark",
    projectName: "Whitebark Pine",
    projectAlias: "Whitebark",
    source: "salesforce",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null
  };
  const inserted = input?.inserted ?? [];

  return {
    projectDimensions: {
      listAll: () => Promise.resolve([project]),
      listActive: () => Promise.resolve([project]),
      listByIds: () => Promise.resolve([project]),
      upsert: (record: ProjectDimensionRecord) => Promise.resolve(record)
    },
    projectKnowledge: {
      list: () =>
        Promise.resolve(
          (input?.existingSummaries ?? []).map((summary) => ({
            id: `existing:${summary}`,
            projectId: project.projectId,
            kind: "canonical_reply",
            issueType: null,
            volunteerStage: null,
            questionSummary: summary,
            replyStrategy: null,
            maskedExample: null,
            sourceKind: "hand_authored",
            approvedForAi: true,
            sourceEventId: null,
            metadataJson: {},
            lastReviewedAt: null,
            createdAt: "2026-04-24T12:00:00.000Z",
            updatedAt: "2026-04-24T12:00:00.000Z"
          }))
        ),
      upsert: (record: ProjectKnowledgeEntryRecord) => {
        inserted.push(record);
        return Promise.resolve(record);
      },
      setApproved: () => Promise.resolve(),
      deleteById: () => Promise.resolve(),
      getForRetrieval: () => Promise.resolve([])
    }
  } as unknown as Stage1RepositoryBundle;
}

describe("migrateNotionChildDbsToProjectKnowledge", () => {
  it("maps canonical replies, snippets, and patterns through the slug map", async () => {
    const inserted: ProjectKnowledgeEntryRecord[] = [];

    const result = await migrateNotionChildDbsToProjectKnowledge({
      client: buildClient(),
      repositories: buildRepositories({ inserted }),
      projectTrainingDatabaseId: TRAINING_DB_ID,
      slugMap: new Map([["whitebark-pine", "sf-project-whitebark"]]),
      dryRun: false,
      logger: { log: () => undefined, warn: () => undefined },
      now: () => new Date("2026-04-24T12:00:00.000Z")
    });

    expect(result).toMatchObject({
      candidateCount: 3,
      insertedCount: 3,
      skippedCount: 0
    });
    expect(inserted.map((entry) => entry.kind)).toEqual([
      "canonical_reply",
      "snippet",
      "pattern"
    ]);
    expect(inserted[0]).toMatchObject({
      projectId: "sf-project-whitebark",
      issueType: "Trip planning",
      volunteerStage: "Applied",
      questionSummary: "Current field kit list",
      approvedForAi: true
    });
    expect(inserted[1]?.maskedExample).toBe("Use the volunteer portal link.");
    expect(inserted[2]?.replyStrategy).toBe(
      "Acknowledge the delay and provide the next step."
    );
  });

  it("skips unmapped Notion slugs", async () => {
    const inserted: ProjectKnowledgeEntryRecord[] = [];

    const result = await migrateNotionChildDbsToProjectKnowledge({
      client: buildClient({ projectSlug: "unknown-project" }),
      repositories: buildRepositories({ inserted }),
      projectTrainingDatabaseId: TRAINING_DB_ID,
      slugMap: new Map(),
      dryRun: false,
      logger: { log: () => undefined, warn: () => undefined },
      now: () => new Date("2026-04-24T12:00:00.000Z")
    });

    expect(result.slugMissCount).toBe(1);
    expect(inserted).toEqual([]);
  });

  it("skips existing project/question-summary pairs", async () => {
    const inserted: ProjectKnowledgeEntryRecord[] = [];

    const result = await migrateNotionChildDbsToProjectKnowledge({
      client: buildClient(),
      repositories: buildRepositories({
        inserted,
        existingSummaries: ["Current field kit list", "Portal link", "Late training"]
      }),
      projectTrainingDatabaseId: TRAINING_DB_ID,
      slugMap: new Map([["whitebark-pine", "sf-project-whitebark"]]),
      dryRun: false,
      logger: { log: () => undefined, warn: () => undefined },
      now: () => new Date("2026-04-24T12:00:00.000Z")
    });

    expect(result).toMatchObject({
      candidateCount: 0,
      insertedCount: 0,
      skippedCount: 3
    });
    expect(inserted).toEqual([]);
  });
});
