import { describe, expect, it, vi } from "vitest"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import type { AnyZodObject } from "zod"
import { z } from "zod"

import {
  createMcpToolRegistry,
  type McpToolEntry
} from "../../src/server/mcp/tool-registry"

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
  ) => Promise<unknown>
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
        callback: (
          input: unknown,
          extra?: {
            authInfo?: AuthInfo
          }
        ) => Promise<unknown>
      ) => {
      registrations.set(name, { config, callback })
      return {} as never
      }
    )
  }

  return { server, registrations }
}

describe("mcp tool registry", () => {
  it("registers a valid entry on the MCP server", () => {
    const entry = {
      name: "echo",
      title: "Echo",
      description: "Echo text back.",
      inputSchema: z.object({
        text: z.string()
      }),
      handler: ({ text }: { text: string }) => ({ echoedText: text })
    } satisfies McpToolEntry
    const { server, registrations } = createFakeServer()

    createMcpToolRegistry([entry]).registerOn(server)

    expect(server.registerTool).toHaveBeenCalledTimes(1)
    expect(registrations.get("echo")).toMatchObject({
      config: {
        title: "Echo",
        description: "Echo text back.",
        inputSchema: entry.inputSchema
      }
    })
  })

  it("rejects duplicate tool names during registration", () => {
    const duplicateEntry = {
      name: "duplicate_tool",
      title: "Duplicate Tool",
      description: "Should fail.",
      inputSchema: z.object({}).strict(),
      handler: () => ({ ok: true })
    } satisfies McpToolEntry

    expect(() =>
      createMcpToolRegistry([duplicateEntry, duplicateEntry])
    ).toThrowError("Duplicate MCP tool name: duplicate_tool")
  })

  it("maps schema failures to validation errors without calling the handler", async () => {
    const handlerSpy = vi.fn(({ text }: { text: string }) => ({
      echoedText: text
    }))
    const entry = {
      name: "validated_echo",
      title: "Validated Echo",
      description: "Validate input before running the handler.",
      inputSchema: z.object({
        text: z.string().min(1)
      }),
      handler: (input: { text: string }) => handlerSpy(input)
    } satisfies McpToolEntry
    const { server, registrations } = createFakeServer()

    createMcpToolRegistry([entry]).registerOn(server)
    const registered = getRegistration(registrations, "validated_echo")

    const result = await registered.callback({
      text: 42
    })

    expect(handlerSpy).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        code: "validation_error"
      }
    })
  })

  it("maps thrown handler errors to MCP tool errors", async () => {
    const entry = {
      name: "failing_tool",
      title: "Failing Tool",
      description: "Throw from the handler.",
      inputSchema: z.object({}).strict(),
      handler: () => {
        throw new Error("boom")
      }
    } satisfies McpToolEntry
    const { server, registrations } = createFakeServer()

    createMcpToolRegistry([entry]).registerOn(server)
    const registered = getRegistration(registrations, "failing_tool")

    await expect(registered.callback(undefined)).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        code: "tool_error"
      },
      content: [
        {
          type: "text",
          text: "boom"
        }
      ]
    })
  })

  it("returns the expected MCP tool result for a successful handler", async () => {
    const entry = {
      name: "no_input_tool",
      title: "No Input Tool",
      description: "Support tools that accept an empty object.",
      inputSchema: z.object({}).strict(),
      handler: () => ({
        connectorVersion: "brick-1",
        registeredToolCount: 1
      })
    } satisfies McpToolEntry
    const { server, registrations } = createFakeServer()

    createMcpToolRegistry([entry]).registerOn(server)
    const registered = getRegistration(registrations, "no_input_tool")

    await expect(registered.callback(undefined)).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectorVersion: "brick-1",
              registeredToolCount: 1
            },
            null,
            2
          )
        }
      ],
      structuredContent: {
        connectorVersion: "brick-1",
        registeredToolCount: 1
      }
    })
  })

  it("passes the authenticated operator from authInfo into the handler context", async () => {
    const handlerSpy = vi.fn()
    const entry = {
      name: "auth_context_tool",
      title: "Auth Context Tool",
      description: "Expose the authenticated user.",
      inputSchema: z.object({}).strict(),
      handler: (_input, context) => {
        handlerSpy(context)
        return {
          ok: true
        }
      }
    } satisfies McpToolEntry
    const { server, registrations } = createFakeServer()

    createMcpToolRegistry([entry]).registerOn(server)
    const registered = getRegistration(registrations, "auth_context_tool")

    await registered.callback(undefined, {
      authInfo: {
        token: "token-1",
        clientId: "client-1",
        scopes: ["mcp:read"],
        extra: {
          userEmail: "operator@adventurescientists.org",
          userId: "user-1",
          userRole: "operator"
        }
      }
    })

    expect(handlerSpy).toHaveBeenCalledWith({
      authInfo: expect.objectContaining({
        clientId: "client-1"
      }) as unknown,
      authenticatedUser: {
        userEmail: "operator@adventurescientists.org",
        userId: "user-1",
        userRole: "operator"
      }
    })
  })
})
