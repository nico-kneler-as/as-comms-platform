import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { UserRecord } from "@as-comms/domain"

const getCurrentUser = vi.hoisted(() => vi.fn())

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn()
}))

vi.mock("@/src/server/auth/session", () => ({
  getCurrentUser
}))

import { POST as MCP_POST } from "../../app/api/mcp/route"
import { POST as TOKEN_POST } from "../../app/api/oauth/token/route"
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime
} from "../../src/server/stage1-runtime.test-support"
import {
  seedInboxContact,
  seedInboxEmailEvent,
  seedInboxProjection
} from "./inbox-stage1-helpers"

const MCP_ACCEPT = "application/json, text/event-stream"
const CLIENT_ID = "client_test"
const CLIENT_SECRET = "top-secret"
const USER_ID = "user-1"
const RESOURCE = "https://as.example.com/api/mcp"
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback"

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function pkceS256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url")
}

function buildUserRecord(
  overrides: Partial<UserRecord> = {}
): UserRecord {
  const now = new Date("2026-07-29T12:00:00.000Z")

  return {
    id: USER_ID,
    name: "Operator One",
    email: "operator@adventurescientists.org",
    emailVerified: null,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

async function seedTransportInboxFixture(
  runtime: Stage1WebTestRuntime
): Promise<void> {
  await seedInboxContact(runtime.context, {
    contactId: "contact:sarah-martinez",
    salesforceContactId: "003-sarah",
    displayName: "Sarah Martinez",
    primaryEmail: "sarah@example.org",
    primaryPhone: "+15550000001",
    projectId: "project:amazon-basin",
    projectName: "Amazon Basin Research",
    membershipId: "membership:sarah",
    membershipStatus: "active"
  })
  const latest = await seedInboxEmailEvent(runtime.context, {
    id: "sarah-inbound-1",
    contactId: "contact:sarah-martinez",
    occurredAt: "2026-04-14T13:00:00.000Z",
    direction: "inbound",
    subject: "Re: Amazon Basin equipment list",
    snippet:
      "Following up on the field study logistics for the Amazon basin project."
  })
  await seedInboxProjection(runtime.context, {
    contactId: "contact:sarah-martinez",
    bucket: "New",
    needsFollowUp: true,
    hasUnresolved: false,
    lastInboundAt: "2026-04-14T13:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: "2026-04-14T13:00:00.000Z",
    snippet:
      "Following up on the field study logistics for the Amazon basin project.",
    lastCanonicalEventId: latest.canonicalEventId,
    lastEventType: "communication.email.inbound"
  })
}

async function readMcpBody(response: Response): Promise<unknown> {
  const text = await response.text()

  if (!text.startsWith("event:") && !text.includes("data:")) {
    return JSON.parse(text)
  }

  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data:"))

  if (!dataLine) {
    throw new Error(`No SSE data frame in response: ${text}`)
  }

  return JSON.parse(dataLine.slice("data:".length).trim())
}

function mcpRequest(
  body: unknown,
  accessToken: string,
  sessionId?: string
): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: MCP_ACCEPT
  }

  if (sessionId) {
    headers["mcp-session-id"] = sessionId
  }

  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  })
}

const initializeBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "integration-test", version: "1.0.0" }
  }
}

