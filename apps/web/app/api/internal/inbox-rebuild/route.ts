import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  isInboxDrivingCanonicalEvent,
  type Stage1PersistenceService
} from "@as-comms/domain";
import type { CanonicalEventRecord } from "@as-comms/contracts";

import { revalidateInboxViews } from "../../../../src/server/inbox/revalidate";
import { getStage1WebRuntime } from "../../../../src/server/stage1-runtime";

export const dynamic = "force-dynamic";

const rebuildRequestSchema = z.object({
  contactIds: z.array(z.string().min(1)).default([]),
  selection: z.enum(["all", "invalid"]).default("all")
});

function isAuthorized(request: Request): boolean {
  const expectedToken = process.env.INTERNAL_INBOX_REBUILD_TOKEN;

  if (!expectedToken || expectedToken.trim().length === 0) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}

function compareCanonicalEventOrder(
  left: CanonicalEventRecord,
  right: CanonicalEventRecord
): number {
  if (left.occurredAt < right.occurredAt) {
    return -1;
  }

  if (left.occurredAt > right.occurredAt) {
    return 1;
  }

  return left.id.localeCompare(right.id);
}

async function rebuildInboxProjectionForContact(
  persistence: Stage1PersistenceService,
  normalization: ReturnType<typeof createStage1NormalizationService>,
  deleteInboxProjectionByContactId: (contactId: string) => Promise<void>,
  contactId: string
): Promise<number> {
  const canonicalEvents = [...(
    await persistence.repositories.canonicalEvents.listByContactId(contactId)
  )].sort(compareCanonicalEventOrder);

  await deleteInboxProjectionByContactId(contactId);

  let rebuiltInboxRows = 0;

  for (const event of canonicalEvents) {
    if (!isInboxDrivingCanonicalEvent(event)) {
      continue;
    }

    await normalization.applyInboxProjection({
      canonicalEvent: event,
      snippet: await loadInboxSnippetForEvent(persistence, event)
    });
    rebuiltInboxRows += 1;
  }

  await normalization.refreshInboxReviewOverlay({
    contactId
  });

  return rebuiltInboxRows;
}

async function loadInboxSnippetForEvent(
  persistence: Stage1PersistenceService,
  event: CanonicalEventRecord
): Promise<string> {
  const sourceEvidenceIds = [event.sourceEvidenceId];

  if (event.eventType === "communication.email.inbound" || event.eventType === "communication.email.outbound") {
    const [gmailDetail] =
      await persistence.repositories.gmailMessageDetails.listBySourceEvidenceIds(
        sourceEvidenceIds
      );

    if (gmailDetail !== undefined) {
      return gmailDetail.bodyTextPreview || gmailDetail.snippetClean || "";
    }

    const [salesforceDetail] =
      await persistence.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
        sourceEvidenceIds
      );

    return salesforceDetail?.snippet ?? "";
  }

  const [simpleTextingDetail] =
    await persistence.repositories.simpleTextingMessageDetails.listBySourceEvidenceIds(
      sourceEvidenceIds
    );

  if (simpleTextingDetail !== undefined) {
    return simpleTextingDetail.messageTextPreview || "";
  }

  const [salesforceDetail] =
    await persistence.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
      sourceEvidenceIds
    );

  return salesforceDetail?.snippet ?? "";
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        code: "unauthorized"
      },
      {
        status: 401
      }
    );
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        code: "forbidden"
      },
      {
        status: 403
      }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = rebuildRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "validation_error"
      },
      {
        status: 400
      }
    );
  }

  const runtime = await getStage1WebRuntime();

  if (runtime.connection === null) {
    throw new Error("Stage 1 inbox rebuild requires a live database connection.");
  }

  const { connection } = runtime;
  const persistence = createStage1PersistenceService(runtime.repositories);
  const normalization = createStage1NormalizationService(persistence);
  const invalidBefore = await runtime.repositories.inboxProjection.countInvalidRecencyRows();
  const contactIds =
    parsed.data.contactIds.length > 0
      ? parsed.data.contactIds
      : parsed.data.selection === "invalid"
        ? await runtime.repositories.inboxProjection.listInvalidRecencyContactIds()
      : (await runtime.repositories.contacts.listAll()).map((contact) => contact.id);
  const deleteInboxProjectionByContactId = async (contactId: string): Promise<void> => {
    await connection.sql`
      delete from contact_inbox_projection
      where contact_id = ${contactId}
    `;
  };

  let rebuiltInboxRows = 0;

  for (const contactId of contactIds) {
    rebuiltInboxRows += await rebuildInboxProjectionForContact(
      persistence,
      normalization,
      deleteInboxProjectionByContactId,
      contactId
    );
  }

  revalidateInboxViews({
    contactIds
  });

  const invalidAfter = await runtime.repositories.inboxProjection.countInvalidRecencyRows();

  return NextResponse.json({
    ok: true,
    selection: parsed.data.selection,
    rebuiltContactIds: contactIds,
    rebuiltInboxRows,
    invalidBefore,
    invalidAfter
  });
}
