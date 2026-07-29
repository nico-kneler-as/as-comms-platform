import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { AnyZodObject } from "zod"

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn()
}))

const getCurrentUser = vi.hoisted(() => vi.fn())

vi.mock("@/src/server/auth/session", () => ({
  getCurrentUser
}))

import { getInboxList } from "../../app/inbox/_lib/selectors"
import { DEFAULT_MCP_RESPONSE_BUDGET_CAP, registerConnectorTools } from "../../src/server/mcp"
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit"
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime
} from "../../src/server/stage1-runtime.test-support"
import {
  seedInboxContact,
  seedInboxEmailEvent,
  seedInboxProjection
} from "./inbox-stage1-helpers"

interface RegisteredToolCapture {
  config: {
    title: string
    description: string
    inputSchema: AnyZodObject
  }
  callback: (
    input: unknown,
    extra?: {
      authInfo?: AuthInfo
    }
  ) => Promise<CallToolResult>
}

function createFakeServer() {
  const registrations = new Map<string, RegisteredToolCapture>()

  const server = {
    registerTool: vi.fn(
      (
        name: string,
        config: {
          title: string
          description: string
          inputSchema: AnyZodObject
        },
        callback: RegisteredToolCapture["callback"]
      ) => {
        registrations.set(name, { config, callback })
        return {} as never
      }
    )
  }

  return { server, registrations }
}

function getRegistration(
  registrations: Map<string, RegisteredToolCapture>,
  toolName: string
): RegisteredToolCapture {
  const registration = registrations.get(toolName)

  if (registration === undefined) {
    throw new Error(`Missing registration for ${toolName}`)
  }

  return registration
}

function buildAuthInfo(
  overrides: Partial<NonNullable<AuthInfo["extra"]>> = {}
): AuthInfo {
  return {
    token: "access-token",
    clientId: "client-id",
    scopes: ["mcp:read"],
    extra: {
      userEmail: "operator@adventurescientists.org",
      userId: "user-1",
      userRole: "operator",
      ...overrides
    }
  }
}

function firstTextContent(result: CallToolResult): string | null {
  const firstContent = result.content[0]

  return firstContent?.type === "text" ? firstContent.text : null
}

async function seedUnreadContact(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly contactId: string
    readonly displayName: string
    readonly primaryEmail: string
    readonly salesforceContactId?: string | null
    readonly subject?: string
    readonly snippet?: string
    readonly occurredAt?: string
  }
): Promise<void> {
  await seedInboxContact(runtime.context, {
    contactId: input.contactId,
    salesforceContactId: input.salesforceContactId ?? `${input.contactId}:sf`,
    displayName: input.displayName,
    primaryEmail: input.primaryEmail,
    primaryPhone: "+15550000001",
    projectId: "project:amazon-basin",
    projectName: "Amazon Basin Research",
    membershipId: `membership:${input.contactId}`,
    membershipStatus: "active"
  })
  const latest = await seedInboxEmailEvent(runtime.context, {
    id: `${input.contactId}:inbound-1`,
    contactId: input.contactId,
    occurredAt: input.occurredAt ?? "2026-04-14T13:00:00.000Z",
    direction: "inbound",
    subject: input.subject ?? "Re: Amazon Basin equipment list",
    snippet:
      input.snippet ??
      "Following up on the field study logistics for the Amazon basin project."
  })
  await seedInboxProjection(runtime.context, {
    contactId: input.contactId,
    bucket: "New",
    needsFollowUp: true,
    hasUnresolved: false,
    lastInboundAt: input.occurredAt ?? "2026-04-14T13:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: input.occurredAt ?? "2026-04-14T13:00:00.000Z",
    snippet:
      input.snippet ??
      "Following up on the field study logistics for the Amazon basin project.",
    lastCanonicalEventId: latest.canonicalEventId,
    lastEventType: "communication.email.inbound"
  })
}

