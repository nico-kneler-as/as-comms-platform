import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type * as z from "zod"

export type McpToolPayload = Record<string, unknown>
export type McpToolInputSchema = z.AnyZodObject

type McpToolHandler<TInputSchema extends McpToolInputSchema> = {
  bivarianceHack(
    input: z.infer<TInputSchema>
  ): Promise<McpToolPayload> | McpToolPayload
}["bivarianceHack"]

export interface McpToolEntry<
  TInputSchema extends McpToolInputSchema = McpToolInputSchema
> {
  name: string
  title: string
  description: string
  inputSchema: TInputSchema
  handler: McpToolHandler<TInputSchema>
}

export interface McpToolRegistry {
  count: number
  registerOn(server: McpToolRegistrar): void
}

export interface McpToolRegistrar {
  registerTool(
    name: string,
    config: {
      title?: string
      description?: string
      inputSchema?: McpToolInputSchema
    },
    callback: (input: unknown) => Promise<CallToolResult>
  ): unknown
}

type McpToolErrorCode = "validation_error" | "tool_error" | "internal_error"

interface ToolErrorPayload {
  ok: false
  code: McpToolErrorCode
}

function createToolErrorResult(
  code: McpToolErrorCode,
  message: string
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: message
      }
    ],
    structuredContent: {
      ok: false,
      code
    } satisfies ToolErrorPayload,
    isError: true
  }
}

function createToolSuccessResult(payload: McpToolPayload): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  }
}

function formatValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "input" : issue.path.join(".")
    return `${path}: ${issue.message}`
  })

  return issues.length === 0
    ? "Tool input failed validation."
    : `Tool input failed validation: ${issues.join("; ")}`
}

function createUniqueToolIndex(
  entries: readonly McpToolEntry[]
): Map<string, McpToolEntry> {
  const index = new Map<string, McpToolEntry>()

  for (const entry of entries) {
    if (index.has(entry.name)) {
      throw new Error(`Duplicate MCP tool name: ${entry.name}`)
    }

    index.set(entry.name, entry)
  }

  return index
}

export function createMcpToolRegistry(
  entries: readonly McpToolEntry[]
): McpToolRegistry {
  const entryIndex = createUniqueToolIndex(entries)

  return {
    count: entryIndex.size,
    registerOn(server) {
      for (const entry of entryIndex.values()) {
        server.registerTool(
          entry.name,
          {
            title: entry.title,
            description: entry.description,
            inputSchema: entry.inputSchema
          },
          async (input: unknown) => {
            const parsedInput = entry.inputSchema.safeParse(input ?? {})

            if (!parsedInput.success) {
              return createToolErrorResult(
                "validation_error",
                formatValidationError(parsedInput.error)
              )
            }

            try {
              const payload = await entry.handler(parsedInput.data)
              return createToolSuccessResult(payload)
            } catch (error) {
              if (error instanceof Error) {
                return createToolErrorResult("tool_error", error.message)
              }

              return createToolErrorResult(
                "internal_error",
                "Tool execution failed."
              )
            }
          }
        )
      }
    }
  }
}
