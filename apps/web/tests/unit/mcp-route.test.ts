import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mcpHandler = vi.hoisted(() => vi.fn())
const createMcpHandler = vi.hoisted(() =>
  vi.fn(() => mcpHandler)
)

vi.mock("mcp-handler", () => ({
  createMcpHandler
}))

import { DELETE, GET, POST } from "../../app/api/mcp/route"

describe("mcp route", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_DEV_TOKEN", "test-token")
    mcpHandler.mockReset()
    mcpHandler.mockImplementation((request: Request) =>
      Response.json({
        ok: true,
        method: request.method
      })
    )
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

  it("rejects requests without an authorization header", async () => {
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST"
      })
    )

    expect(mcpHandler).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized"
    })
  })

  it("rejects requests with the wrong bearer token", async () => {
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
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized"
    })
  })

  it("accepts authenticated GET, POST, and DELETE requests", async () => {
    for (const [method, handler] of [
      ["GET", GET],
      ["POST", POST],
      ["DELETE", DELETE]
    ] as const) {
      const response = await handler(
        new Request("http://localhost/api/mcp", {
          method,
          headers: {
            authorization: "Bearer test-token"
          }
        })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        ok: true,
        method
      })
    }

    expect(mcpHandler).toHaveBeenCalledTimes(3)
  })

  it("returns 401 instead of throwing for a multi-byte header of equal string length", async () => {
    // Regression guard. "Bearer test-token" and "Bearer test-tokeñ" are both
    // 17 JS characters, but the latter is 18 UTF-8 bytes. Gating on
    // `String.length` lets it reach `timingSafeEqual`, which throws a
    // RangeError on a byte-length mismatch — surfacing as a 500 rather than
    // a clean 401. The guard must compare byte lengths.
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-tokeñ"
        }
      })
    )

    expect(mcpHandler).not.toHaveBeenCalled()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized"
    })
  })

  it.each([undefined, ""])(
    "rejects requests when MCP_DEV_TOKEN is %s even if a header is supplied",
    async (token) => {
      if (token === undefined) {
        vi.unstubAllEnvs()
      } else {
        vi.stubEnv("MCP_DEV_TOKEN", token)
      }

      const response = await POST(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            authorization: "Bearer test-token"
          }
        })
      )

      expect(mcpHandler).not.toHaveBeenCalled()
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({
        ok: false,
        code: "unauthorized"
      })
    }
  )
})
