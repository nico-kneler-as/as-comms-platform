import process from "node:process";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";

import {
  closeDatabaseConnection,
  createStage1RepositoryBundle,
  consentRecords,
  contactIdentities,
  contactInboxProjection,
  contacts,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  canonicalEventLedger,
  smsMessages,
  type Stage1Database,
} from "@as-comms/db";
import {
  createStage1PersistenceService,
  rebuildInboxProjectionForContact,
} from "@as-comms/domain";
import { tryNormalizePhoneE164 } from "@as-comms/domain/phone";

type UnknownContactRow = {
  readonly id: string;
  readonly displayName: string;
  readonly primaryPhone: string;
};

type MergeUnknownPhoneContactsAction =
  | {
      readonly status: "merged";
      readonly unknownContactId: string;
      readonly unknownDisplayName: string;
      readonly normalizedPhoneE164: string;
      readonly matchedContactIds: readonly string[];
      readonly mergedIntoContactId: string;
      readonly smsMessagesReattached: number;
      readonly canonicalEventsReattached: number;
      readonly consentRecordsReattached: number;
    }
  | {
      readonly status: "skipped_no_match" | "skipped_multiple_matches";
      readonly unknownContactId: string;
      readonly unknownDisplayName: string;
      readonly normalizedPhoneE164: string | null;
      readonly matchedContactIds: readonly string[];
    };

export type MergeUnknownPhoneContactsResult = {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly merged: number;
  readonly skippedNoMatch: number;
  readonly skippedMultipleMatches: number;
  readonly actions: readonly MergeUnknownPhoneContactsAction[];
};

function hasDryRunFlag(args: readonly string[]): boolean {
  return args.includes("--dry-run");
}

