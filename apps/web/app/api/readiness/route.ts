import { NextResponse } from "next/server";

import { getStage0ReadinessSnapshot } from "../../../src/server/readiness";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getStage0ReadinessSnapshot());
}
