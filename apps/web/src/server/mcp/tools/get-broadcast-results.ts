import { z } from "zod-v4"

import { listRunRecipientResults } from "@/app/broadcasts/_lib/broadcast-results"
import { readRunMetricCounts } from "@/app/broadcasts/_lib/run-recipients"
import { getStage1WebRuntime } from "@/src/server/stage1-runtime"

import { DEFAULT_MCP_RESPONSE_BUDGET_CAP } from "../response-budget"
import { requireAuthenticatedOperator } from "../operator-context"
import type { McpToolEntry } from "../tool-registry"

const RESULT_FILTERS = [
  "all",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "unsubscribed",
  "failed",
  "suppressed"
] as const

const emptyStringToNull = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : value))

const getBroadcastResultsInputSchema = z
  .object({
    runId: z.string().trim().min(1, "runId is required"),
    // Same filters as the Recipients table; "" or omitted means all.
    filter: z
      .enum(RESULT_FILTERS)
      .or(z.literal(""))
      .nullable()
      .optional()
      .transform((value) => (value === undefined || value === null || value === "" ? "all" : value)),
    query: emptyStringToNull,
    offset: z.number().int().min(0).optional(),
    limit: z
      .number()
      .int()
      .positive()
      .max(DEFAULT_MCP_RESPONSE_BUDGET_CAP)
      .optional()
  })
  .strict()

export function createGetBroadcastResultsTool(): McpToolEntry<
  typeof getBroadcastResultsInputSchema
> {
  return {
    name: "get_broadcast_results",
    title: "Get Broadcast Results",
    description:
      "Per-recipient results of one broadcast send: each recipient's name, email, latest result (delivered, opened, clicked, bounced, unsubscribed, marked as spam) and event dates, plus the send's totals. Filter like the Recipients table (opened, clicked, bounced, unsubscribed…) or search by name/email. Pages of up to 25; use nextOffset for more. Get the runId from list_broadcasts.",
    inputSchema: getBroadcastResultsInputSchema,
    async handler(input, context) {
      requireAuthenticatedOperator(context)

      const runtime = await getStage1WebRuntime()
      const run = await runtime.campaigns.campaignRuns.findById(input.runId)
      if (run === null) {
        throw new Error(`No broadcast found with runId ${input.runId}.`)
      }
      const provider = run.launchType === "sms" ? "sms" : "postmark"
      const limit = input.limit ?? DEFAULT_MCP_RESPONSE_BUDGET_CAP
      const offset = input.offset ?? 0

      const [results, metrics] = await Promise.all([
        listRunRecipientResults({
          runId: run.id,
          provider,
          filter: input.filter,
          ...(input.query === null ? {} : { query: input.query }),
          limit,
          offset
        }),
        provider === "postmark"
          ? readRunMetricCounts({ runId: run.id })
          : Promise.resolve(null)
      ])
      const nextOffset = offset + results.rows.length

      return {
        broadcast: {
          runId: run.id,
          name: run.name,
          channel: provider === "sms" ? "sms" : "email",
          sentAt: run.startedAt
        },
        totals:
          metrics === null
            ? null
            : {
                recipients: metrics.total,
                delivered: metrics.delivered,
                opened: metrics.opened,
                clicked: metrics.clicked,
                bounced: metrics.bounced,
                unsubscribed: metrics.unsubscribed,
                markedAsSpam: metrics.complained
              },
        filter: input.filter,
        recipients: results.rows.map((row) => ({
          name: row.name,
          email: row.email,
          phone: row.phone,
          result: row.resultLabel,
          sentAt: row.sentAt,
          deliveredAt: row.deliveredAt,
          openedAt: row.openedAt,
          clickedAt: row.clickedAt,
          bouncedAt: row.bouncedAt,
          unsubscribedAt: row.unsubscribedAt,
          markedSpamAt: row.markedSpamAt
        })),
        page: {
          offset,
          returned: results.rows.length,
          matching: results.total,
          nextOffset: nextOffset < results.total ? nextOffset : null
        }
      }
    }
  }
}
