import {
  and,
  asc,
  count,
  eq,
  gte,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  NewsletterSubscriberRecord,
  NewsletterSuppressionRecord,
  UpsertNewsletterSubscriberInput,
  UpsertNewsletterSuppressionInput,
} from "@as-comms/contracts";

import {
  mapNewsletterSubscriberInsert,
  mapNewsletterSubscriberRow,
  mapNewsletterSuppressionInsert,
  mapNewsletterSuppressionRow,
  type NewsletterSubscriberRow,
  type NewsletterSuppressionRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import {
  newsletterSubscribers,
  newsletterSuppressions,
} from "./schema/index.js";

type NewsletterSubscribersDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

export interface ListNewsletterSubscribersInput {
  readonly limit: number;
  readonly minMemberRating?: number;
  readonly changedSince?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toNewsletterSubscriberRow(
  row: typeof newsletterSubscribers.$inferSelect,
): NewsletterSubscriberRow {
  return {
    id: row.id,
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
    status: row.status,
    member_rating: row.memberRating,
    optin_time: row.optinTime,
    optin_ip: row.optinIp,
    confirm_time: row.confirmTime,
    confirm_ip: row.confirmIp,
    last_changed_at: row.lastChangedAt,
    interests: row.interests,
    tags: row.tags,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toNewsletterSuppressionRow(
  row: typeof newsletterSuppressions.$inferSelect,
): NewsletterSuppressionRow {
  return {
    id: row.id,
    email: row.email,
    reason: row.reason,
    source: row.source,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function upsertNewsletterSubscriber(
  db: NewsletterSubscribersDatabase,
  input: UpsertNewsletterSubscriberInput,
): Promise<NewsletterSubscriberRecord> {
  const values = mapNewsletterSubscriberInsert({
    ...input,
    email: normalizeEmail(input.email),
  });
  const [row] = await db
    .insert(newsletterSubscribers)
    .values(values)
    .onConflictDoUpdate({
      target: newsletterSubscribers.email,
      set: {
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
        status: values.status,
        memberRating: values.memberRating,
        optinTime: values.optinTime,
        optinIp: values.optinIp,
        confirmTime: values.confirmTime,
        confirmIp: values.confirmIp,
        lastChangedAt: values.lastChangedAt,
        interests: values.interests,
        tags: values.tags,
        source: values.source,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (row === undefined) {
    throw new Error("Failed to upsert newsletter subscriber.");
  }

  return mapNewsletterSubscriberRow(toNewsletterSubscriberRow(row));
}

export async function getNewsletterSubscriberByEmail(
  db: NewsletterSubscribersDatabase,
  email: string,
): Promise<NewsletterSubscriberRecord | null> {
  const [row] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, normalizeEmail(email)))
    .limit(1);

  return row === undefined
    ? null
    : mapNewsletterSubscriberRow(toNewsletterSubscriberRow(row));
}

export async function listNewsletterSubscribers(
  db: NewsletterSubscribersDatabase,
  input: ListNewsletterSubscribersInput,
): Promise<readonly NewsletterSubscriberRecord[]> {
  const filters = [
    input.minMemberRating === undefined
      ? undefined
      : gte(newsletterSubscribers.memberRating, input.minMemberRating),
    input.changedSince === undefined
      ? undefined
      : gte(newsletterSubscribers.lastChangedAt, new Date(input.changedSince)),
  ].filter(
    (
      filter,
    ): filter is Exclude<typeof filter, undefined> => filter !== undefined,
  );
  const rows = await db
    .select()
    .from(newsletterSubscribers)
    .where(filters.length === 0 ? undefined : and(...filters))
    .orderBy(
      sql`${newsletterSubscribers.memberRating} desc nulls last`,
      sql`${newsletterSubscribers.lastChangedAt} desc nulls last`,
      asc(newsletterSubscribers.email),
    )
    .limit(input.limit);

  return rows.map((row) =>
    mapNewsletterSubscriberRow(toNewsletterSubscriberRow(row)),
  );
}

export async function countSendableNewsletterSubscribers(
  db: NewsletterSubscribersDatabase,
): Promise<number> {
  const result = await db
    .select({ value: count() })
    .from(newsletterSubscribers)
    .leftJoin(
      newsletterSuppressions,
      eq(newsletterSubscribers.email, newsletterSuppressions.email),
    )
    .where(
      and(
        eq(newsletterSubscribers.status, "subscribed"),
        isNull(newsletterSuppressions.id),
      ),
    );

  return result[0]?.value ?? 0;
}

export async function listSendableNewsletterSubscribers(
  db: NewsletterSubscribersDatabase,
): Promise<
  readonly {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
  }[]
> {
  const rows = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      firstName: newsletterSubscribers.firstName,
    })
    .from(newsletterSubscribers)
    .leftJoin(
      newsletterSuppressions,
      eq(newsletterSubscribers.email, newsletterSuppressions.email),
    )
    .where(
      and(
        eq(newsletterSubscribers.status, "subscribed"),
        isNull(newsletterSuppressions.id),
      ),
    )
    .orderBy(asc(newsletterSubscribers.email), asc(newsletterSubscribers.id));

  return rows;
}

export async function searchNewsletterSubscribers(
  db: NewsletterSubscribersDatabase,
  query: string,
  limit: number,
): Promise<
  readonly {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
  }[]
> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0 || limit <= 0) {
    return [];
  }

  const pattern = `%${trimmedQuery}%`;
  const rows = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      firstName: newsletterSubscribers.firstName,
    })
    .from(newsletterSubscribers)
    .leftJoin(
      newsletterSuppressions,
      eq(newsletterSubscribers.email, newsletterSuppressions.email),
    )
    .where(
      and(
        eq(newsletterSubscribers.status, "subscribed"),
        isNull(newsletterSuppressions.id),
        or(
          ilike(newsletterSubscribers.email, pattern),
          ilike(newsletterSubscribers.firstName, pattern),
          ilike(newsletterSubscribers.lastName, pattern),
        ),
      ),
    )
    .orderBy(asc(newsletterSubscribers.email), asc(newsletterSubscribers.id))
    .limit(limit);

  return rows;
}

export async function upsertNewsletterSuppression(
  db: NewsletterSubscribersDatabase,
  input: UpsertNewsletterSuppressionInput,
): Promise<NewsletterSuppressionRecord> {
  const values = mapNewsletterSuppressionInsert({
    ...input,
    email: normalizeEmail(input.email),
  });
  const [row] = await db
    .insert(newsletterSuppressions)
    .values(values)
    .onConflictDoUpdate({
      target: newsletterSuppressions.email,
      set: {
        email: values.email,
        reason: values.reason,
        source: values.source,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (row === undefined) {
    throw new Error("Failed to upsert newsletter suppression.");
  }

  return mapNewsletterSuppressionRow(toNewsletterSuppressionRow(row));
}

export async function getNewsletterSuppressionByEmail(
  db: NewsletterSubscribersDatabase,
  email: string,
): Promise<NewsletterSuppressionRecord | null> {
  const [row] = await db
    .select()
    .from(newsletterSuppressions)
    .where(eq(newsletterSuppressions.email, normalizeEmail(email)))
    .limit(1);

  return row === undefined
    ? null
    : mapNewsletterSuppressionRow(toNewsletterSuppressionRow(row));
}
