import { and, desc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  AutomatedEmailKind,
  AutomatedEmailTemplateRecord,
} from "@as-comms/contracts";

import {
  mapAutomatedEmailTemplateInsert,
  mapAutomatedEmailTemplateRow,
  type AutomatedEmailTemplateRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import {
  automatedEmailSends,
  automatedEmailTemplates,
} from "./schema/index.js";

type AutomatedEmailTemplatesDatabase = PgDatabase<
  PgQueryResultHKT,
  DatabaseSchema
>;

export interface CreateAutomatedEmailTemplateInput {
  readonly projectId: string;
  readonly kind?: AutomatedEmailKind;
  readonly name: string;
  readonly draftSubject?: string;
  readonly draftDoc?: unknown;
  readonly createdBy: string | null;
}

export interface UpdateAutomatedEmailDraftInput {
  readonly draftSubject: string;
  readonly draftDoc: unknown;
  readonly baselineUpdatedAt: string;
}

export type UpdateAutomatedEmailDraftResult =
  | AutomatedEmailTemplateRecord
  | Readonly<{ conflict: true }>;

/**
 * Deleting an automated email is irreversible and the template id is what
 * Salesforce flows point at, so it is refused for anything with a history:
 * a template that is switched on, that has ever been published, or that any
 * webhook has already reached. Those need deactivating or superseding, not
 * removing.
 */
export type DeleteAutomatedEmailTemplateResult =
  | Readonly<{ outcome: "deleted" }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "blocked"; reason: "active" | "published" | "has_sends" }>;

