import { z } from "zod"

import {
  getInboxUnifiedSearch,
  INBOX_UNIFIED_SEARCH_MIN_QUERY_LENGTH
} from "@/app/inbox/_lib/selectors"

import { requireAuthenticatedOperator } from "../operator-context"
import { DEFAULT_MCP_RESPONSE_BUDGET_CAP } from "../response-budget"
import type { McpToolEntry } from "../tool-registry"
import {
  budgetRowsWithKnownTotal,
  sanitizeContactRecord
} from "../tool-payloads"

const TOOL_NAME = "search_contacts"
const MIN_QUERY_LENGTH_MESSAGE = `query must be at least ${String(
  INBOX_UNIFIED_SEARCH_MIN_QUERY_LENGTH
)} characters long`

const searchContactsInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(INBOX_UNIFIED_SEARCH_MIN_QUERY_LENGTH, MIN_QUERY_LENGTH_MESSAGE)
  })
  .strict()

type UnifiedSearchRow = Awaited<
  ReturnType<typeof getInboxUnifiedSearch>
>["volunteers"][number]

// Both result sections have the same row shape, so map them through one place —
// otherwise adding a field means remembering to change two identical blocks.
function toSearchResultRow(row: UnifiedSearchRow) {
  return {
    contact: sanitizeContactRecord(TOOL_NAME, {
      id: row.contactId,
      displayName: row.displayName,
      primaryEmail: row.primaryEmail,
      primaryPhone: row.primaryPhone
    }),
    projectLabel: row.projectLabel,
    hasMembership: row.hasMembership,
    hasProjection: row.hasProjection,
    lastActivityAt: row.lastActivityAt,
    lastActivityLabel: row.lastActivityLabel,
    latestSubject: row.latestSubject,
    snippet: row.snippet,
    latestChannel: row.latestChannel,
    lastEventType: row.lastEventType
  }
}

export function createSearchContactsTool(): McpToolEntry<
  typeof searchContactsInputSchema
> {
  return {
    name: TOOL_NAME,
    title: "Search Contacts",
    description:
      "Find a contact by name, primary email, or primary phone. Use this before the contact summary or timeline tools when you do not already know the contact id.",
    inputSchema: searchContactsInputSchema,
    async handler(input, context) {
      requireAuthenticatedOperator(context)

      const results = await getInboxUnifiedSearch({
        query: input.query
      })

      return {
        query: results.query,
        volunteers: budgetRowsWithKnownTotal(
          results.volunteers.map(toSearchResultRow),
          results.totals.volunteers,
          DEFAULT_MCP_RESPONSE_BUDGET_CAP
        ),
        contacts: budgetRowsWithKnownTotal(
          results.contacts.map(toSearchResultRow),
          results.totals.contacts,
          DEFAULT_MCP_RESPONSE_BUDGET_CAP
        )
      }
    }
  }
}
