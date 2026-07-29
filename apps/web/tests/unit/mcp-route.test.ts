import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as OAuthCoreModule from "../../src/server/mcp/oauth/core"
import type * as OAuthRuntimeModule from "../../src/server/mcp/oauth/runtime"

const mcpHandler = vi.hoisted(() => vi.fn())
const createMcpHandler = vi.hoisted(() => vi.fn(() => mcpHandler))
const validateMcpAccessToken = vi.hoisted(() => vi.fn())
const getMcpOAuthRepository = vi.hoisted(() => vi.fn())
const findAuthorizedMcpUserById = vi.hoisted(() => vi.fn())

vi.mock("mcp-handler", () => ({
  createMcpHandler
}))

vi.mock("../../src/server/mcp/oauth/core", async () => {
  const actual = await vi.importActual<typeof OAuthCoreModule>(
    "../../src/server/mcp/oauth/core"
  )

  return {
    ...actual,
    validateMcpAccessToken
  }
})

vi.mock("../../src/server/stage1-runtime", () => ({
  getMcpOAuthRepository
}))

vi.mock("../../src/server/mcp/oauth/runtime", async () => {
  const actual = await vi.importActual<typeof OAuthRuntimeModule>(
    "../../src/server/mcp/oauth/runtime"
  )

  return {
    ...actual,
    findAuthorizedMcpUserById
  }
})

import { DELETE, GET, POST } from "../../app/api/mcp/route"

describe("mcp route", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_PUBLIC_URL", "https://as.example.com/api/mcp")
    mcpHandler.mockReset()
    validateMcpAccessToken.mockReset()
    getMcpOAuthRepository.mockReset()
    findAuthorizedMcpUserById.mockReset()

    mcpHandler.mockImplementation((request: Request) =>
      Response.json({
        ok: true,
        method: request.method,
        auth: request.auth ?? null
      })
    )

    validateMcpAccessToken.mockResolvedValue({
      kind: "success",
      scopes: ["mcp:read"],
      token: {
        clientId: "client_test",
        userId: "user-1",
        resource: "https://as.example.com/api/mcp",
        accessExpiresAt: "2026-07-29T13:00:00.000Z"
      }
    })
    getMcpOAuthRepository.mockResolvedValue({
      revokeAllTokensForUser: vi.fn().mockResolvedValue(1)
    })
    findAuthorizedMcpUserById.mockResolvedValue({
      id: "user-1",
      email: "operator@adventurescientists.org",
      role: "operator"
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("exports GET, POST, and DELETE handlers from a static route", () => {
    expect(typeof GET).toBe("function")
    expect(typeof POST).toBe("function")
    expect(typeof DELETE).toBe("function")
    expect(createMcpHandler).toHaveBeenCalledTimes(1)
  })

  it("returns the exact 401 handshake when the bearer token is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST"
      })
    )

    expect(mcpHandler).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://as.example.com/.well-known/oauth-protected-resource", scope="mcp:read"'
    )
  })

  it("returns the same 401 handshake when bearer validation fails", async () => {
    validateMcpAccessToken.mockResolvedValueOnce({
      kind: "error",
      error: "invalid_grant",
      errorDescription: "invalid",
      status: 401
    })

    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token"
        }
      })
    )

    expect(mcpHandler).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://as.example.com/.well-known/oauth-protected-resource", scope="mcp:read"'
    )
  })

  it("revokes the user's tokens and returns 401 when the user is no longer authorized", async () => {
    const oauthRepository = {
      revokeAllTokensForUser: vi.fn().mockResolvedValue(1)
    }
    getMcpOAuthRepository.mockResolvedValueOnce(oauthRepository)
    findAuthorizedMcpUserById.mockResolvedValueOnce(null)

    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token"
        }
      })
    )

    expect(oauthRepository.revokeAllTokensForUser).toHaveBeenCalledWith(
      "user-1",
      expect.any(Date)
    )
    expect(response.status).toBe(401)
  })

  it("accepts authenticated GET, POST, and DELETE requests and forwards auth context", async () => {
    for (const [method, handler] of [
      ["GET", GET],
      ["POST", POST],
      ["DELETE", DELETE]
    ] as const) {
      const response = await handler(
        new Request("http://localhost/api/mcp", {
          method,
          headers: {
            authorization: "Bearer valid-token"
          }
        })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        method,
        auth: {
          clientId: "client_test",
          extra: {
            userEmail: "operator@adventurescientists.org",
            userId: "user-1",
            userRole: "operator"
          },
          scopes: ["mcp:read"]
        }
      })
    }

    expect(mcpHandler).toHaveBeenCalledTimes(3)
  })
})
