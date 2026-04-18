import { NextResponse } from "next/server";

import { getInboxFreshness } from "../../../inbox/_lib/selectors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get("contactId");

  return NextResponse.json(await getInboxFreshness(contactId ?? undefined));
}
