import type { InternalNoteRecord } from "./repositories.js";
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
  readonly note: InternalNoteRecord;
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
    readonly actorIsAdmin?: boolean;
  }): Promise<{
    readonly outcome: "applied" | "not_authorized" | "not_found";
  }>;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (error as { readonly code?: unknown }).code === "23505";
}

export function createStage1InternalNoteService(input: {
  readonly persistence: Stage1PersistenceService;
  readonly normalization: Pick<
    Stage1NormalizationService,
    "applyTimelineProjection" | "refreshInboxReviewOverlay"
  >;
}): Stage1InternalNoteService {
  void input.normalization;

  return {
    async createNote(noteInput) {
      const contact = await input.persistence.repositories.contacts.findById(
        noteInput.contactId,
      );

      if (contact === null) {
        throw new Error(`Contact ${noteInput.contactId} was not found.`);
      }

      if (
        typeof noteInput.authorId !== "string" ||
        noteInput.authorId.trim().length === 0
      ) {
        throw new Error("Internal notes require an authorId.");
      }

      const existing = await input.persistence.repositories.internalNotes.findById(
        noteInput.noteId,
      );

      if (existing !== undefined) {
        return {
          outcome: "duplicate",
          note: existing,
        };
      }

      const createdAt = new Date(noteInput.occurredAt);

      try {
        const note = await input.persistence.repositories.internalNotes.create({
          id: noteInput.noteId,
          contactId: noteInput.contactId,
          body: noteInput.body,
          authorId: noteInput.authorId,
          createdAt,
          updatedAt: createdAt,
        });

        return {
          outcome: "applied",
          note,
        };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const duplicate =
          await input.persistence.repositories.internalNotes.findById(
            noteInput.noteId,
          );

        if (duplicate === undefined) {
          throw error;
        }

        return {
          outcome: "duplicate",
          note: duplicate,
        };
      }
    },

    async updateNote(updateInput) {
      const existing = await input.persistence.repositories.internalNotes.findById(
        updateInput.noteId,
      );

      if (existing === undefined) {
        return {
          outcome: "not_found",
        };
      }

      if (existing.authorId !== updateInput.authorId) {
        return {
          outcome: "not_authorized",
        };
      }

      await input.persistence.repositories.internalNotes.update({
        id: updateInput.noteId,
        body: updateInput.body,
      });

      return {
        outcome: "applied",
      };
    },

    async deleteNote(deleteInput) {
      const existing = await input.persistence.repositories.internalNotes.findById(
        deleteInput.noteId,
      );

      if (existing === undefined) {
        return {
          outcome: "not_found",
        };
      }

      if (
        !deleteInput.actorIsAdmin &&
        existing.authorId !== deleteInput.authorId
      ) {
        return {
          outcome: "not_authorized",
        };
      }

      await input.persistence.repositories.internalNotes.delete(
        deleteInput.noteId,
      );

      return {
        outcome: "applied",
      };
    },
  };
}