function toAutomatedEmailTemplateRow(
  row: typeof automatedEmailTemplates.$inferSelect,
): AutomatedEmailTemplateRow {
  return {
    id: row.id,
    project_id: row.projectId,
    kind: row.kind,
    name: row.name,
    draft_subject: row.draftSubject,
    draft_doc: row.draftDoc,
    published_subject: row.publishedSubject,
    published_doc: row.publishedDoc,
    published_at: row.publishedAt,
    published_by: row.publishedBy,
    is_active: row.isActive,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapTemplate(
  row: typeof automatedEmailTemplates.$inferSelect,
): AutomatedEmailTemplateRecord {
  return mapAutomatedEmailTemplateRow(toAutomatedEmailTemplateRow(row));
}

export async function createTemplate(
  db: AutomatedEmailTemplatesDatabase,
  input: CreateAutomatedEmailTemplateInput,
): Promise<AutomatedEmailTemplateRecord> {
  const [row] = await db
    .insert(automatedEmailTemplates)
    .values(mapAutomatedEmailTemplateInsert(input))
    .returning();

  if (row === undefined) {
    throw new Error("Failed to create automated email template.");
  }

  return mapTemplate(row);
}

export async function getTemplateById(
  db: AutomatedEmailTemplatesDatabase,
  id: string,
): Promise<AutomatedEmailTemplateRecord | null> {
  const [row] = await db
    .select()
    .from(automatedEmailTemplates)
    .where(eq(automatedEmailTemplates.id, id))
    .limit(1);

  return row === undefined ? null : mapTemplate(row);
}

export async function listTemplatesByProject(
  db: AutomatedEmailTemplatesDatabase,
  projectId: string,
): Promise<readonly AutomatedEmailTemplateRecord[]> {
  const rows = await db
    .select()
    .from(automatedEmailTemplates)
    .where(eq(automatedEmailTemplates.projectId, projectId))
    .orderBy(
      desc(automatedEmailTemplates.createdAt),
      desc(automatedEmailTemplates.id),
    );

  return rows.map(mapTemplate);
}

export async function updateDraft(
  db: AutomatedEmailTemplatesDatabase,
  id: string,
  input: UpdateAutomatedEmailDraftInput,
): Promise<UpdateAutomatedEmailDraftResult> {
  const observedUpdatedAtMs = new Date(
    Math.floor(new Date(input.baselineUpdatedAt).getTime()),
  );

  if (Number.isNaN(observedUpdatedAtMs.getTime())) {
    throw new Error("Invalid automated email draft update baseline.");
  }

  const [row] = await db
    .update(automatedEmailTemplates)
    .set({
      draftSubject: input.draftSubject,
      draftDoc: input.draftDoc,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(automatedEmailTemplates.id, id),
        // The stored timestamp may have microseconds while the client baseline
        // has millisecond ISO precision. Match its [ms, ms + 1) interval.
        gte(automatedEmailTemplates.updatedAt, observedUpdatedAtMs),
        lt(
          automatedEmailTemplates.updatedAt,
          new Date(observedUpdatedAtMs.getTime() + 1),
        ),
      ),
    )
    .returning();

  return row === undefined ? { conflict: true } : mapTemplate(row);
}

export async function renameTemplate(
  db: AutomatedEmailTemplatesDatabase,
  id: string,
  name: string,
): Promise<AutomatedEmailTemplateRecord> {
  const [row] = await db
    .update(automatedEmailTemplates)
    .set({ name, updatedAt: new Date() })
    .where(eq(automatedEmailTemplates.id, id))
    .returning();

  if (row === undefined) {
    throw new Error(`Automated email template ${id} was not found.`);
  }

  return mapTemplate(row);
}

export async function publishTemplate(
  db: AutomatedEmailTemplatesDatabase,
  id: string,
  publishedBy: string | null,
): Promise<AutomatedEmailTemplateRecord> {
  const [row] = await db
    .update(automatedEmailTemplates)
    .set({
      publishedSubject: sql`${automatedEmailTemplates.draftSubject}`,
      publishedDoc: sql`${automatedEmailTemplates.draftDoc}`,
      publishedAt: new Date(),
      publishedBy,
      updatedAt: new Date(),
    })
    .where(eq(automatedEmailTemplates.id, id))
    .returning();

  if (row === undefined) {
    throw new Error(`Automated email template ${id} was not found.`);
  }

  return mapTemplate(row);
}

export async function setTemplateActive(
  db: AutomatedEmailTemplatesDatabase,
  id: string,
  isActive: boolean,
): Promise<AutomatedEmailTemplateRecord> {
  const [row] = await db
    .update(automatedEmailTemplates)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(automatedEmailTemplates.id, id))
    .returning();

  if (row === undefined) {
    throw new Error(`Automated email template ${id} was not found.`);
  }

  return mapTemplate(row);
}

export async function findLatestPublishedByKind(
  db: AutomatedEmailTemplatesDatabase,
  kind: AutomatedEmailKind,
  options: Readonly<{ excludeProjectId?: string }> = {},
): Promise<AutomatedEmailTemplateRecord | null> {
  const whereClause =
    options.excludeProjectId === undefined
      ? and(
          eq(automatedEmailTemplates.kind, kind),
          isNotNull(automatedEmailTemplates.publishedSubject),
          isNotNull(automatedEmailTemplates.publishedDoc),
          isNotNull(automatedEmailTemplates.publishedAt),
        )
      : and(
          eq(automatedEmailTemplates.kind, kind),
          ne(automatedEmailTemplates.projectId, options.excludeProjectId),
          isNotNull(automatedEmailTemplates.publishedSubject),
          isNotNull(automatedEmailTemplates.publishedDoc),
          isNotNull(automatedEmailTemplates.publishedAt),
        );
  const [row] = await db
    .select()
    .from(automatedEmailTemplates)
    .where(whereClause)
    .orderBy(
      desc(automatedEmailTemplates.publishedAt),
      desc(automatedEmailTemplates.id),
    )
    .limit(1);

  return row === undefined ? null : mapTemplate(row);
}

export async function deleteTemplate(
  db: AutomatedEmailTemplatesDatabase,
  id: string,
): Promise<DeleteAutomatedEmailTemplateResult> {
  const template = await getTemplateById(db, id);
  if (template === null) {
    return { outcome: "not_found" };
  }

  if (template.isActive) {
    return { outcome: "blocked", reason: "active" };
  }

  if (template.publishedAt !== null) {
    return { outcome: "blocked", reason: "published" };
  }

  const [send] = await db
    .select({ id: automatedEmailSends.id })
    .from(automatedEmailSends)
    .where(eq(automatedEmailSends.templateId, id))
    .limit(1);
  if (send !== undefined) {
    return { outcome: "blocked", reason: "has_sends" };
  }

  await db
    .delete(automatedEmailTemplates)
    .where(eq(automatedEmailTemplates.id, id));

  return { outcome: "deleted" };
}
