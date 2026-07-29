import { z } from "zod"

import { getInboxWelcomeWorkload } from "@/app/inbox/_lib/selectors"

import { requireAuthenticatedOperator } from "../operator-context"
import { applyResponseBudget } from "../response-budget"
import {
  budgetRowsWithKnownTotal,
  sanitizeContactRecord
} from "../tool-payloads"
import type { McpToolEntry } from "../tool-registry"

const TOOL_NAME = "get_workload_summary"

const getWorkloadSummaryInputSchema = z.object({}).strict()

export function createGetWorkloadSummaryTool(): McpToolEntry {
  return {
    name: TOOL_NAME,
    title: "Get Workload Summary",
    description:
      "Get the inbox workload snapshot with per-project totals and the follow-up rail. Use this for a quick at-a-glance summary instead of full queue rows.",
    inputSchema: getWorkloadSummaryInputSchema,
    async handler(
      _input: z.infer<typeof getWorkloadSummaryInputSchema>,
      context
    ) {
      requireAuthenticatedOperator(context)

      const workload = await getInboxWelcomeWorkload()

      return {
        projects: applyResponseBudget(workload.projects),
        totals: workload.totals,
        followUpRail: {
          totalCount: workload.followUpRail.totalCount,
          entries: budgetRowsWithKnownTotal(
            workload.followUpRail.entries.map((entry) => ({
              contact: sanitizeContactRecord(TOOL_NAME, {
                id: entry.contactId,
                displayName: entry.displayName
              }),
              initials: entry.initials,
              avatarTone: entry.avatarTone,
              projectLabel: entry.projectLabel,
              latestSubject: entry.latestSubject,
              lastActivityLabel: entry.lastActivityLabel
            })),
            workload.followUpRail.totalCount
          )
        }
      }
    }
  }
}
