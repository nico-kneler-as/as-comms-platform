import { NextResponse } from "next/server";
import { z } from "zod";

import { getInboxList } from "../../../inbox/_lib/selectors";
import { requireApiSession } from "../../../../src/server/auth/api";

export const dynamic = "force-dynamic";

const filterSchema = z.enum([
  "all",
  "unread",
  "follow-up",
  "unresolved",
  "sent",
]);

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

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const { searchParams } = new URL(request.url);
  const parsedFilter = filterSchema.safeParse(
    searchParams.get("filter") ?? "all",
  );
  const limit = parseLimit(searchParams.get("limit"));

  if (!parsedFilter.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "validation_error",
      },
      {
        status: 400,
      },
    );
  }

  const rawProjectId = searchParams.get("projectId");
  const projectId =
    rawProjectId === null || rawProjectId.trim().length === 0
      ? null
      : rawProjectId.trim();

  return NextResponse.json(
    await getInboxList(parsedFilter.data, {
      cursor: searchParams.get("cursor"),
      ...(limit === undefined ? {} : { limit }),
      query: searchParams.get("q") ?? searchParams.get("query"),
      projectId,
    }),
  );
}
