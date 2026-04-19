import { NextResponse } from "next/server";

import { getInboxFreshness } from "../../../inbox/_lib/selectors";
import { requireApiSession } from "../../../../src/server/auth/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get("contactId");

  return NextResponse.json(await getInboxFreshness(contactId ?? undefined));
}
