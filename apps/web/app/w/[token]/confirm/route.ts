import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  createConsentLedger,
  createStage1PersistenceService,
} from "@as-comms/domain";
import {
  salesforceExpeditionMemberWithdrawJobMaxAttempts,
  salesforceExpeditionMemberWithdrawJobName,
  salesforceExpeditionMemberWithdrawPayloadSchema,
} from "@as-comms/contracts";

import {
  getStage1WebRuntime,
  withStage1WebTransaction,
} from "@/src/server/stage1-runtime";
import { enforceRateLimit, getClientIp } from "@/src/server/security/rate-limit";

import { hashWithdrawIp, resolveExpeditionWithdrawToken } from "../_lib/withdraw";

export const dynamic = "force-dynamic";

function redirect(request: Request, token: string, done: boolean): NextResponse {
  return NextResponse.redirect(
    new URL(`/w/${encodeURIComponent(token)}${done ? "?done=1" : ""}`, request.url),
    { status: 303 },
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
) {
  const { token } = await context.params;
  const decodedToken = decodeURIComponent(token);
  const ipHash = hashWithdrawIp(getClientIp(request));
  const rateLimit = await enforceRateLimit({
    scope: "expedition.withdraw",
    identifier: ipHash,
    limit: 20,
    audit: {
      actorType: "system",
      actorId: "public-withdraw-link",
      action: "expedition_withdraw.rate_limited",
      entityType: "route",
      entityId: "expedition.withdraw",
    },
  });
  if (!rateLimit.allowed) {
    return new NextResponse("Too many requests.", {
      status: 429,
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const target = resolveExpeditionWithdrawToken(decodedToken);
  if (target === null) return redirect(request, decodedToken, false);

  const runtime = await getStage1WebRuntime();
  const membership =
    (await runtime.repositories.contactMemberships.findBySalesforceMembershipId(
      target.expeditionMemberId,
    )) ?? null;
  const contact = membership === null
    ? null
    : await runtime.repositories.contacts.findById(membership.contactId);
  const project = await runtime.settings.projects.findById(
    membership?.projectId ?? target.projectId,
  );
  const projectName = project?.projectName ?? "this project";
  const now = new Date();

  const contactEmail = contact?.primaryEmail ?? null;
  if (membership !== null && contact !== null && contactEmail !== null) {
    await withStage1WebTransaction(async (transaction) => {
      await createConsentLedger({ repositories: transaction.campaigns }).recordOptOut({
        contactId: contact.id,
        scope: { type: "project", id: membership.projectId ?? target.projectId },
        source: "recipient_click",
        // No sourceRunId: contact_consent.source_run_id must reference a campaign
        // run, and a withdrawal isn't one. The timeline event records the origin.
        email: contactEmail,
      });
      const persistence = createStage1PersistenceService(transaction.repositories);
      const sourceEvidenceId = `source:withdraw:${target.expeditionMemberId}`;
      const eventId = `canonical:withdraw:${target.expeditionMemberId}`;
      // A repeat POST (double-click, reopened link) must succeed quietly: the
      // event carries the time of the first confirmation, so a second write
      // would read as a conflict.
      if ((await transaction.repositories.canonicalEvents.findById(eventId)) !== null) {
        return;
      }
      const sourceEvidence = await persistence.recordSourceEvidence({
        id: sourceEvidenceId,
        provider: "manual",
        providerRecordType: "platform_withdraw_link",
        providerRecordId: target.expeditionMemberId,
        receivedAt: now.toISOString(),
        occurredAt: now.toISOString(),
        payloadRef: `platform://withdraw/${target.expeditionMemberId}`,
        idempotencyKey: `withdraw:${target.expeditionMemberId}`,
        checksum: sha256(`withdraw:${target.expeditionMemberId}`),
      });
      if (sourceEvidence.outcome === "conflict") throw new Error("withdraw_source_conflict");
      const event = await persistence.persistCanonicalEvent({
        id: eventId,
        contactId: contact.id,
        eventType: "lifecycle.withdrew_from_project",
        channel: "lifecycle",
        occurredAt: now.toISOString(),
        contentFingerprint: null,
        sourceEvidenceId: sourceEvidence.record.id,
        idempotencyKey: `withdraw:${target.expeditionMemberId}`,
        provenance: {
          primaryProvider: "manual",
          primarySourceEvidenceId: sourceEvidence.record.id,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "platform_withdraw_link",
          sourceRecordId: target.expeditionMemberId,
          messageKind: null,
          campaignRef: null,
          threadRef: null,
          direction: null,
          notes: `Withdrew from ${projectName} via email link`,
        },
        reviewState: "clear",
      });
      if (event.outcome === "conflict") throw new Error("withdraw_event_conflict");
    });
  } else {
    console.info(JSON.stringify({
      event: "expedition_withdraw.membership_not_found",
      expeditionMemberId: target.expeditionMemberId,
    }));
  }

  if (runtime.connection !== null) {
    const payload = salesforceExpeditionMemberWithdrawPayloadSchema.parse({
      expeditionMemberId: target.expeditionMemberId,
      requestedAt: now.toISOString(),
    });
    await runtime.connection.sql`
      select graphile_worker.add_job(
        identifier => ${salesforceExpeditionMemberWithdrawJobName},
        payload => ${JSON.stringify(payload)}::json,
        job_key => ${`expedition-withdraw:${target.expeditionMemberId}`},
        job_key_mode => 'preserve_run_at',
        max_attempts => ${salesforceExpeditionMemberWithdrawJobMaxAttempts}
      )
    `;
  }
  return redirect(request, decodedToken, true);
}
