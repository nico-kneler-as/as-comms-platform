import { NextResponse } from "next/server";
import { z } from "zod";

import { getAllContactsSearchPage } from "../../../inbox/_lib/all-contacts-search";
import { requireApiSession } from "../../../../src/server/auth/api";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().min(1).max(256),
  cursor: z.string().nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * GET /api/contacts/search
 *
 * "All contacts" search scope — bypasses `contact_inbox_projection` and
 * queries the `contacts` table directly so volunteer-support operators can
 * find any volunteer in the database, even those with only signup/lifecycle
 * events or no events at all.
 *
 * Distinct from `/api/inbox/list?q=...` which only searches across
 * inbox-driving comm-event rows.
 */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    query: searchParams.get("q") ?? searchParams.get("query") ?? "",
    cursor: searchParams.get("cursor"),
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "validation_error",
      },
      { status: 400 },
    );
  }

  const page = await getAllContactsSearchPage({
    query: parsed.data.query,
    cursor: parsed.data.cursor ?? null,
    limit: parsed.data.limit ?? null,
  });

  return NextResponse.json(page);
}
