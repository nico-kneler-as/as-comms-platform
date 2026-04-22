import { describe, expect, it, vi } from "vitest";

import { aiKnowledgeEntries, projectDimensions } from "@as-comms/db";
import type { NotionClient } from "@as-comms/integrations";
import { NotionProviderError, normalizeNotionId } from "@as-comms/integrations";

import { runNotionKnowledgeSync } from "../src/jobs/notion-knowledge-sync/sync.js";
import { createTestWorkerContext } from "./helpers.js";

function buildRichText(text: string) {
  return [
    {
      plain_text: text,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        code: false
      }
    }
  ];
}

function buildPage(input: {
  readonly id: string;
  readonly title: string;
  readonly lastEditedTime: string;
  readonly url: string;
  readonly properties?: Record<string, unknown>;
}) {
  return {
    id: normalizeNotionId(input.id),
    url: input.url,
    last_edited_time: input.lastEditedTime,
    properties: input.properties ?? {
      title: {
        type: "title",
        title: buildRichText(input.title)
      }
    }
  };
}

function buildParagraphBlock(id: string, text: string) {
  return {
    id: normalizeNotionId(id),
    type: "paragraph",
    has_children: false,
    paragraph: {
      rich_text: buildRichText(text)
    }
  };
}

function buildProjectRow(input: {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly lastEditedTime: string;
  readonly url: string;
  readonly extraProperties?: Record<string, unknown>;
}) {
  return {
    id: normalizeNotionId(input.id),
    url: input.url,
    last_edited_time: input.lastEditedTime,
    properties: {
      Name: {
        type: "title",
        title: buildRichText(input.name)
      },
      "Project ID": {
        type: "rich_text",
        rich_text: buildRichText(input.projectId)
      },
      ...input.extraProperties
    }
  };
}

function createFakeNotionClient(input: {
  readonly pages: Record<string, Record<string, unknown>>;
  readonly blockChildren?: Record<string, readonly Record<string, unknown>[]>;
  readonly databaseResponses?: Record<string, readonly Record<string, unknown>[]>;
}): NotionClient {
  const blockQueues = new Map(
    Object.entries(input.blockChildren ?? {}).map(([blockId, responses]) => [
      normalizeNotionId(blockId),
      [...responses]
    ])
  );
  const databaseQueues = new Map(
    Object.entries(input.databaseResponses ?? {}).map(
      ([databaseId, responses]) => [normalizeNotionId(databaseId), [...responses]]
    )
  );

  function readPagedResponse(
    responses: readonly Record<string, unknown>[],
    startCursor?: string
  ): Record<string, unknown> | undefined {
    if (responses.length === 0) {
      return undefined;
    }

    if (startCursor === undefined) {
      return responses[0];
    }

    const previousPageIndex = responses.findIndex(
      (response) => response.next_cursor === startCursor
    );

    return previousPageIndex === -1
      ? undefined
      : responses[previousPageIndex + 1];
  }

  return {
    retrievePage(pageId) {
      const page = input.pages[normalizeNotionId(pageId)];

      if (page === undefined) {
        return Promise.reject(new Error(`Missing page fixture for ${pageId}`));
      }

      return Promise.resolve(page);
    },
    listBlockChildren({ blockId }) {
      return Promise.resolve(
        blockQueues.get(normalizeNotionId(blockId))?.shift() ?? {
          results: [],
          has_more: false,
          next_cursor: null
        }
      );
    },
    queryDatabase({ databaseId, startCursor }) {
      const responses = databaseQueues.get(normalizeNotionId(databaseId)) ?? [];
      return Promise.resolve(
        readPagedResponse(responses, startCursor) ?? {
          results: [],
          has_more: false,
          next_cursor: null
        }
      );
    }
  };
}

async function seedProjectDimension(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  input: { readonly projectId: string; readonly projectName: string }
) {
  await context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    source: "salesforce"
  });
}

async function listKnowledgeEntries(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>
) {
  return context.db
    .select()
    .from(aiKnowledgeEntries)
    .orderBy(aiKnowledgeEntries.scope, aiKnowledgeEntries.sourceId);
}

