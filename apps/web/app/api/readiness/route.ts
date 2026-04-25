import { NextResponse } from "next/server";

import { resolveAdminSession } from "@/src/server/auth/api";
import { getStage0ReadinessSnapshot } from "@/src/server/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  // Defensively treat any auth-resolution failure as "not an admin caller".
  // auth.js can throw when AUTH_SECRET is missing (e.g. in smoke-test envs);
  // we still want readiness to answer 200 in that case so liveness probes work.
  let isAdmin = false;
  try {
    const session = await resolveAdminSession();
    isAdmin = session.ok;
  } catch {
    isAdmin = false;
  }

  if (!isAdmin) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(getStage0ReadinessSnapshot());
}
