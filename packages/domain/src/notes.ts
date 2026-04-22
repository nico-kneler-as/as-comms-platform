import { createHash } from "node:crypto";

import {
  canonicalEventSchema,
  manualNoteDetailSchema,
  type CanonicalEventRecord,
  type InboxProjectionRow,
  type ManualNoteDetailRecord,
  type SourceEvidenceRecord,
  type TimelineProjectionRow,
} from "@as-comms/contracts";

import type { Stage1NormalizationService } from "./normalization.js";
import type { Stage1PersistenceService } from "./persistence.js";

export interface Stage1InternalNoteCreateInput {
  readonly noteId: string;
  readonly contactId: string;
  readonly body: string;
  readonly occurredAt: string;
  readonly authorDisplayName?: string | null;
  readonly authorId?: string | null;
}

export interface Stage1InternalNoteCreateResult {
  readonly outcome: "applied" | "duplicate";
  readonly sourceEvidence: SourceEvidenceRecord;
  readonly canonicalEvent: CanonicalEventRecord;
  readonly timelineProjection: TimelineProjectionRow;
  readonly inboxProjection: InboxProjectionRow | null;
  readonly noteDetail: ManualNoteDetailRecord;
}

export interface Stage1InternalNoteService {
  createNote(
    input: Stage1InternalNoteCreateInput,
  ): Promise<Stage1InternalNoteCreateResult>;
  updateNote(input: {
    readonly noteId: string;
    readonly authorId: string;
    readonly body: string;
  }): Promise<{
    readonly outcome: "applied" | "not_authorized" | "not_found";
  }>;
  deleteNote(input: {
    readonly noteId: string;
    readonly authorId: string;
  }): Promise<{
    readonly outcome: "applied" | "not_authorized" | "not_found";
  }>;
}

function buildManualNoteChecksum(input: {
  readonly noteId: string;
  readonly contactId: string;
  readonly body: string;
  readonly occurredAt: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        noteId: input.noteId,
        contactId: input.contactId,
        body: input.body,
        occurredAt: input.occurredAt,
      }),
    )
    .digest("hex");
}

