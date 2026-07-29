import { z } from "zod"

import { getInboxDetailSummary } from "@/app/inbox/_lib/selectors"

import { requireAuthenticatedOperator } from "../operator-context"
import { applyResponseBudget } from "../response-budget"
import { sanitizeContactRecord } from "../tool-payloads"
import type { McpToolEntry } from "../tool-registry"

const TOOL_NAME = "get_contact_summary"

const getContactSummaryInputSchema = z
  .object({
    contactId: z.string().trim().min(1, "contactId is required")
  })
  .strict()

function toSalesforceContactId(input: {
  contactId: string
  volunteerId: string
}): string | null {
  return input.volunteerId === input.contactId ? null : input.volunteerId
}

export function createGetContactSummaryTool(): McpToolEntry<
  typeof getContactSummaryInputSchema
> {
  return {
    name: TOOL_NAME,
    title: "Get Contact Summary",
    description:
      "Get one contact's profile context, memberships, and inbox rail summary. Use this when you need who the person is before reading the full timeline.",
    inputSchema: getContactSummaryInputSchema,
    async handler(input, context) {
      requireAuthenticatedOperator(context)

      const summary = await getInboxDetailSummary(input.contactId)

      if (summary === null) {
        return {
          status: "not_found",
          contactId: input.contactId,
          message: `No contact exists for contactId "${input.contactId}".`
        }
      }

      return {
        contact: {
          ...sanitizeContactRecord(TOOL_NAME, {
            id: summary.contact.contactId,
            displayName: summary.contact.displayName,
            primaryEmail: summary.contact.primaryEmail,
            primaryPhone: summary.contact.primaryPhone,
            salesforceContactId: toSalesforceContactId({
              contactId: summary.contact.contactId,
              volunteerId: summary.contact.volunteerId
            })
          }),
          joinedAtLabel: summary.contact.joinedAtLabel,
          hasUnresolved: summary.contact.hasUnresolved,
          unresolvedCases: applyResponseBudget(
            summary.contact.unresolvedCases.map((unresolvedCase) => ({
              kind: unresolvedCase.kind,
              reasonLabel: unresolvedCase.reasonLabel,
              explanation: unresolvedCase.explanation,
              otherContacts: applyResponseBudget(
                unresolvedCase.otherContacts.map((contact) =>
                  sanitizeContactRecord(TOOL_NAME, {
                    displayName: contact.displayName,
                    primaryEmail: contact.email
                  })
                )
              ),
              moreCount: unresolvedCase.moreCount,
              openedAtLabel: unresolvedCase.openedAtLabel
            }))
          ),
          pinnedNote: summary.contact.pinnedNote,
          activeProjects: applyResponseBudget(summary.contact.activeProjects),
          pastProjects: applyResponseBudget(summary.contact.pastProjects),
          recentActivity: applyResponseBudget(summary.contact.recentActivity)
        },
        projectionAvailable: summary.projectionAvailable,
        conversationProject: summary.conversationProject,
        initials: summary.initials,
        avatarTone: summary.avatarTone,
        bucket: summary.bucket,
        needsFollowUp: summary.needsFollowUp,
        isArchived: summary.isArchived,
        isUnread: summary.isUnread,
        smsEligible: summary.smsEligible,
        freshness: summary.freshness
      }
    }
  }
}
