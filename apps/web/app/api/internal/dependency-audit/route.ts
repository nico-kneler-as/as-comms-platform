import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  dependencyAuditSummaryId,
  dependencyAuditSummaryPayloadSchema,
} from "@as-comms/contracts";

import { getStage1WebRuntime } from "../../../../src/server/stage1-runtime";

export const dynamic = "force-dynamic";

const dependencyAuditSecretHeader = "x-as-comms-dependency-audit-secret";

function deny(status: number) {
  return NextResponse.json(
    {
      ok: false,
    },
    {
      status,
    },
  );
}

function matchesSecret(received: string, expected: string): boolean {
  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(received, "utf8"),
    Buffer.from(expected, "utf8"),
  );
}

export async function POST(request: Request) {
  const expectedSecret = process.env.DEPENDENCY_AUDIT_FEED_SECRET?.trim();

  if (!expectedSecret || expectedSecret.length === 0) {
    return deny(500);
  }

  const receivedSecret = request.headers.get(dependencyAuditSecretHeader);

  if (receivedSecret === null || receivedSecret.trim().length === 0) {
    return deny(400);
  }

  if (!matchesSecret(receivedSecret, expectedSecret)) {
    return deny(401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return deny(400);
  }

  const parsed = dependencyAuditSummaryPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return deny(400);
  }

  const runtime = await getStage1WebRuntime();
  const existing = await runtime.settings.dependencyAuditSummary.get();
  const now = new Date().toISOString();

  await runtime.settings.dependencyAuditSummary.upsert({
    id: dependencyAuditSummaryId,
    generatedAt: parsed.data.generatedAt,
    exitStatus: parsed.data.exitStatus,
    advisories: parsed.data.advisories,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return NextResponse.json({
    ok: true,
  });
}