export function createStage1InternalNoteService(input: {
  readonly persistence: Stage1PersistenceService;
  readonly normalization: Pick<
    Stage1NormalizationService,
    "applyTimelineProjection" | "refreshInboxReviewOverlay"
  >;
}): Stage1InternalNoteService {
  async function loadExistingNote(inputValue: {
    readonly noteId: string;
  }): Promise<{
    readonly sourceEvidence: SourceEvidenceRecord;
    readonly noteDetail: ManualNoteDetailRecord;
    readonly canonicalEvent: CanonicalEventRecord | null;
  } | null> {
    const sourceEvidenceId = `source-evidence:manual:note:${inputValue.noteId}`;
    const canonicalEventId = `canonical-event:manual:note:${inputValue.noteId}`;
    const [sourceEvidence, noteDetails, canonicalEvent] = await Promise.all([
      input.persistence.repositories.sourceEvidence.findById(sourceEvidenceId),
      input.persistence.repositories.manualNoteDetails.listBySourceEvidenceIds([
        sourceEvidenceId,
      ]),
      input.persistence.repositories.canonicalEvents.findById(canonicalEventId),
    ]);

    if (sourceEvidence === null) {
      return null;
    }

    const noteDetail = noteDetails[0] ?? null;

    if (noteDetail === null) {
      return null;
    }

    return {
      sourceEvidence,
      noteDetail,
      canonicalEvent,
    };
  }

  return {
    async createNote(noteInput) {
      const contact = await input.persistence.repositories.contacts.findById(
        noteInput.contactId,
      );

      if (contact === null) {
        throw new Error(`Contact ${noteInput.contactId} was not found.`);
      }

      const sourceEvidenceId = `source-evidence:manual:note:${noteInput.noteId}`;
      const sourceEvidence = {
        id: sourceEvidenceId,
        provider: "manual" as const,
        providerRecordType: "note",
        providerRecordId: noteInput.noteId,
        receivedAt: noteInput.occurredAt,
        occurredAt: noteInput.occurredAt,
        payloadRef: `manual://note/${noteInput.noteId}`,
        idempotencyKey: `manual:note:${noteInput.noteId}`,
        checksum: buildManualNoteChecksum(noteInput),
      };

      const sourceEvidenceResult =
        await input.persistence.recordSourceEvidence(sourceEvidence);

      if (sourceEvidenceResult.outcome === "conflict") {
        throw new Error(
          `Manual note ${noteInput.noteId} conflicted with existing source evidence.`,
        );
      }

      const canonicalEvent = canonicalEventSchema.parse({
        id: `canonical-event:manual:note:${noteInput.noteId}`,
        contactId: noteInput.contactId,
        eventType: "note.internal.created",
        channel: "note",
        occurredAt: noteInput.occurredAt,
        sourceEvidenceId: sourceEvidenceResult.record.id,
        idempotencyKey: `canonical-event:manual:note:${noteInput.noteId}`,
        provenance: {
          primaryProvider: "manual",
          primarySourceEvidenceId: sourceEvidenceResult.record.id,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "note",
          sourceRecordId: noteInput.noteId,
          messageKind: null,
          campaignRef: null,
          threadRef: null,
          direction: null,
          notes: null,
        },
        reviewState: "clear",
      });

      const canonicalEventResult =
        await input.persistence.persistCanonicalEvent(canonicalEvent);

      if (canonicalEventResult.outcome === "conflict") {
        throw new Error(
          `Manual note ${noteInput.noteId} conflicted with existing canonical event state.`,
        );
      }

      const noteDetail = await input.persistence.upsertManualNoteDetail(
        manualNoteDetailSchema.parse({
          sourceEvidenceId: sourceEvidenceResult.record.id,
          providerRecordId: noteInput.noteId,
          body: noteInput.body,
          authorDisplayName: noteInput.authorDisplayName ?? null,
          authorId: noteInput.authorId ?? null,
        }),
      );

      const persistedEvent = canonicalEventResult.record;
      const timelineProjection =
        await input.normalization.applyTimelineProjection({
          canonicalEvent: persistedEvent,
          summary: "Internal note added",
        });
      const inboxProjection =
        await input.normalization.refreshInboxReviewOverlay({
          contactId: noteInput.contactId,
        });

      return {
        outcome:
          sourceEvidenceResult.outcome === "inserted" &&
          canonicalEventResult.outcome === "inserted"
            ? "applied"
            : "duplicate",
        sourceEvidence: sourceEvidenceResult.record,
        canonicalEvent: persistedEvent,
        timelineProjection,
        inboxProjection,
        noteDetail,
      };
    },

    async updateNote(updateInput) {
      const existing = await loadExistingNote({
        noteId: updateInput.noteId,
      });

      if (existing === null) {
        return {
          outcome: "not_found",
        };
      }

      const updated =
        await input.persistence.repositories.manualNoteDetails.updateBody({
          sourceEvidenceId: existing.sourceEvidence.id,
          authorId: updateInput.authorId,
          body: updateInput.body,
        });

      if (updated === null) {
        return {
          outcome: "not_authorized",
        };
      }

      return {
        outcome: "applied",
      };
    },

    async deleteNote(deleteInput) {
      const existing = await loadExistingNote({
        noteId: deleteInput.noteId,
      });

      if (existing === null) {
        return {
          outcome: "not_found",
        };
      }

      const deletedCount =
        await input.persistence.repositories.manualNoteDetails.deleteByAuthor({
          sourceEvidenceId: existing.sourceEvidence.id,
          authorId: deleteInput.authorId,
        });

      if (deletedCount === 0) {
        return {
          outcome: "not_authorized",
        };
      }

      if (existing.canonicalEvent !== null) {
        await input.normalization.refreshInboxReviewOverlay({
          contactId: existing.canonicalEvent.contactId,
        });
      }

      return {
        outcome: "applied",
      };
    },
  };
}
