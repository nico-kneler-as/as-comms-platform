import { z } from "zod"

import { getInboxDetailTimeline } from "@/app/inbox/_lib/selectors"

import {
  DEFAULT_MCP_RESPONSE_BUDGET_CAP,
  applyResponseBudget
} from "../response-budget"
import { requireAuthenticatedOperator } from "../operator-context"
import type { McpToolEntry } from "../tool-registry"

const TOOL_NAME = "get_contact_timeline"
const TIMELINE_LIMIT_MESSAGE = `limit must be at most ${String(
  DEFAULT_MCP_RESPONSE_BUDGET_CAP
)}`

const getContactTimelineInputSchema = z
  .object({
    contactId: z.string().trim().min(1, "contactId is required"),
    limit: z
      .number()
      .int()
      .positive()
      .max(DEFAULT_MCP_RESPONSE_BUDGET_CAP, TIMELINE_LIMIT_MESSAGE)
      .optional()
  })
  .strict()

export function createGetContactTimelineTool(): McpToolEntry<
  typeof getContactTimelineInputSchema
> {
  return {
    name: TOOL_NAME,
    title: "Get Contact Timeline",
    description:
      "Read a contact's chronological inbox history without changing unread or read-audit state. Use this when you need to answer whether someone replied or what was said.",
    inputSchema: getContactTimelineInputSchema,
    async handler(input, context) {
      requireAuthenticatedOperator(context)

      const timeline = await getInboxDetailTimeline(
        input.contactId,
        input.limit === undefined
          ? undefined
          : {
              limit: input.limit
            }
      )

      if (timeline === null) {
        return {
          status: "not_found",
          contactId: input.contactId,
          message: `No contact exists for contactId "${input.contactId}".`
        }
      }

      return {
        contactId: input.contactId,
        timeline: applyResponseBudget(
          timeline.timeline,
          input.limit ?? DEFAULT_MCP_RESPONSE_BUDGET_CAP
        ),
        timelinePage: timeline.timelinePage
      }
    }
  }
}
