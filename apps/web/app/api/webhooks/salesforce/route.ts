import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { automatedEmailWebhookPayloadSchema } from "@as-comms/contracts";

import { enqueueAutomatedEmailSendJob } from "@/src/server/automated-email/enqueue";
import { readWebEnv } from "@/src/server/env";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

function accepted() {
  return NextResponse.json({ accepted: true }, { status: 202 });
}

function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      code: "invalid_automated_email_secret",
      message: "Automated email webhook secret did not match.",
    },
    { status: 401 },
  );
}

function malformedPayload() {
  return NextResponse.json(
    {
      ok: false,
      code: "invalid_automated_email_payload",
      message: "Automated email webhook payload is invalid.",
    },
    { status: 400 },
  );
}

function secretsMatch(expected: string, supplied: string | null): boolean {
  if (supplied === null) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function POST(request: Request) {
  const env = readWebEnv();
  const suppliedSecret = request.headers.get("x-automated-email-secret");

  if (
    env.AUTOMATED_EMAIL_WEBHOOK_SECRET === undefined ||
    !secretsMatch(env.AUTOMATED_EMAIL_WEBHOOK_SECRET, suppliedSecret)
  ) {
    return unauthorized();
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return malformedPayload();
  }

  const parsedPayload =
    automatedEmailWebhookPayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    return malformedPayload();
  }

  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error(
      "DATABASE_URL must be set before receiving automated email webhooks.",
    );
  }

  const template = await runtime.automatedEmails.getTemplateById(
    parsedPayload.data.templateId,
  );
  if (template === null) {
    console.warn(
      JSON.stringify({
        event: "automated_email.webhook.unknown_template",
        templateId: parsedPayload.data.templateId,
        expeditionMemberId: parsedPayload.data.expeditionMemberId,
        flowApiName: parsedPayload.data.flowApiName ?? null,
      }),
    );
    return accepted();
  }

  const send = await runtime.automatedEmails.createSendLogRow({
    templateId: template.id,
    projectId: template.projectId,
    expeditionMemberId: parsedPayload.data.expeditionMemberId,
    contactId: null,
    payload: parsedPayload.data,
  });

  await enqueueAutomatedEmailSendJob({
    runtime,
    sendId: send.id,
  });

  return accepted();
}
