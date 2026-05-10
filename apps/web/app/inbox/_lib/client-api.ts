"use client";

import type {
  InboxDetailFreshnessViewModel,
  InboxDetailTimelinePageViewModel,
  InboxFilterId,
  InboxListViewModel,
  InboxTimelineEntryViewModel,
  InboxUnifiedSearchViewModel,
} from "./view-models";

export interface InboxTimelinePageResponse {
  readonly entries: readonly InboxTimelineEntryViewModel[];
  readonly page: InboxDetailTimelinePageViewModel;
}

export interface InboxFreshnessResponse {
  readonly list: InboxListViewModel["freshness"];
  readonly detail: InboxDetailFreshnessViewModel | null;
}

/**
 * Typed error thrown by inbox client fetchers when an HTTP request returns a
 * non-OK status. Surfacing `status` lets callers distinguish HTTP failures
 * (where we have a status) from network/parse failures (where we don't), and
 * lets the UI display a meaningful error label without leaking request
 * payloads, headers, or URLs.
 */
export class InboxFetchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "InboxFetchError";
    this.status = status;
  }
}

async function readJson<T>(input: RequestInfo | URL): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new InboxFetchError(
      `Request failed with status ${response.status.toString()}.`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

export function fetchInboxListPage(input: {
  readonly filterId: InboxFilterId;
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly projectId?: string | null;
}): Promise<InboxListViewModel> {
  const params = new URLSearchParams({
    filter: input.filterId,
  });

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  if (input.limit !== undefined) {
    params.set("limit", input.limit.toString());
  }

  if (
    input.projectId !== undefined &&
    input.projectId !== null &&
    input.projectId.length > 0
  ) {
    params.set("projectId", input.projectId);
  }

  return readJson<InboxListViewModel>(`/api/inbox/list?${params.toString()}`);
}

export function fetchInboxUnifiedSearch(input: {
  readonly query: string;
}): Promise<InboxUnifiedSearchViewModel> {
  const params = new URLSearchParams({ q: input.query.trim() });
  return readJson<InboxUnifiedSearchViewModel>(
    `/api/inbox/search?${params.toString()}`,
  );
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
    `/api/inbox/contact/${encodeURIComponent(input.contactId)}/timeline?${params.toString()}`,
  );
}

export function fetchInboxFreshness(
  contactId?: string,
): Promise<InboxFreshnessResponse> {
  const params = new URLSearchParams();

  if (contactId !== undefined) {
    params.set("contactId", contactId);
  }

  const query = params.toString();
  return readJson<InboxFreshnessResponse>(
    query.length === 0
      ? "/api/inbox/freshness"
      : `/api/inbox/freshness?${query}`,
  );
}
