import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Deliberately NO vi.mock("mcp-handler") here. `mcp-route.test.ts` mocks the
// adapter to test the auth guard in isolation, which means nothing there
// exercises the real Streamable HTTP transport. This file closes that gap by
// driving actual MCP JSON-RPC through the real handler.
import { POST } from "../../app/api/mcp/route"

const MCP_ACCEPT = "application/json, text/event-stream"

async function readMcpBody(response: Response): Promise<unknown> {
  const text = await response.text()

  // Streamable HTTP may answer as a single JSON body or as an SSE frame.
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

function mcpRequest(body: unknown, sessionId?: string): Request {
  const headers: Record<string, string> = {
    authorization: "Bearer integration-token",
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
  beforeEach(() => {
    vi.stubEnv("MCP_DEV_TOKEN", "integration-token")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("completes an MCP initialize handshake and reports server info", async () => {
    const response = await POST(mcpRequest(initializeBody))

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

  it("advertises get_connector_info via tools/list", async () => {
    const initializeResponse = await POST(mcpRequest(initializeBody))
    const sessionId =
      initializeResponse.headers.get("mcp-session-id") ?? undefined

    const response = await POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        sessionId
      )
    )

    expect(response.status).toBe(200)

    const payload = (await readMcpBody(response)) as {
      result?: { tools?: readonly { name?: string }[] }
    }

    const toolNames = (payload.result?.tools ?? []).map((tool) => tool.name)
    expect(toolNames).toContain("get_connector_info")
  })

  it("executes get_connector_info through tools/call", async () => {
    const initializeResponse = await POST(mcpRequest(initializeBody))
    const sessionId =
      initializeResponse.headers.get("mcp-session-id") ?? undefined

    const response = await POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_connector_info", arguments: {} }
        },
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
    expect(payload.result?.structuredContent?.registeredToolCount).toBe(1)
  })
})
