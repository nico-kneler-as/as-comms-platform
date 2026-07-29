import { z } from "zod"

import { getInboxFreshness } from "@/app/inbox/_lib/selectors"
import { classifySyncFreshness } from "@/app/inbox/_lib/sync-freshness"

import { requireAuthenticatedOperator } from "../operator-context"
import type { McpToolEntry } from "../tool-registry"

const TOOL_NAME = "get_sync_freshness"

const getSyncFreshnessInputSchema = z
  .object({
    contactId: z.string().trim().min(1).optional()
  })
  .strict()

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

export function createGetSyncFreshnessTool(): McpToolEntry {
  return {
    name: TOOL_NAME,
    title: "Get Sync Freshness",
    description:
      "Check inbox data freshness timestamps with stale-or-fresh classifications. Use this when a quiet inbox might actually be stale data.",
    inputSchema: getSyncFreshnessInputSchema,
    async handler(input: z.infer<typeof getSyncFreshnessInputSchema>, context) {
      requireAuthenticatedOperator(context)

      const freshness = await getInboxFreshness(input.contactId)
      const now = new Date()

      return {
        requestedContactId: input.contactId ?? null,
        list: {
          latestUpdatedAt: freshness.list.latestUpdatedAt,
          total: freshness.list.total,
          freshness: classifySyncFreshness({
            lastSuccessAt: toDate(freshness.list.latestUpdatedAt),
            now
          })
        },
        detail:
          freshness.detail === null
            ? null
            : {
                inboxUpdatedAt: freshness.detail.inboxUpdatedAt,
                inboxFreshness: classifySyncFreshness({
                  lastSuccessAt: toDate(freshness.detail.inboxUpdatedAt),
                  now
                }),
                timelineUpdatedAt: freshness.detail.timelineUpdatedAt,
                timelineFreshness: classifySyncFreshness({
                  lastSuccessAt: toDate(freshness.detail.timelineUpdatedAt),
                  now
                }),
                timelineCount: freshness.detail.timelineCount
              }
      }
    }
  }
}