describe("mcp inbox tools", () => {
  let runtime: Stage1WebTestRuntime | null = null
  let registrations: Map<string, RegisteredToolCapture>

  beforeEach(async () => {
    getCurrentUser.mockReset()
    getCurrentUser.mockResolvedValue(null)
    runtime = await createStage1WebTestRuntime()

    const fakeServer = createFakeServer()
    registrations = fakeServer.registrations
    registerConnectorTools(fakeServer.server, {
      environmentName: "test"
    })
  })

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests()
    await runtime?.dispose()
    runtime = null
  })

  it("reads a contact timeline without writing any read audit or changing unread state", async () => {
    if (runtime === null) {
      throw new Error("Expected test runtime")
    }

    await seedUnreadContact(runtime, {
      contactId: "contact:sarah-martinez",
      displayName: "Sarah Martinez",
      primaryEmail: "sarah@example.org"
    })
    const unreadBefore = await getInboxList("unread")

    const result = await getRegistration(
      registrations,
      "get_contact_timeline"
    ).callback(
      {
        contactId: "contact:sarah-martinez"
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    await waitForPendingSecurityAuditTasksForTests()

    const audits = await runtime.context.repositories.auditEvidence.listByEntity({
      entityType: "contact",
      entityId: "contact:sarah-martinez"
    })
    const projection =
      await runtime.context.repositories.inboxProjection.findByContactId(
        "contact:sarah-martinez"
      )
    const unreadAfter = await getInboxList("unread")

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      contactId: "contact:sarah-martinez"
    })
    expect(audits).toEqual([])
    expect(projection?.bucket).toBe("New")
    expect(unreadBefore.items.map((item) => item.contactId)).toContain(
      "contact:sarah-martinez"
    )
    expect(unreadAfter.items.map((item) => item.contactId)).toContain(
      "contact:sarah-martinez"
    )
  })

  it.each([
    ["search_contacts", { query: "Sar" }],
    ["get_contact_summary", { contactId: "contact:any" }],
    ["get_contact_timeline", { contactId: "contact:any" }],
    ["get_inbox_queue", { folder: "inbox" }],
    ["get_workload_summary", {}],
    ["get_sync_freshness", {}]
  ])(
    "fails closed when the authenticated operator is missing for %s",
    async (toolName, input) => {
      const result = await getRegistration(registrations, toolName).callback(
        input
      )

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          code: "tool_error"
        },
        content: [
          {
            type: "text",
            text: "Authenticated operator required."
          }
        ]
      })
    }
  )

  it("returns an explicit not-found payload for a missing contact summary", async () => {
    const result = await getRegistration(
      registrations,
      "get_contact_summary"
    ).callback(
      {
        contactId: "contact:missing"
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      status: "not_found",
      contactId: "contact:missing"
    })
  })

  it("returns an explicit not-found payload for a missing contact timeline", async () => {
    const result = await getRegistration(
      registrations,
      "get_contact_timeline"
    ).callback(
      {
        contactId: "contact:missing"
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      status: "not_found",
      contactId: "contact:missing"
    })
  })

  it("returns a validation error for a query below the three-character minimum", async () => {
    const result = await getRegistration(registrations, "search_contacts").callback(
      {
        query: "ab"
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        code: "validation_error"
      }
    })
    expect(firstTextContent(result)).toContain("3")
  })

  it("returns a validation error for an unknown inbox folder and names the valid ones", async () => {
    const result = await getRegistration(registrations, "get_inbox_queue").callback(
      {
        folder: "later"
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        code: "validation_error"
      }
    })
    expect(firstTextContent(result)).toContain("inbox")
    expect(firstTextContent(result)).toContain("unread")
    expect(firstTextContent(result)).toContain("follow-up")
  })

  it("treats an empty-string projectId and cursor as no filter instead of a validation error", async () => {
    // A model routinely sends "" to mean "unfiltered". Rejecting it would turn
    // an ordinary queue question into a validation error.
    const result = await getRegistration(
      registrations,
      "get_inbox_queue"
    ).callback(
      {
        folder: "inbox",
        projectId: "",
        cursor: ""
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      folder: "inbox",
      selectedProjectId: null
    })
  })

  it("preserves selector totals when search results are truncated by the response budget", async () => {
    if (runtime === null) {
      throw new Error("Expected test runtime")
    }

    for (let index = 0; index < DEFAULT_MCP_RESPONSE_BUDGET_CAP + 1; index += 1) {
      await seedInboxContact(runtime.context, {
        contactId: `contact:ridge-${index.toString().padStart(2, "0")}`,
        salesforceContactId: `003-ridge-${index.toString().padStart(2, "0")}`,
        displayName: `Ridge Volunteer ${index.toString().padStart(2, "0")}`,
        primaryEmail: `ridge-${index.toString().padStart(2, "0")}@example.org`,
        primaryPhone: `+1555000${index.toString().padStart(4, "0")}`,
        projectId: "project:ridge-monitoring",
        projectName: "Ridge Monitoring",
        membershipId: `membership:ridge-${index.toString().padStart(2, "0")}`,
        membershipStatus: "active"
      })
    }

    const result = await getRegistration(registrations, "search_contacts").callback(
      {
        query: "Ridge"
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      volunteers: {
        totals: {
          available: DEFAULT_MCP_RESPONSE_BUDGET_CAP + 1,
          returned: DEFAULT_MCP_RESPONSE_BUDGET_CAP
        },
        truncated: true,
        cap: DEFAULT_MCP_RESPONSE_BUDGET_CAP
      }
    })
  })

  it("applies the per-tool PII allowlist to queue rows", async () => {
    if (runtime === null) {
      throw new Error("Expected test runtime")
    }

    await seedUnreadContact(runtime, {
      contactId: "contact:queue-pii",
      displayName: "Queue Pii",
      primaryEmail: "queue-pii@example.org"
    })

    const result = await getRegistration(registrations, "get_inbox_queue").callback(
      {
        folder: "inbox"
      },
      {
        authInfo: buildAuthInfo()
      }
    )

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      items: {
        rows: [
          {
            contact: {
              id: "contact:queue-pii",
              displayName: "Queue Pii"
            }
          }
        ]
      }
    })
    const structuredContent: unknown = result.structuredContent
    const queuePayload = structuredContent as {
      items: {
        rows: {
          contact: Record<string, unknown>
        }[]
      }
    }
    const firstRow = queuePayload.items.rows[0]
    expect(firstRow?.contact).not.toHaveProperty("primaryEmail")
    expect(firstRow?.contact).not.toHaveProperty("primaryPhone")
  })
})
