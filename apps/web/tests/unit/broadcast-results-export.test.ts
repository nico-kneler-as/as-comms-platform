import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server"
import { sql } from "drizzle-orm"

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn()
}))

const getCurrentUser = vi.hoisted(() => vi.fn())
vi.mock("@/src/server/auth/session", () => ({ getCurrentUser }))

const requireVolunteerSession = vi.hoisted(() => vi.fn())
vi.mock("@/src/server/auth/workspace-access", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireVolunteerSession
}))

import {
  buildRecipientResultsCsv,
  type RecipientResultRow
} from "../../app/broadcasts/_lib/broadcast-results"
import { GET as downloadRecipientsCsv } from "../../app/broadcasts/[runId]/recipients.csv/route"
import {
  registerConnectorTools,
  type McpToolCallContext,
  type McpToolInputSchema
} from "../../src/server/mcp"
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit"
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime
} from "../../src/server/stage1-runtime.test-support"

type ToolCallback = (
  input: unknown,
  context?: McpToolCallContext
) => Promise<CallToolResult>

function registerTools(): Map<string, ToolCallback> {
  const callbacks = new Map<string, ToolCallback>()
  registerConnectorTools(
    {
      registerTool: (
        name: string,
        _config: { inputSchema?: McpToolInputSchema },
        callback: ToolCallback
      ) => {
        callbacks.set(name, callback)
        return {}
      }
    },
    { environmentName: "test" }
  )
  return callbacks
}

const operatorContext: McpToolCallContext = {
  http: {
    authInfo: {
      token: "access-token",
      clientId: "client-id",
      scopes: ["mcp:read"],
      extra: {
        userEmail: "operator@adventurescientists.org",
        userId: "user-1",
        userRole: "operator"
      }
    } satisfies AuthInfo
  }
}

const RUN_ID = "run-insiders-results"

async function seedSend(runtime: Stage1WebTestRuntime): Promise<void> {
  const campaigns = runtime.runtime.campaigns
  await campaigns.campaignRuns.create({
    id: RUN_ID,
    kind: "newsletter",
    launchType: "normal_email",
    projectId: null,
    name: "Nov Insiders Update",
    fromEmail: "gtreinish@adventurescientists.org",
    fromName: "Gregg Treinish",
    replyToEmail: "gtreinish@adventurescientists.org",
    subjectTemplate: "Insiders",
    bodyHtmlTemplate: "<p>Hi</p>",
    bodyTextTemplate: "Hi",
    preheader: null,
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
      initialFilter: "csv_upload"
    },
    audienceSize: 3,
    createdByUserId: null,
    lastEditedByUserId: null
  })
  await campaigns.audienceSnapshots.bulkInsert(
    RUN_ID,
    (
      [
        ["ada", "Ada"],
        ["grace", "Grace"],
        ["bounced", null]
      ] as const
    ).map(([name, firstName]) => ({
      id: `snapshot-${name}`,
      contactId: null,
      newsletterSubscriberId: null,
      frozenEmail: `${name}@example.org`,
      frozenFirstName: firstName,
      frozenProjectName: null,
      frozenProjectId: null,
      frozenAliasEmail: "gtreinish@adventurescientists.org",
      unsubscribeToken: `token-${name}`,
      deliveryStatus: "sent",
      providerMessageId: `message-${name}`
    }))
  )
  await runtime.context.db.execute(sql`
    update campaign_runs set state = 'complete', started_at = '2026-11-13T19:46:00Z'
    where id = ${RUN_ID}
  `)
  await runtime.context.db.execute(sql`
    update audience_snapshots set
      sent_at = '2026-11-13T19:46:10Z',
      delivery_status = case when id = 'snapshot-bounced' then 'bounced' else 'delivered' end,
      delivered_at = case when id = 'snapshot-bounced' then null else '2026-11-13T19:46:20Z'::timestamptz end,
      bounced_at = case when id = 'snapshot-bounced' then '2026-11-13T19:46:30Z'::timestamptz end,
      opened_at = case when id = 'snapshot-ada' then '2026-11-13T20:00:00Z'::timestamptz end,
      clicked_at = case when id = 'snapshot-ada' then '2026-11-13T20:01:00Z'::timestamptz end
    where campaign_run_id = ${RUN_ID}
  `)
}

