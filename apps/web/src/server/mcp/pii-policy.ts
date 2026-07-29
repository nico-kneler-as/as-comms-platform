export const CONTACT_PII_FIELDS = [
  "id",
  "displayName",
  "primaryEmail",
  "primaryPhone",
  "salesforceContactId"
] as const

export type ContactPiiField = (typeof CONTACT_PII_FIELDS)[number]
export type ContactPiiRecord = Record<string, unknown>
export type ContactPiiAllowlistMap = Readonly<
  Record<string, readonly ContactPiiField[]>
>

export const MCP_TOOL_CONTACT_PII_ALLOWLISTS: ContactPiiAllowlistMap = {
  get_connector_info: [],
  search_contacts: ["id", "displayName", "primaryEmail", "primaryPhone"],
  get_contact_summary: [
    "id",
    "displayName",
    "primaryEmail",
    "primaryPhone",
    "salesforceContactId"
  ],
  get_contact_timeline: [],
  get_inbox_queue: ["id", "displayName"],
  get_workload_summary: ["id", "displayName"],
  get_sync_freshness: []
}

export function applyContactPiiPolicy<T extends ContactPiiRecord>(
  toolName: string,
  record: T,
  allowlists: ContactPiiAllowlistMap = MCP_TOOL_CONTACT_PII_ALLOWLISTS
): Partial<T> {
  const allowedFields = new Set(allowlists[toolName] ?? [])
  const sanitizedRecord: Partial<T> = {}

  for (const [field, value] of Object.entries(record)) {
    if (allowedFields.has(field as ContactPiiField)) {
      sanitizedRecord[field as keyof T] = value as T[keyof T]
    }
  }

  return sanitizedRecord
}
