import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getInboxUnifiedSearch,
  INBOX_UNIFIED_SEARCH_MIN_QUERY_LENGTH,
} from "../../../inbox/_lib/selectors";
import { requireApiSession } from "../../../../src/server/auth/api";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().max(256),
});

/**
 * GET /api/inbox/search
 *
 * Unified search for the existing inbox search bar. Returns two sections,
 * partitioned by membership-existence on the matched contacts:
 *
 * - `volunteers` — contacts matching name / primary email / primary phone
 *   that have at least one `contact_memberships` row (active OR past).
 * - `contacts` — contacts matching the same attributes that have zero
 *   membership rows.
 *
 * Below the min query length (3 characters) the route returns empty arrays
 * without hitting the DB. Each section is capped at 25 in v1; `totals`
 * exposes pre-truncation counts for the UX. Sort key per section is
 * volunteer-side last activity desc — outbound 1:1 sends and campaign
 * events are excluded so an operator's reply doesn't bump a contact up.
 *
 * Distinct from `/api/inbox/list` which returns the folder-filtered queue
 * shape. We picked a dedicated endpoint over overloading `/list` because
 * the response shapes are different enough that a single endpoint with a
 * union return type would be confusing for the client.
 */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    query: searchParams.get("q") ?? searchParams.get("query") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "validation_error" },
      { status: 400 },
    );
  }

  const trimmed = parsed.data.query.trim();

  // Defence-in-depth empty-result short-circuit. `getInboxUnifiedSearch` also
  // checks this before hitting the DB; we re-check here so the route is
  // explicit about the contract for callers reading source.
  if (trimmed.length < INBOX_UNIFIED_SEARCH_MIN_QUERY_LENGTH) {
    return NextResponse.json({
      query: trimmed,
      volunteers: [],
      contacts: [],
      totals: { volunteers: 0, contacts: 0 },
    });
  }

  return NextResponse.json(await getInboxUnifiedSearch({ query: trimmed }));
}
