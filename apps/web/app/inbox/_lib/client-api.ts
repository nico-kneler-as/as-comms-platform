"use client";

import type {
  InboxDetailViewModel,
  InboxFilterId,
  InboxListViewModel,
  InboxTimelineEntryViewModel
} from "./view-models";

export interface InboxTimelinePageResponse {
  readonly entries: readonly InboxTimelineEntryViewModel[];
  readonly page: InboxDetailViewModel["timelinePage"];
}

export interface InboxFreshnessResponse {
  readonly list: InboxListViewModel["freshness"];
  readonly detail:
    | InboxDetailViewModel["freshness"]
    | null;
}

async function readJson<T>(input: RequestInfo | URL): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status.toString()}.`);
  }

  return (await response.json()) as T;
}

export function fetchInboxListPage(input: {
  readonly filterId: InboxFilterId;
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly query?: string | null;
  readonly projectId?: string | null;
}): Promise<InboxListViewModel> {
  const params = new URLSearchParams({
    filter: input.filterId
  });

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  if (input.limit !== undefined) {
    params.set("limit", input.limit.toString());
  }

  const trimmedQuery = input.query?.trim();

  if (trimmedQuery !== undefined && trimmedQuery.length > 0) {
    params.set("q", trimmedQuery);
  }

  if (input.projectId !== undefined && input.projectId !== null && input.projectId.length > 0) {
    params.set("projectId", input.projectId);
  }

  return readJson<InboxListViewModel>(`/api/inbox/list?${params.toString()}`);
}

export function fetchInboxTimelinePage(input: {
  readonly contactId: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}): Promise<InboxTimelinePageResponse> {
  const params = new URLSearchParams();

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  if (input.limit !== undefined) {
    params.set("limit", input.limit.toString());
  }

  return readJson<InboxTimelinePageResponse>(
    `/api/inbox/contact/${encodeURIComponent(input.contactId)}/timeline?${params.toString()}`
  );
}

export function fetchInboxFreshness(
  contactId?: string
): Promise<InboxFreshnessResponse> {
  const params = new URLSearchParams();

  if (contactId !== undefined) {
    params.set("contactId", contactId);
  }

  const query = params.toString();
  return readJson<InboxFreshnessResponse>(
    query.length === 0 ? "/api/inbox/freshness" : `/api/inbox/freshness?${query}`
  );
}
