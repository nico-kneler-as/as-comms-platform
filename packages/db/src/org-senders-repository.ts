import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  updateOrgSenderInputSchema,
  type CreateOrgSenderInput,
  type OrgSenderRecord,
  type UpdateOrgSenderInput,
} from "@as-comms/contracts";

import {
  mapOrgSenderInsert,
  mapOrgSenderRow,
  type OrgSenderRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import { orgSenders } from "./schema/index.js";

type OrgSendersDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

export interface ListOrgSendersInput {
  readonly enabledOnly?: boolean;
}

function toOrgSenderRow(row: typeof orgSenders.$inferSelect): OrgSenderRow {
  return {
    id: row.id,
    email: row.email,
    label: row.label,
    enabled: row.enabled,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function createOrgSender(
  db: OrgSendersDatabase,
  input: CreateOrgSenderInput,
): Promise<OrgSenderRecord> {
  const values = mapOrgSenderInsert(input);
  const [row] = await db.insert(orgSenders).values(values).returning();

  if (row === undefined) {
    throw new Error("Failed to create org sender.");
  }

  return mapOrgSenderRow(toOrgSenderRow(row));
}

export async function listOrgSenders(
  db: OrgSendersDatabase,
  input: ListOrgSendersInput = {},
): Promise<readonly OrgSenderRecord[]> {
  const rows = input.enabledOnly
    ? await db
        .select()
        .from(orgSenders)
        .where(eq(orgSenders.enabled, true))
        .orderBy(asc(orgSenders.createdAt), asc(orgSenders.id))
    : await db
        .select()
        .from(orgSenders)
        .orderBy(asc(orgSenders.createdAt), asc(orgSenders.id));

  return rows.map((row) => mapOrgSenderRow(toOrgSenderRow(row)));
}

export async function getOrgSenderById(
  db: OrgSendersDatabase,
  id: string,
): Promise<OrgSenderRecord | null> {
  const [row] = await db
    .select()
    .from(orgSenders)
    .where(eq(orgSenders.id, id))
    .limit(1);

  return row === undefined ? null : mapOrgSenderRow(toOrgSenderRow(row));
}

export async function getOrgSenderByEmail(
  db: OrgSendersDatabase,
  email: string,
): Promise<OrgSenderRecord | null> {
  const [row] = await db
    .select()
    .from(orgSenders)
    .where(eq(orgSenders.email, email))
    .limit(1);

  return row === undefined ? null : mapOrgSenderRow(toOrgSenderRow(row));
}

export async function updateOrgSender(
  db: OrgSendersDatabase,
  id: string,
  input: UpdateOrgSenderInput,
): Promise<OrgSenderRecord | null> {
  const parsed = updateOrgSenderInputSchema.parse(input);

  if (parsed.label === undefined && parsed.enabled === undefined) {
    return getOrgSenderById(db, id);
  }

  const [row] = await db
    .update(orgSenders)
    .set({
      label: parsed.label,
      enabled: parsed.enabled,
      updatedAt: new Date(),
    })
    .where(eq(orgSenders.id, id))
    .returning();

  return row === undefined ? null : mapOrgSenderRow(toOrgSenderRow(row));
}

export async function setOrgSenderEnabled(
  db: OrgSendersDatabase,
  id: string,
  enabled: boolean,
): Promise<void> {
  await updateOrgSender(db, id, { enabled });
}
