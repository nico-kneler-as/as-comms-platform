import { describe, expect, it } from "vitest";

import {
  classifyNotionError,
  fetchPageContent,
  normalizeNotionId,
  queryDatabase,
  type NotionClient
} from "../src/index.js";

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

function createFakeNotionClient(input: {
  readonly pages?: Record<string, Record<string, unknown>>;
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

  return {
    retrievePage(pageId) {
      const page = input.pages?.[normalizeNotionId(pageId)];
      if (page === undefined) {
        return Promise.reject(new Error(`Missing page fixture for ${pageId}`));
      }

      return Promise.resolve(page);
    },
    listBlockChildren({ blockId }) {
      const response = blockQueues.get(normalizeNotionId(blockId))?.shift();
      return Promise.resolve(
        response ?? {
          results: [],
          has_more: false,
          next_cursor: null
        }
      );
    },
    queryDatabase({ databaseId }) {
      const response = databaseQueues.get(normalizeNotionId(databaseId))?.shift();
      return Promise.resolve(
        response ?? {
          results: [],
          has_more: false,
          next_cursor: null
        }
      );
    }
  };
}

describe("Notion provider helpers", () => {
  it("flattens supported Notion block types into markdown", async () => {
    const pageId = normalizeNotionId("3278a9129211804baa72c76a86d084d0");
    const tableId = normalizeNotionId("11111111111111111111111111111111");
    const client = createFakeNotionClient({
      pages: {
        [pageId]: {
          id: pageId,
          url: "https://www.notion.so/general-training",
          last_edited_time: "2026-04-21T12:00:00.000Z",
          properties: {
            title: {
              type: "title",
              title: buildRichText("General Training")
            }
          }
        }
      },
      blockChildren: {
        [pageId]: [
          {
            results: [
              {
                id: normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                type: "paragraph",
                has_children: false,
                paragraph: {
                  rich_text: buildRichText("Paragraph body")
                }
              },
              {
                id: normalizeNotionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
                type: "heading_1",
                has_children: false,
                heading_1: {
                  rich_text: buildRichText("Heading One")
                }
              },
              {
                id: normalizeNotionId("cccccccccccccccccccccccccccccccc"),
                type: "heading_2",
                has_children: false,
                heading_2: {
                  rich_text: buildRichText("Heading Two")
                }
              },
              {
                id: normalizeNotionId("dddddddddddddddddddddddddddddddd"),
                type: "heading_3",
                has_children: false,
                heading_3: {
                  rich_text: buildRichText("Heading Three")
                }
              },
              {
                id: normalizeNotionId("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
                type: "bulleted_list_item",
                has_children: false,
                bulleted_list_item: {
                  rich_text: buildRichText("Bullet Item")
                }
              },
              {
                id: normalizeNotionId("ffffffffffffffffffffffffffffffff"),
                type: "numbered_list_item",
                has_children: false,
                numbered_list_item: {
                  rich_text: buildRichText("Numbered Item")
                }
              },
              {
                id: normalizeNotionId("12121212121212121212121212121212"),
                type: "code",
                has_children: false,
                code: {
                  language: "ts",
                  rich_text: buildRichText("const answer = 42;")
                }
              },
              {
                id: tableId,
                type: "table",
                has_children: true,
                table: {
                  has_column_header: true,
                  table_width: 2
                }
              }
            ],
            has_more: false,
            next_cursor: null
          }
        ],
        [tableId]: [
          {
            results: [
              {
                id: normalizeNotionId("22222222222222222222222222222222"),
                type: "table_row",
                table_row: {
                  cells: [buildRichText("Column A"), buildRichText("Column B")]
                }
              },
              {
                id: normalizeNotionId("33333333333333333333333333333333"),
                type: "table_row",
                table_row: {
                  cells: [buildRichText("Value A"), buildRichText("Value B")]
                }
              }
            ],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    const result = await fetchPageContent(client, pageId);

    expect(result.title).toBe("General Training");
    expect(result.markdown).toContain("Paragraph body");
    expect(result.markdown).toContain("# Heading One");
    expect(result.markdown).toContain("## Heading Two");
    expect(result.markdown).toContain("### Heading Three");
    expect(result.markdown).toContain("- Bullet Item");
    expect(result.markdown).toContain("1. Numbered Item");
    expect(result.markdown).toContain("```ts\nconst answer = 42;\n```");
    expect(result.markdown).toContain("| Column A | Column B |");
    expect(result.markdown).toContain("| Value A | Value B |");
  });

  it("streams paginated database rows", async () => {
    const databaseId = normalizeNotionId("3278a91292118095b86aff5836821428");
    const client = createFakeNotionClient({
      databaseResponses: {
        [databaseId]: [
          {
            results: [
              {
                id: normalizeNotionId("44444444444444444444444444444444"),
                url: "https://www.notion.so/project-one",
                last_edited_time: "2026-04-21T12:00:00.000Z",
                properties: {
                  Name: {
                    type: "title",
                    title: buildRichText("Project One")
                  }
                }
              }
            ],
            has_more: true,
            next_cursor: "cursor:page:2"
          },
          {
            results: [
              {
                id: normalizeNotionId("55555555555555555555555555555555"),
                url: "https://www.notion.so/project-two",
                last_edited_time: "2026-04-21T12:05:00.000Z",
                properties: {
                  Name: {
                    type: "title",
                    title: buildRichText("Project Two")
                  }
                }
              }
            ],
            has_more: false,
            next_cursor: null
          }
        ]
      }
    });

    const rows: { id: string; url: string | null }[] = [];
    for await (const row of queryDatabase(client, databaseId)) {
      rows.push({
        id: row.id,
        url: row.url
      });
    }

    expect(rows).toEqual([
      {
        id: normalizeNotionId("44444444444444444444444444444444"),
        url: "https://www.notion.so/project-one"
      },
      {
        id: normalizeNotionId("55555555555555555555555555555555"),
        url: "https://www.notion.so/project-two"
      }
    ]);
  });

  it("classifies Notion rate limits with retry-after metadata", () => {
    const error = classifyNotionError(
      {
        status: 429,
        code: "rate_limited",
        message: "Too many requests",
        headers: new Headers({
          "retry-after": "7"
        })
      },
      "Notion database query"
    );

    expect(error).toMatchObject({
      code: "rate_limited",
      retryable: true,
      status: 429,
      retryAfterSeconds: 7
    });
  });
});
