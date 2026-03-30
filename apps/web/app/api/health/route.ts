import { NextResponse } from "next/server";

import { getStage0HealthSnapshot } from "../../../src/server/readiness";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getStage0HealthSnapshot());
}
