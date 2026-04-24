import { NextResponse } from "next/server";

import { resolveAdminSession } from "@/src/server/auth/api";
import { getStage0ReadinessSnapshot } from "@/src/server/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await resolveAdminSession();
  if (!session.ok) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(getStage0ReadinessSnapshot());
}