describe("Notion knowledge sync", () => {
  it("marks Notion as not configured without touching knowledge rows", async () => {
    const context = await createTestWorkerContext();

    try {
      const result = await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: null,
          generalTrainingPageId: null,
          projectTrainingDatabaseId: null
        },
        sleep: () => Promise.resolve()
      });

      expect(result).toEqual({
        status: "not_configured"
      });
      expect(await listKnowledgeEntries(context)).toEqual([]);
      await expect(
        context.settings.integrationHealth.findById("notion")
      ).resolves.toMatchObject({
        status: "not_configured"
      });
    } finally {
      await context.dispose();
    }
  });

  it("syncs the general page and all matching project rows, then writes healthy integration health", async () => {
    const context = await createTestWorkerContext();
    const generalPageId = normalizeNotionId("3278a9129211804baa72c76a86d084d0");
    const databaseId = normalizeNotionId("3278a91292118095b86aff5836821428");

    await seedProjectDimension(context, {
      projectId: "project-alpha",
      projectName: "Project Alpha"
    });
    await seedProjectDimension(context, {
      projectId: "project-beta",
      projectName: "Project Beta"
    });

    const client = createFakeNotionClient({
      pages: {
        [generalPageId]: buildPage({
          id: generalPageId,
          title: "General Training",
          lastEditedTime: "2026-04-21T12:00:00.000Z",
          url: "https://www.notion.so/general-training"
        }),
        [normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]: buildPage({
          id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          title: "Project Alpha",
          lastEditedTime: "2026-04-21T12:05:00.000Z",
          url: "https://www.notion.so/project-alpha",
          properties: buildProjectRow({
            id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            name: "Project Alpha",
            projectId: "project-alpha",
            lastEditedTime: "2026-04-21T12:05:00.000Z",
            url: "https://www.notion.so/project-alpha",
            extraProperties: {
              "Training URL": {
                type: "url",
                url: "https://docs.example.org/project-alpha"
              },
              Tags: {
                type: "multi_select",
                multi_select: [{ name: "marine" }]
              }
            }
          }).properties
        }),
        [normalizeNotionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")]: buildPage({
          id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          title: "Project Beta",
          lastEditedTime: "2026-04-21T12:06:00.000Z",
          url: "https://www.notion.so/project-beta",
          properties: buildProjectRow({
            id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            name: "Project Beta",
            projectId: "project-beta",
            lastEditedTime: "2026-04-21T12:06:00.000Z",
            url: "https://www.notion.so/project-beta"
          }).properties
        })
      },
      blockChildren: {
        [generalPageId]: [
          {
            results: [buildParagraphBlock("10101010101010101010101010101010", "Global guidance")],
            has_more: false,
            next_cursor: null
          }
        ],
        [normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]: [
          {
            results: [buildParagraphBlock("11111111111111111111111111111111", "Alpha training body")],
            has_more: false,
            next_cursor: null
          }
        ],
        [normalizeNotionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")]: [
          {
            results: [buildParagraphBlock("12121212121212121212121212121212", "Beta training body")],
            has_more: false,
            next_cursor: null
          }
        ]
      },
      databaseResponses: {
        [databaseId]: [
          {
            results: [
              buildProjectRow({
                id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                name: "Project Alpha",
                projectId: "project-alpha",
                lastEditedTime: "2026-04-21T12:05:00.000Z",
                url: "https://www.notion.so/project-alpha",
                extraProperties: {
                  "Training URL": {
                    type: "url",
                    url: "https://docs.example.org/project-alpha"
                  },
                  Tags: {
                    type: "multi_select",
                    multi_select: [{ name: "marine" }]
                  }
                }
              }),
              buildProjectRow({
                id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                name: "Project Beta",
                projectId: "project-beta",
                lastEditedTime: "2026-04-21T12:06:00.000Z",
                url: "https://www.notion.so/project-beta"
              })
            ],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    try {
      const result = await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: () => client,
        sleep: () => Promise.resolve(),
        now: (() => {
          let tick = 0;
          return () => new Date(Date.parse("2026-04-21T12:10:00.000Z") + tick++ * 1000);
        })()
      });

      expect(result).toMatchObject({
        status: "healthy",
        knowledgeEntriesTotal: 3,
        projectsSyncedCount: 2,
        orphanRowsCount: 0
      });

      await expect(listKnowledgeEntries(context)).resolves.toMatchObject([
        {
          scope: "global",
          scopeKey: null,
          sourceProvider: "notion",
          sourceUrl: "https://www.notion.so/general-training",
          content: "Global guidance"
        },
        {
          scope: "project",
          scopeKey: "project-alpha",
          sourceProvider: "notion",
          sourceUrl: "https://www.notion.so/project-alpha",
          title: "Project Alpha",
          content: "Alpha training body"
        },
        {
          scope: "project",
          scopeKey: "project-beta",
          sourceProvider: "notion",
          sourceUrl: "https://www.notion.so/project-beta",
          title: "Project Beta",
          content: "Beta training body"
        }
      ]);

      const syncedProjects = await context.db
        .select({
          projectId: projectDimensions.projectId,
          aiKnowledgeSyncedAt: projectDimensions.aiKnowledgeSyncedAt
        })
        .from(projectDimensions)
        .orderBy(projectDimensions.projectId);

      expect(syncedProjects).toHaveLength(2);
      expect(syncedProjects.map((project) => project.projectId)).toEqual([
        "project-alpha",
        "project-beta"
      ]);
      for (const project of syncedProjects) {
        expect(project.aiKnowledgeSyncedAt).toBeInstanceOf(Date);
      }

      const integrationHealth =
        await context.settings.integrationHealth.findById("notion");
      expect(integrationHealth).toMatchObject({
        status: "healthy",
        metadataJson: {
          knowledgeEntriesTotal: 3,
          projectsSyncedCount: 2,
          orphanRowsCount: 0
        }
      });
      expect(typeof integrationHealth?.metadataJson.lastSuccessAt).toBe("string");
    } finally {
      await context.dispose();
    }
  });

  it("skips orphan rows and logs a warning while syncing other projects", async () => {
    const context = await createTestWorkerContext();
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    };
    const generalPageId = normalizeNotionId("3278a9129211804baa72c76a86d084d0");
    const databaseId = normalizeNotionId("3278a91292118095b86aff5836821428");
    const projectPageId = normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    await seedProjectDimension(context, {
      projectId: "project-alpha",
      projectName: "Project Alpha"
    });

    const client = createFakeNotionClient({
      pages: {
        [generalPageId]: buildPage({
          id: generalPageId,
          title: "General Training",
          lastEditedTime: "2026-04-21T12:00:00.000Z",
          url: "https://www.notion.so/general-training"
        }),
        [projectPageId]: buildPage({
          id: projectPageId,
          title: "Project Alpha",
          lastEditedTime: "2026-04-21T12:05:00.000Z",
          url: "https://www.notion.so/project-alpha",
          properties: buildProjectRow({
            id: projectPageId,
            name: "Project Alpha",
            projectId: "project-alpha",
            lastEditedTime: "2026-04-21T12:05:00.000Z",
            url: "https://www.notion.so/project-alpha"
          }).properties
        })
      },
      blockChildren: {
        [generalPageId]: [
          {
            results: [buildParagraphBlock("66666666666666666666666666666666", "Global guidance")],
            has_more: false,
            next_cursor: null
          }
        ],
        [projectPageId]: [
          {
            results: [buildParagraphBlock("77777777777777777777777777777777", "Alpha body")],
            has_more: false,
            next_cursor: null
          }
        ]
      },
      databaseResponses: {
        [databaseId]: [
          {
            results: [
              buildProjectRow({
                id: projectPageId,
                name: "Project Alpha",
                projectId: "project-alpha",
                lastEditedTime: "2026-04-21T12:05:00.000Z",
                url: "https://www.notion.so/project-alpha"
              }),
              buildProjectRow({
                id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                name: "Unknown Project",
                projectId: "project-unknown",
                lastEditedTime: "2026-04-21T12:06:00.000Z",
                url: "https://www.notion.so/project-unknown"
              })
            ],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    try {
      const result = await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: () => client,
        logger,
        sleep: () => Promise.resolve()
      });

      expect(result).toMatchObject({
        status: "healthy",
        projectsSyncedCount: 1,
        orphanRowsCount: 1
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("project-unknown")
      );
    } finally {
      await context.dispose();
    }
  });

  it("uses the newest row when Project ID duplicates exist", async () => {
    const context = await createTestWorkerContext();
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    };
    const generalPageId = normalizeNotionId("3278a9129211804baa72c76a86d084d0");
    const databaseId = normalizeNotionId("3278a91292118095b86aff5836821428");
    const olderRowId = normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const newerRowId = normalizeNotionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    await seedProjectDimension(context, {
      projectId: "project-alpha",
      projectName: "Project Alpha"
    });

    const client = createFakeNotionClient({
      pages: {
        [generalPageId]: buildPage({
          id: generalPageId,
          title: "General Training",
          lastEditedTime: "2026-04-21T12:00:00.000Z",
          url: "https://www.notion.so/general-training"
        }),
        [newerRowId]: buildPage({
          id: newerRowId,
          title: "Project Alpha New",
          lastEditedTime: "2026-04-21T12:10:00.000Z",
          url: "https://www.notion.so/project-alpha-new",
          properties: buildProjectRow({
            id: newerRowId,
            name: "Project Alpha New",
            projectId: "project-alpha",
            lastEditedTime: "2026-04-21T12:10:00.000Z",
            url: "https://www.notion.so/project-alpha-new"
          }).properties
        })
      },
      blockChildren: {
        [generalPageId]: [
          {
            results: [buildParagraphBlock("88888888888888888888888888888888", "Global guidance")],
            has_more: false,
            next_cursor: null
          }
        ],
        [newerRowId]: [
          {
            results: [buildParagraphBlock("99999999999999999999999999999999", "Newest body wins")],
            has_more: false,
            next_cursor: null
          }
        ]
      },
      databaseResponses: {
        [databaseId]: [
          {
            results: [
              buildProjectRow({
                id: olderRowId,
                name: "Project Alpha Old",
                projectId: "project-alpha",
                lastEditedTime: "2026-04-21T12:05:00.000Z",
                url: "https://www.notion.so/project-alpha-old"
              }),
              buildProjectRow({
                id: newerRowId,
                name: "Project Alpha New",
                projectId: "project-alpha",
                lastEditedTime: "2026-04-21T12:10:00.000Z",
                url: "https://www.notion.so/project-alpha-new"
              })
            ],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    try {
      const result = await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: () => client,
        logger,
        sleep: () => Promise.resolve()
      });

      expect(result).toMatchObject({
        status: "healthy",
        projectsSyncedCount: 1
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Duplicate Notion Project Training rows")
      );

      const projectRows = (await listKnowledgeEntries(context)).filter(
        (row) => row.scope === "project"
      );
      expect(projectRows).toHaveLength(1);
      expect(projectRows[0]).toMatchObject({
        sourceId: newerRowId,
        content: "Newest body wins"
      });
    } finally {
      await context.dispose();
    }
  });

  it("skips ai_knowledge_entries updates when content is unchanged", async () => {
    const context = await createTestWorkerContext();
    const generalPageId = normalizeNotionId("3278a9129211804baa72c76a86d084d0");
    const databaseId = normalizeNotionId("3278a91292118095b86aff5836821428");
    const projectPageId = normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    await seedProjectDimension(context, {
      projectId: "project-alpha",
      projectName: "Project Alpha"
    });

    const buildClient = () =>
      createFakeNotionClient({
        pages: {
          [generalPageId]: buildPage({
            id: generalPageId,
            title: "General Training",
            lastEditedTime: "2026-04-21T12:00:00.000Z",
            url: "https://www.notion.so/general-training"
          }),
          [projectPageId]: buildPage({
            id: projectPageId,
            title: "Project Alpha",
            lastEditedTime: "2026-04-21T12:05:00.000Z",
            url: "https://www.notion.so/project-alpha",
            properties: buildProjectRow({
              id: projectPageId,
              name: "Project Alpha",
              projectId: "project-alpha",
              lastEditedTime: "2026-04-21T12:05:00.000Z",
              url: "https://www.notion.so/project-alpha"
            }).properties
          })
        },
        blockChildren: {
          [generalPageId]: [
            {
              results: [buildParagraphBlock("abababababababababababababababab", "Global guidance")],
              has_more: false,
              next_cursor: null
            }
          ],
          [projectPageId]: [
            {
              results: [buildParagraphBlock("cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd", "Stable body")],
              has_more: false,
              next_cursor: null
            }
          ]
        },
        databaseResponses: {
          [databaseId]: [
            {
              results: [
                buildProjectRow({
                  id: projectPageId,
                  name: "Project Alpha",
                  projectId: "project-alpha",
                  lastEditedTime: "2026-04-21T12:05:00.000Z",
                  url: "https://www.notion.so/project-alpha"
                })
              ],
              has_more: false,
              next_cursor: null
            }
          ]
        }
      });

    try {
      await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: buildClient,
        sleep: () => Promise.resolve()
      });

      const updateSpy = vi.spyOn(context.db, "update");

      await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: buildClient,
        sleep: () => Promise.resolve()
      });

      expect(
        updateSpy.mock.calls.some(([table]) => table === aiKnowledgeEntries)
      ).toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("deletes knowledge rows that disappear from Notion on the next sync", async () => {
    const context = await createTestWorkerContext();
    const generalPageId = normalizeNotionId("3278a9129211804baa72c76a86d084d0");
    const databaseId = normalizeNotionId("3278a91292118095b86aff5836821428");
    const projectPageId = normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    await seedProjectDimension(context, {
      projectId: "project-alpha",
      projectName: "Project Alpha"
    });

    const firstClient = createFakeNotionClient({
      pages: {
        [generalPageId]: buildPage({
          id: generalPageId,
          title: "General Training",
          lastEditedTime: "2026-04-21T12:00:00.000Z",
          url: "https://www.notion.so/general-training"
        }),
        [projectPageId]: buildPage({
          id: projectPageId,
          title: "Project Alpha",
          lastEditedTime: "2026-04-21T12:05:00.000Z",
          url: "https://www.notion.so/project-alpha",
          properties: buildProjectRow({
            id: projectPageId,
            name: "Project Alpha",
            projectId: "project-alpha",
            lastEditedTime: "2026-04-21T12:05:00.000Z",
            url: "https://www.notion.so/project-alpha"
          }).properties
        })
      },
      blockChildren: {
        [generalPageId]: [
          {
            results: [buildParagraphBlock("dededededededededededededededede", "Global guidance")],
            has_more: false,
            next_cursor: null
          }
        ],
        [projectPageId]: [
          {
            results: [buildParagraphBlock("efefefefefefefefefefefefefefefef", "Project body")],
            has_more: false,
            next_cursor: null
          }
        ]
      },
      databaseResponses: {
        [databaseId]: [
          {
            results: [
              buildProjectRow({
                id: projectPageId,
                name: "Project Alpha",
                projectId: "project-alpha",
                lastEditedTime: "2026-04-21T12:05:00.000Z",
                url: "https://www.notion.so/project-alpha"
              })
            ],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    const secondClient = createFakeNotionClient({
      pages: {
        [generalPageId]: buildPage({
          id: generalPageId,
          title: "General Training",
          lastEditedTime: "2026-04-21T12:00:00.000Z",
          url: "https://www.notion.so/general-training"
        })
      },
      blockChildren: {
        [generalPageId]: [
          {
            results: [buildParagraphBlock("f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0", "Global guidance")],
            has_more: false,
            next_cursor: null
          }
        ]
      },
      databaseResponses: {
        [databaseId]: [
          {
            results: [],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    try {
      await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: () => firstClient,
        sleep: () => Promise.resolve()
      });

      await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: () => secondClient,
        sleep: () => Promise.resolve()
      });

      const projectRows = (await listKnowledgeEntries(context)).filter(
        (row) => row.scope === "project"
      );
      expect(projectRows).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("records partial progress and writes needs_attention health when Notion fails mid-sync", async () => {
    const context = await createTestWorkerContext();
    const generalPageId = normalizeNotionId("3278a9129211804baa72c76a86d084d0");
    const databaseId = normalizeNotionId("3278a91292118095b86aff5836821428");
    const projectAlphaPageId = normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const projectBetaPageId = normalizeNotionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    await seedProjectDimension(context, {
      projectId: "project-alpha",
      projectName: "Project Alpha"
    });
    await seedProjectDimension(context, {
      projectId: "project-beta",
      projectName: "Project Beta"
    });

    const client = createFakeNotionClient({
      pages: {
        [generalPageId]: buildPage({
          id: generalPageId,
          title: "General Training",
          lastEditedTime: "2026-04-21T12:00:00.000Z",
          url: "https://www.notion.so/general-training"
        }),
        [projectAlphaPageId]: buildPage({
          id: projectAlphaPageId,
          title: "Project Alpha",
          lastEditedTime: "2026-04-21T12:05:00.000Z",
          url: "https://www.notion.so/project-alpha",
          properties: buildProjectRow({
            id: projectAlphaPageId,
            name: "Project Alpha",
            projectId: "project-alpha",
            lastEditedTime: "2026-04-21T12:05:00.000Z",
            url: "https://www.notion.so/project-alpha"
          }).properties
        })
      },
      blockChildren: {
        [generalPageId]: [
          {
            results: [buildParagraphBlock("01010101010101010101010101010101", "Global guidance")],
            has_more: false,
            next_cursor: null
          }
        ],
        [projectAlphaPageId]: [
          {
            results: [buildParagraphBlock("02020202020202020202020202020202", "Alpha body")],
            has_more: false,
            next_cursor: null
          }
        ]
      },
      databaseResponses: {
        [databaseId]: [
          {
            results: [
              buildProjectRow({
                id: projectAlphaPageId,
                name: "Project Alpha",
                projectId: "project-alpha",
                lastEditedTime: "2026-04-21T12:05:00.000Z",
                url: "https://www.notion.so/project-alpha"
              }),
              buildProjectRow({
                id: projectBetaPageId,
                name: "Project Beta",
                projectId: "project-beta",
                lastEditedTime: "2026-04-21T12:06:00.000Z",
                url: "https://www.notion.so/project-beta"
              })
            ],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    const failingClient: NotionClient = {
      ...client,
      retrievePage(pageId) {
        if (normalizeNotionId(pageId) === projectBetaPageId) {
          return Promise.reject(
            new NotionProviderError({
              code: "rate_limited",
              message: "Too many requests",
              retryable: true,
              status: 429,
              retryAfterSeconds: 5
            })
          );
        }

        return client.retrievePage(pageId);
      }
    };

    try {
      const result = await runNotionKnowledgeSync({
        db: context.db,
        integrationHealth: context.settings.integrationHealth,
        notion: {
          apiKey: "notion-token",
          generalTrainingPageId: generalPageId,
          projectTrainingDatabaseId: databaseId
        },
        createClient: () => failingClient,
        sleep: () => Promise.resolve()
      });

      expect(result).toMatchObject({
        status: "error",
        projectsSyncedCount: 1
      });

      const storedRows = await listKnowledgeEntries(context);
      expect(storedRows.map((row) => row.scopeKey)).toEqual([
        null,
        "project-alpha"
      ]);

      const integrationHealth =
        await context.settings.integrationHealth.findById("notion");
      expect(integrationHealth).toMatchObject({
        status: "needs_attention"
      });
      expect(integrationHealth?.detail ?? "").toContain("rate_limited");
    } finally {
      await context.dispose();
    }
  });
});
