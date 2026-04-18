import { NextResponse } from "next/server";

import { getInboxTimelinePage } from "../../../../../inbox/_lib/selectors";

export const dynamic = "force-dynamic";

function parseLimit(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(100, Math.max(1, parsed));
}

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly contactId: string;
    }>;
  }
) {
  const { searchParams } = new URL(request.url);
  const { contactId } = await context.params;
  const limit = parseLimit(searchParams.get("limit"));
  const page = await getInboxTimelinePage(decodeURIComponent(contactId), {
    cursor: searchParams.get("cursor"),
    ...(limit === undefined ? {} : { limit })
  });

  if (page === null) {
    return NextResponse.json(
      {
        ok: false,
        code: "inbox_contact_not_found"
      },
      {
        status: 404
      }
    );
  }

  return NextResponse.json(page);
}