async function listUnknownContacts(
  repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>,
): Promise<readonly UnknownContactRow[]> {
  const allContacts = await repositories.contacts.listAll();

  return allContacts
    .filter(
      (contact): contact is typeof contact & { readonly primaryPhone: string } =>
        contact.displayName.startsWith("Unknown (") &&
        contact.primaryPhone !== null,
    )
    .map((contact) => ({
      id: contact.id,
      displayName: contact.displayName,
      primaryPhone: contact.primaryPhone,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function findRealContactMatches(input: {
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
  readonly unknownContactId: string;
  readonly normalizedPhoneE164: string;
}): Promise<readonly string[]> {
  const directMatches = await input.repositories.contacts.findByPrimaryPhone(
    input.normalizedPhoneE164,
  );
  const identityMatches =
    await input.repositories.contactIdentities.listByNormalizedValue({
      kind: "phone",
      normalizedValue: input.normalizedPhoneE164,
    });

  const candidateIds = new Set<string>();

  if (directMatches !== null) {
    candidateIds.add(directMatches.id);
  }

  for (const identityMatch of identityMatches) {
    candidateIds.add(identityMatch.contactId);
  }

  candidateIds.delete(input.unknownContactId);

  const candidates = await input.repositories.contacts.listByIds([...candidateIds]);

  return candidates
    .filter((contact) => !contact.displayName.startsWith("Unknown ("))
    .map((contact) => contact.id)
    .sort((left, right) => left.localeCompare(right));
}

type MergeUnknownPhoneContactsInput = {
  readonly dryRun: boolean;
  readonly connectionString?: string;
  readonly db?: Stage1Database;
  readonly repositories?: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
};

async function mergeUnknownPhoneContactsWithRepositories(input: {
  readonly dryRun: boolean;
  readonly db: Stage1Database;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
}): Promise<MergeUnknownPhoneContactsResult> {
  const repositories = input.repositories;
  const unknownContacts = await listUnknownContacts(repositories);
  const actions: MergeUnknownPhoneContactsAction[] = [];

  for (const unknownContact of unknownContacts) {
    const normalizedPhoneE164 = tryNormalizePhoneE164(unknownContact.primaryPhone);

    if (normalizedPhoneE164 === null) {
      actions.push({
        status: "skipped_no_match",
        unknownContactId: unknownContact.id,
        unknownDisplayName: unknownContact.displayName,
        normalizedPhoneE164: null,
        matchedContactIds: [],
      });
      continue;
    }

    const matchedContactIds = await findRealContactMatches({
      repositories,
      unknownContactId: unknownContact.id,
      normalizedPhoneE164,
    });

    if (matchedContactIds.length === 0) {
      actions.push({
        status: "skipped_no_match",
        unknownContactId: unknownContact.id,
        unknownDisplayName: unknownContact.displayName,
        normalizedPhoneE164,
        matchedContactIds,
      });
      continue;
    }

    if (matchedContactIds.length > 1) {
      actions.push({
        status: "skipped_multiple_matches",
        unknownContactId: unknownContact.id,
        unknownDisplayName: unknownContact.displayName,
        normalizedPhoneE164,
        matchedContactIds,
      });
      continue;
    }

    const [matchedContactId] = matchedContactIds;

    if (matchedContactId === undefined) {
      continue;
    }

    if (input.dryRun) {
      actions.push({
        status: "merged",
        unknownContactId: unknownContact.id,
        unknownDisplayName: unknownContact.displayName,
        normalizedPhoneE164,
        matchedContactIds,
        mergedIntoContactId: matchedContactId,
        smsMessagesReattached: 0,
        canonicalEventsReattached: 0,
        consentRecordsReattached: 0,
      });
      continue;
    }

    const mergeResult = await input.db.transaction(async (tx) => {
      const smsMessagesUpdated = await tx
        .update(smsMessages)
        .set({ contactId: matchedContactId, updatedAt: new Date() })
        .where(eq(smsMessages.contactId, unknownContact.id))
        .returning({ id: smsMessages.id });
      const canonicalEventsUpdated = await tx
        .update(canonicalEventLedger)
        .set({ contactId: matchedContactId, updatedAt: new Date() })
        .where(eq(canonicalEventLedger.contactId, unknownContact.id))
        .returning({ id: canonicalEventLedger.id });
      const consentRecordsUpdated = await tx
        .update(consentRecords)
        .set({ contactId: matchedContactId, updatedAt: new Date() })
        .where(eq(consentRecords.contactId, unknownContact.id))
        .returning({ id: consentRecords.id });

      await tx
        .delete(contactInboxProjection)
        .where(eq(contactInboxProjection.contactId, unknownContact.id));
      await tx
        .delete(contactIdentities)
        .where(eq(contactIdentities.contactId, unknownContact.id));
      await tx.delete(contacts).where(eq(contacts.id, unknownContact.id));

      const transactionalRepositories = createStage1RepositoryBundle(tx);
      await rebuildInboxProjectionForContact(
        createStage1PersistenceService(transactionalRepositories),
        matchedContactId,
      );

      return {
        smsMessagesReattached: smsMessagesUpdated.length,
        canonicalEventsReattached: canonicalEventsUpdated.length,
        consentRecordsReattached: consentRecordsUpdated.length,
      };
    });

    actions.push({
      status: "merged",
      unknownContactId: unknownContact.id,
      unknownDisplayName: unknownContact.displayName,
      normalizedPhoneE164,
      matchedContactIds,
      mergedIntoContactId: matchedContactId,
      smsMessagesReattached: mergeResult.smsMessagesReattached,
      canonicalEventsReattached: mergeResult.canonicalEventsReattached,
      consentRecordsReattached: mergeResult.consentRecordsReattached,
    });
  }

  return {
    dryRun: input.dryRun,
    scanned: unknownContacts.length,
    merged: actions.filter((action) => action.status === "merged").length,
    skippedNoMatch: actions.filter((action) => action.status === "skipped_no_match")
      .length,
    skippedMultipleMatches: actions.filter(
      (action) => action.status === "skipped_multiple_matches",
    ).length,
    actions,
  };
}

export async function mergeUnknownPhoneContacts(
  input: MergeUnknownPhoneContactsInput,
): Promise<MergeUnknownPhoneContactsResult> {
  if (input.db !== undefined && input.repositories !== undefined) {
    return mergeUnknownPhoneContactsWithRepositories({
      dryRun: input.dryRun,
      db: input.db,
      repositories: input.repositories,
    });
  }

  if (!input.connectionString) {
    throw new Error("connectionString is required when db/repositories are omitted.");
  }

  const connection = createDatabaseConnection({
    connectionString: input.connectionString,
  });

  try {
    return await mergeUnknownPhoneContactsWithRepositories({
      dryRun: input.dryRun,
      db: connection.db,
      repositories: createStage1RepositoryBundleFromConnection(connection),
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

export function renderMergeUnknownPhoneContactsMarkdown(
  result: MergeUnknownPhoneContactsResult,
): string {
  const actionLines =
    result.actions.length === 0
      ? ["- none"]
      : result.actions.map((action) => {
          if (action.status === "merged") {
            return `- ${action.unknownContactId} -> ${action.mergedIntoContactId} (${action.normalizedPhoneE164}) [sms=${action.smsMessagesReattached}, events=${action.canonicalEventsReattached}, consent=${action.consentRecordsReattached}]`;
          }

          const phone = action.normalizedPhoneE164 ?? "unparseable";
          const matches =
            action.matchedContactIds.length === 0
              ? "none"
              : action.matchedContactIds.join(", ");
          return `- ${action.unknownContactId} [${action.status}] (${phone}) matches: ${matches}`;
        });

  return [
    "# Unknown phone contact merge",
    "",
    `Mode: ${result.dryRun ? "dry-run" : "execute"}`,
    "",
    "| metric | value |",
    "| --- | --- |",
    `| scanned | ${result.scanned} |`,
    `| merged | ${result.merged} |`,
    `| skipped_no_match | ${result.skippedNoMatch} |`,
    `| skipped_multiple_matches | ${result.skippedMultipleMatches} |`,
    "",
    "## Actions",
    ...actionLines,
  ].join("\n");
}

async function main(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  const connectionString = env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const result = await mergeUnknownPhoneContacts({
    dryRun: hasDryRunFlag(args),
    connectionString,
  });
  console.log(renderMergeUnknownPhoneContactsMarkdown(result));
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
