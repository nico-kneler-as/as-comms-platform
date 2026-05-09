import type { AllContactsSearchCursor } from "@as-comms/domain";

import { getStage1WebRuntime } from "../../../src/server/stage1-runtime";

/**
 * View-model row for the "All contacts" search scope. Represents one contact
 * in the database, surfaced regardless of whether they have inbox-driving
 * comm events or active project memberships. Distinct from
 * {@link InboxListItemViewModel} which is built from `contact_inbox_projection`.
 */
export interface AllContactsSearchRowViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly memberships: readonly {
    readonly projectId: string;
    readonly label: string;
  }[];
  readonly lastActivityAt: string | null;
  readonly profileHref: string;
}

export interface AllContactsSearchPageViewModel {
  readonly query: string;
  readonly rows: readonly AllContactsSearchRowViewModel[];
  readonly nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw: number | null | undefined): number {
  if (raw === undefined || raw === null) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isFinite(raw)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(raw)));
}

function encodeCursor(cursor: AllContactsSearchCursor | null): string | null {
  if (cursor === null) {
    return null;
  }
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): AllContactsSearchCursor | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const displayName = parsed.displayName;
    const contactId = parsed.contactId;
    if (typeof displayName !== "string" || typeof contactId !== "string") {
      return null;
    }
    return { displayName, contactId };
  } catch {
    return null;
  }
}

/**
 * Server selector for the "All contacts" search scope. Wraps
 * `searchAllContacts` and assembles the result-row view models the client
 * renders. Click target is the existing contact-detail route at
 * `/inbox/[contactId]`.
 */
export async function getAllContactsSearchPage(input: {
  readonly query: string;
  readonly limit?: number | null;
  readonly cursor?: string | null;
}): Promise<AllContactsSearchPageViewModel> {
  const trimmedQuery = input.query.trim();
  const limit = clampLimit(input.limit);
  const cursor = decodeCursor(input.cursor ?? null);

  if (trimmedQuery.length === 0) {
    return {
      query: trimmedQuery,
      rows: [],
      nextCursor: null,
    };
  }

  const runtime = await getStage1WebRuntime();
  const { rows, nextCursor } =
    await runtime.repositories.contacts.searchAllContacts({
      query: trimmedQuery,
      limit,
      cursor,
    });

  return {
    query: trimmedQuery,
    rows: rows.map((row) => ({
      contactId: row.contact.id,
      displayName: row.contact.displayName,
      primaryEmail: row.contact.primaryEmail,
      primaryPhone: row.contact.primaryPhone,
      memberships: row.memberships.map((membership) => ({
        projectId: membership.projectId,
        label: membership.projectAlias ?? membership.projectName,
      })),
      lastActivityAt: row.lastActivityAt,
      profileHref: `/inbox/${encodeURIComponent(row.contact.id)}`,
    })),
    nextCursor: encodeCursor(nextCursor),
  };
}