describe("mcp transport (real mcp-handler)", () => {
  let runtime: Stage1WebTestRuntime | null = null

  beforeEach(async () => {
    getCurrentUser.mockReset()
    getCurrentUser.mockResolvedValue(null)
    runtime = await createStage1WebTestRuntime()
    await runtime.context.settings.users.upsert(buildUserRecord())
    await runtime.runtime.oauth.createClient({
      clientId: CLIENT_ID,
      clientSecretHash: sha256Hex(CLIENT_SECRET),
      name: "Claude Connector",
      allowedRedirectUris: [REDIRECT_URI, "http://localhost/callback"]
    })
    vi.stubEnv("MCP_PUBLIC_URL", RESOURCE)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (runtime !== null) {
      await runtime.dispose()
      runtime = null
    }
  })

  async function issueAccessToken(): Promise<string> {
    if (runtime === null) {
      throw new Error("Missing test runtime.")
    }

    const codeVerifier =
      "verifier-1234567890123456789012345678901234567890123"
    const code = "authorization-code"
    await runtime.runtime.oauth.createAuthorizationCode({
      authorizationCodeHash: sha256Hex(code),
      clientId: CLIENT_ID,
      userId: USER_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: pkceS256(codeVerifier),
      scope: "mcp:read offline_access",
      resource: RESOURCE,
      // Relative, NOT an absolute timestamp. The token route reads the real
      // clock, so a hardcoded expiry makes this test pass only until that
      // wall-clock moment and fail every run afterwards.
      expiresAt: new Date(Date.now() + 120_000).toISOString()
    })

    const response = await TOKEN_POST(
      new Request("http://localhost/api/oauth/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          code_verifier: codeVerifier,
          redirect_uri: REDIRECT_URI,
          resource: RESOURCE
        }).toString()
      })
    )

    if (response.status !== 200) {
      throw new Error(`Failed to issue access token: ${await response.text()}`)
    }

    const body = (await response.json()) as {
      access_token?: string
    }

    if (!body.access_token) {
      throw new Error("Token response did not include an access token.")
    }

    return body.access_token
  }

  it("completes an MCP initialize handshake and reports server info", async () => {
    const accessToken = await issueAccessToken()
    const response = await MCP_POST(mcpRequest(initializeBody, accessToken))

    expect(response.status).toBe(200)

    const payload = (await readMcpBody(response)) as {
      result?: {
        serverInfo?: { name?: string; version?: string }
        protocolVersion?: string
      }
      error?: unknown
    }

    expect(payload.error).toBeUndefined()
    expect(payload.result?.serverInfo?.name).toBe("as-comms-mcp")
    expect(payload.result?.serverInfo?.version).toBe("0.1.0")
    expect(payload.result?.protocolVersion).toBeTruthy()
  })

  it("advertises the full inbox tool set via tools/list", async () => {
    const accessToken = await issueAccessToken()
    const initializeResponse = await MCP_POST(
      mcpRequest(initializeBody, accessToken)
    )
    const sessionId =
      initializeResponse.headers.get("mcp-session-id") ?? undefined

    const response = await MCP_POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        accessToken,
        sessionId
      )
    )

    expect(response.status).toBe(200)

    const payload = (await readMcpBody(response)) as {
      result?: { tools?: readonly { name?: string }[] }
    }

    const toolNames = (payload.result?.tools ?? []).map((tool) => tool.name)
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "get_connector_info",
        "search_contacts",
        "get_contact_summary",
        "get_contact_timeline",
        "get_inbox_queue",
        "get_workload_summary",
        "get_sync_freshness"
      ])
    )
  })

  it("executes get_connector_info through tools/call", async () => {
    const accessToken = await issueAccessToken()
    const initializeResponse = await MCP_POST(
      mcpRequest(initializeBody, accessToken)
    )
    const sessionId =
      initializeResponse.headers.get("mcp-session-id") ?? undefined

    const response = await MCP_POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_connector_info", arguments: {} }
        },
        accessToken,
        sessionId
      )
    )

    expect(response.status).toBe(200)

    const payload = (await readMcpBody(response)) as {
      result?: {
        isError?: boolean
        structuredContent?: {
          connectorVersion?: string
          registeredToolCount?: number
        }
      }
    }

    expect(payload.result?.isError).not.toBe(true)
    expect(payload.result?.structuredContent?.connectorVersion).toBe("0.1.0")
    expect(payload.result?.structuredContent?.registeredToolCount).toBe(7)
  })

  it("executes search_contacts through tools/call with a real token", async () => {
    if (runtime === null) {
      throw new Error("Missing test runtime.")
    }

    await seedTransportInboxFixture(runtime)

    const accessToken = await issueAccessToken()
    const initializeResponse = await MCP_POST(
      mcpRequest(initializeBody, accessToken)
    )
    const sessionId =
      initializeResponse.headers.get("mcp-session-id") ?? undefined

    const response = await MCP_POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "search_contacts", arguments: { query: "Sar" } }
        },
        accessToken,
        sessionId
      )
    )

    expect(response.status).toBe(200)

    const payload = (await readMcpBody(response)) as {
      result?: {
        isError?: boolean
        structuredContent?: {
          volunteers?: {
            rows?: {
              contact?: {
                displayName?: string
              }
            }[]
          }
        }
      }
    }

    expect(payload.result?.isError).not.toBe(true)
    expect(
      payload.result?.structuredContent?.volunteers?.rows?.[0]?.contact
        ?.displayName
    ).toBe("Sarah Martinez")
  })

  it("executes get_inbox_queue through tools/call with a real token", async () => {
    if (runtime === null) {
      throw new Error("Missing test runtime.")
    }

    await seedTransportInboxFixture(runtime)

    const accessToken = await issueAccessToken()
    const initializeResponse = await MCP_POST(
      mcpRequest(initializeBody, accessToken)
    )
    const sessionId =
      initializeResponse.headers.get("mcp-session-id") ?? undefined

    const response = await MCP_POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "get_inbox_queue", arguments: { folder: "inbox" } }
        },
        accessToken,
        sessionId
      )
    )

    expect(response.status).toBe(200)

    const payload = (await readMcpBody(response)) as {
      result?: {
        isError?: boolean
        structuredContent?: {
          items?: {
            rows?: {
              contact?: {
                displayName?: string
              }
            }[]
          }
        }
      }
    }

    expect(payload.result?.isError).not.toBe(true)
    expect(
      payload.result?.structuredContent?.items?.rows?.[0]?.contact?.displayName
    ).toBe("Sarah Martinez")
  })
})