function row(overrides: Partial<RecipientResultRow>): RecipientResultRow {
  return {
    name: "Ada",
    email: "ada@example.org",
    phone: null,
    project: null,
    result: "clicked",
    resultLabel: "Clicked",
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    unsubscribedAt: null,
    markedSpamAt: null,
    lastEventAt: null,
    ...overrides
  }
}

describe("buildRecipientResultsCsv", () => {
  it("writes a header, quotes commas and quotes, and neutralizes formulas", () => {
    const csv = buildRecipientResultsCsv([
      row({ name: 'Jim and Carole, "JC"' }),
      row({ name: "=HYPERLINK(\"x\")", email: "@evil.example" })
    ])
    const lines = csv.trimEnd().split("\r\n")

    expect(lines[0]).toBe(
      "Name,Email,Phone,Project,Result,Sent at (UTC),Delivered at (UTC),Opened at (UTC),Clicked at (UTC),Bounced at (UTC),Unsubscribed at (UTC),Marked as spam at (UTC),Last event at (UTC)"
    )
    expect(lines[1]).toBe('"Jim and Carole, ""JC""",ada@example.org,,,Clicked,,,,,,,,')
    expect(lines[2]?.startsWith(`"'=HYPERLINK(""x"")",'@evil.example`)).toBe(true)
  })
})

describe("broadcast results: CSV download and MCP tools", () => {
  let runtime: Stage1WebTestRuntime | null = null
  let tools: Map<string, ToolCallback>

  beforeEach(async () => {
    getCurrentUser.mockResolvedValue(null)
    requireVolunteerSession.mockResolvedValue({ id: "user-1", role: "operator" })
    runtime = await createStage1WebTestRuntime()
    tools = registerTools()
    await seedSend(runtime)
  })

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests()
    await runtime?.dispose()
    runtime = null
  })

  it("downloads every recipient with their results, honouring the filter", async () => {
    const all = await downloadRecipientsCsv(
      new Request(`http://localhost/broadcasts/${RUN_ID}/recipients.csv`),
      { params: Promise.resolve({ runId: RUN_ID }) }
    )
    const opened = await downloadRecipientsCsv(
      new Request(`http://localhost/broadcasts/${RUN_ID}/recipients.csv?filter=opened`),
      { params: Promise.resolve({ runId: RUN_ID }) }
    )

    expect(all.headers.get("content-type")).toContain("text/csv")
    expect(all.headers.get("content-disposition")).toContain(
      'filename="nov-insiders-update-recipients.csv"'
    )
    const allLines = (await all.text()).trimEnd().split("\r\n")
    expect(allLines).toHaveLength(4)
    expect(allLines[1]).toContain("ada@example.org,,,Clicked,2026-11-13T19:46:10.000Z")
    expect(allLines[2]).toContain("bounced@example.org,,,Bounced")
    expect(allLines[3]).toContain("grace@example.org,,,Delivered")
    const openedLines = (await opened.text()).trimEnd().split("\r\n")
    expect(openedLines).toHaveLength(2)
    expect(opened.headers.get("content-disposition")).toContain("-recipients-opened.csv")
  })

  it("lists the send by name with totals", async () => {
    const callback = tools.get("list_broadcasts")
    const result = await callback?.({ query: "insiders" }, operatorContext)

    expect(result?.isError).not.toBe(true)
    expect(result?.structuredContent).toMatchObject({
      broadcasts: [
        {
          runId: RUN_ID,
          name: "Nov Insiders Update",
          channel: "email",
          totals: { recipients: 3, opened: 1, clicked: 1, bounced: 1 }
        }
      ]
    })
  })

  it("returns per-recipient results in pages, filtered like the table", async () => {
    const callback = tools.get("get_broadcast_results")
    const page = await callback?.({ runId: RUN_ID, limit: 2 }, operatorContext)
    const clicked = await callback?.(
      { runId: RUN_ID, filter: "clicked" },
      operatorContext
    )

    expect(page?.structuredContent).toMatchObject({
      totals: { recipients: 3, delivered: 2, opened: 1, clicked: 1, bounced: 1 },
      recipients: [
        { email: "ada@example.org", result: "Clicked", openedAt: "2026-11-13T20:00:00.000Z" },
        { email: "bounced@example.org", result: "Bounced" }
      ],
      page: { offset: 0, returned: 2, matching: 3, nextOffset: 2 }
    })
    expect(clicked?.structuredContent).toMatchObject({
      recipients: [{ email: "ada@example.org" }],
      page: { matching: 1, nextOffset: null }
    })
  })
})
