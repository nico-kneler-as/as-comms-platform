import { z } from "zod"

import { getInboxList } from "@/app/inbox/_lib/selectors"
import {
  INBOX_FILTER_IDS,
  parseInboxFilterId
} from "@/app/inbox/_lib/view-models"

import {
  DEFAULT_MCP_RESPONSE_BUDGET_CAP,
  applyResponseBudget
} from "../response-budget"
import { requireAuthenticatedOperator } from "../operator-context"
import { sanitizeContactRecord } from "../tool-payloads"
import type { McpToolEntry } from "../tool-registry"

const TOOL_NAME = "get_inbox_queue"
const VALID_FOLDER_NAMES = ["all", ...INBOX_FILTER_IDS].join(", ")
const QUEUE_LIMIT_MESSAGE = `limit must be at most ${String(
  DEFAULT_MCP_RESPONSE_BUDGET_CAP
)}`

// Optional string input that accepts "", null, or omission and normalizes all
// three to null. Idempotent, so it stays safe if composed into another schema.
const emptyStringToNull = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : value))

const getInboxQueueInputSchema = z
  .object({
    folder: z
      .string()
      .trim()
      .min(1, "folder is required")
      .refine((value) => parseInboxFilterId(value) !== null, {
        message: `folder must be one of: ${VALID_FOLDER_NAMES}`
      }),
    // Coerce "" to null rather than rejecting it. A model routinely sends an
    // empty string to mean "no filter", and `.min(1)` would turn that into a
    // validation error for the whole call instead of an unfiltered queue.
    projectId: emptyStringToNull,
    cursor: emptyStringToNull,
    limit: z
      .number()
      .int()
      .positive()
      .max(DEFAULT_MCP_RESPONSE_BUDGET_CAP, QUEUE_LIMIT_MESSAGE)
      .optional()
  })
  .strict()

export function createGetInboxQueueTool(): McpToolEntry<
  typeof getInboxQueueInputSchema
> {
  return {
    name: TOOL_NAME,
    title: "Get Inbox Queue",
    description:
      "Read the current inbox queue for a folder like inbox, unread, or follow-up, with optional project filtering and pagination. Use this for questions about what is waiting right now.",
    inputSchema: getInboxQueueInputSchema,
    async handler(input, context) {
      requireAuthenticatedOperator(context)

      const folder = parseInboxFilterId(input.folder)

      if (folder === null) {
        throw new Error(`folder must be one of: ${VALID_FOLDER_NAMES}`)
      }

      const queue = await getInboxList(folder, {
        cursor: input.cursor ?? null,
        limit: input.limit ?? DEFAULT_MCP_RESPONSE_BUDGET_CAP,
        projectId: input.projectId ?? null
      })

      return {
        folder,
        items: applyResponseBudget(
          queue.items.map((item) => ({
            contact: sanitizeContactRecord(TOOL_NAME, {
              id: item.contactId,
              displayName: item.displayName,
              primaryEmail: item.primaryEmail
            }),
            initials: item.initials,
            avatarTone: item.avatarTone,
            latestSubject: item.latestSubject,
            snippet: item.snippet,
            latestChannel: item.latestChannel,
            projectLabel: item.projectLabel,
            projectSubLabel: item.projectSubLabel,
            additionalActiveProjectsCount: item.additionalActiveProjectsCount,
            volunteerStage: item.volunteerStage,
            bucket: item.bucket,
            needsFollowUp: item.needsFollowUp,
            hasUnresolved: item.hasUnresolved,
            isArchived: item.isArchived,
            isUnread: item.isUnread,
            unreadCount: item.unreadCount,
            isUnanswered: item.isUnanswered,
            lastInboundAt: item.lastInboundAt,
            lastNonAliasMessageAt: item.lastNonAliasMessageAt,
            lastOutboundAt: item.lastOutboundAt,
            lastActivityAt: item.lastActivityAt,
            lastEventType: item.lastEventType,
            lastActivityLabel: item.lastActivityLabel
          })),
          input.limit ?? DEFAULT_MCP_RESPONSE_BUDGET_CAP
        ),
        filters: applyResponseBudget(queue.filters),
        totals: queue.totals,
        activeProjects: applyResponseBudget(queue.activeProjects),
        selectedProjectId: queue.selectedProjectId,
        page: queue.page,
        freshness: queue.freshness
      }
    }
  }
}
