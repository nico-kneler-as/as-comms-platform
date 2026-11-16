import { z } from "zod-v4"

import { findBroadcasts } from "@/app/broadcasts/_lib/broadcast-results"

import { DEFAULT_MCP_RESPONSE_BUDGET_CAP } from "../response-budget"
import { requireAuthenticatedOperator } from "../operator-context"
import type { McpToolEntry } from "../tool-registry"

// "" means "no filter" when a model sends it; normalize to null.
const emptyStringToNull = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : value))

const listBroadcastsInputSchema = z
  .object({
    query: emptyStringToNull,
    limit: z
      .number()
      .int()
      .positive()
      .max(DEFAULT_MCP_RESPONSE_BUDGET_CAP)
      .optional()
  })
  .strict()

export function createListBroadcastsTool(): McpToolEntry<
  typeof listBroadcastsInputSchema
> {
  return {
    name: "list_broadcasts",
    title: "List Broadcasts",
    description:
      "List recent broadcast sends (email and SMS), newest first, optionally matching a name like \"Insiders\". Returns each send's runId, sender, send date, audience size and totals (delivered, opened, clicked, bounced, unsubscribed). Use the runId with get_broadcast_results for per-recipient results.",
    inputSchema: listBroadcastsInputSchema,
    async handler(input, context) {
      requireAuthenticatedOperator(context)

      const broadcasts = await findBroadcasts({
        ...(input.query === null ? {} : { query: input.query }),
        limit: input.limit ?? DEFAULT_MCP_RESPONSE_BUDGET_CAP
      })

      return {
        broadcasts: broadcasts.map((broadcast) => ({
          runId: broadcast.runId,
          name: broadcast.name,
          state: broadcast.state,
          channel: broadcast.channel,
          from:
            broadcast.fromEmail === null
              ? null
              : `${broadcast.fromName ?? "Adventure Scientists"} <${broadcast.fromEmail}>`,
          sentAt: broadcast.sentAt,
          audienceSize: broadcast.audienceSize,
          totals:
            broadcast.metrics === null
              ? null
              : {
                  recipients: broadcast.metrics.total,
                  delivered: broadcast.metrics.delivered,
                  opened: broadcast.metrics.opened,
                  clicked: broadcast.metrics.clicked,
                  bounced: broadcast.metrics.bounced,
                  unsubscribed: broadcast.metrics.unsubscribed,
                  markedAsSpam: broadcast.metrics.complained
                }
        })),
        returned: broadcasts.length
      }
    }
  }
}
