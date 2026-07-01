import {
  accounts,
  countMediaAssets,
  createOrgSender,
  createMediaAsset,
  createDatabaseConnection,
  listSendableNewsletterSubscribers as listSendableNewsletterSubscribersFromDb,
  getOrgSenderByEmail,
  listMediaAssets,
  listOrgSenders,
  createStage1RepositoryBundle,
  createStage1RepositoryBundleFromConnection,
  createStage2RepositoryBundle,
  createStage5RepositoryBundle,
  createStage5RepositoryBundleFromConnection,
  createStage2RepositoryBundleFromConnection,
  setOrgSenderEnabled,
  sessions,
  softDeleteMediaAsset,
  users,
  verificationTokens,
  type DatabaseConnection,
  type Stage5RepositoryBundle,
} from "@as-comms/db";
import type { CreateOrgSenderInput } from "@as-comms/contracts";
import {
  createStage1InternalNoteService,
  createStage1NormalizationService,
  createStage1PersistenceService,
  createStage1TimelinePresentationService,
  type Stage1InternalNoteService,
  type Stage1NormalizationService,
  type Stage1RepositoryBundle,
  type Stage1TimelinePresentationService,
  type Stage2RepositoryBundle,
} from "@as-comms/domain";

// Re-export the Auth.js adapter tables so `apps/web/src/server/auth/index.ts`
// can hand them to `DrizzleAdapter` without crossing the composition-root
// boundary. Without this explicit schema map, the adapter falls back to its
// internal defaults (singular `"user"` / `"account"` / `"session"` / `"verificationToken"`
// table names) which do not exist in our DB and cause 42P01 "relation does not
// exist" errors at callback time.
export const authAdapterTables = {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
} as const;

/**
 * Production Stage 1 composition root for `apps/web`.
 *
 * Boundary rule: this file is the ONLY place in `apps/web` allowed to import
 * from `@as-comms/db` (enforced by `scripts/boundary-check.mjs`). It must NOT
 * import `@as-comms/db/test-helpers`, which pulls in PGlite and its dynamic
 * code evaluation — banned under Next.js Edge Runtime used by `middleware.ts`.
 *
 * Test-only wiring (`createStage1WebTestRuntime`, `TestStage1Context`) lives
 * in `./stage1-runtime.test-support.ts` and is imported only from test code.
 */

export interface Stage2RepositoryAccess {
  readonly settings: Stage2RepositoryBundle;
}

export interface Stage1WebRuntime {
  readonly connection: Pick<DatabaseConnection, "db" | "sql"> | null;
  readonly repositories: Stage1RepositoryBundle;
  readonly campaigns: Stage5RepositoryBundle;
  readonly settings: Stage2RepositoryBundle;
  readonly normalization: Stage1NormalizationService;
  readonly timelinePresentation: Stage1TimelinePresentationService;
  readonly internalNotes: Stage1InternalNoteService;
}

export interface Stage1WebTransaction {
  readonly db: NonNullable<Stage1WebRuntime["connection"]>["db"];
  readonly repositories: Stage1RepositoryBundle;
  readonly campaigns: Stage5RepositoryBundle;
  readonly settings: Stage2RepositoryBundle;
}

let runtimeOverride: Stage1WebRuntime | null = null;

const STAGE1_RUNTIME_PROMISE_KEY = "__asCommsWebStage1RuntimePromise";

type Stage1RuntimeGlobal = typeof globalThis & {
  [STAGE1_RUNTIME_PROMISE_KEY]?: Promise<Stage1WebRuntime> | undefined;
};

function getRuntimeGlobal(): Stage1RuntimeGlobal {
  return globalThis as Stage1RuntimeGlobal;
}

function createRuntime(): Stage1WebRuntime {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set before using the Stage 1 inbox runtime.",
    );
  }

  const connection = createDatabaseConnection({
    connectionString,
  });
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const campaigns = createStage5RepositoryBundleFromConnection(connection);
  const settings = createStage2RepositoryBundleFromConnection(connection);
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const internalNotes = createStage1InternalNoteService({
    persistence,
    normalization,
  });

  return {
    connection,
    repositories,
    campaigns,
    settings,
    normalization,
    timelinePresentation: createStage1TimelinePresentationService(repositories),
    internalNotes,
  };
}

export async function getStage1WebRuntime(): Promise<Stage1WebRuntime> {
  if (runtimeOverride !== null) {
    return runtimeOverride;
  }

  const runtimeGlobal = getRuntimeGlobal();
  runtimeGlobal[STAGE1_RUNTIME_PROMISE_KEY] ??=
    Promise.resolve(createRuntime());
  return runtimeGlobal[STAGE1_RUNTIME_PROMISE_KEY];
}

export async function withStage1WebTransaction<T>(
  callback: (transaction: Stage1WebTransaction) => Promise<T>,
): Promise<T> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return runtime.connection.db.transaction(async (tx) =>
    callback({
      db: tx,
      repositories: createStage1RepositoryBundle(tx),
      campaigns: createStage5RepositoryBundle(tx),
      settings: createStage2RepositoryBundle(tx),
    }),
  );
}

export async function getSettingsRepositories(): Promise<Stage2RepositoryBundle> {
  const runtime = await getStage1WebRuntime();
  return runtime.settings;
}

export async function createBroadcastMediaAssetRecord(
  input: Parameters<typeof createMediaAsset>[1],
) {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return createMediaAsset(runtime.connection.db, input);
}

export async function listBroadcastMediaAssets(
  input: Parameters<typeof listMediaAssets>[1],
) {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return listMediaAssets(runtime.connection.db, input);
}

export async function countBroadcastMediaAssets() {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return countMediaAssets(runtime.connection.db);
}

export async function listEnabledOrgSenders() {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return listOrgSenders(runtime.connection.db, { enabledOnly: true });
}

export async function listAllOrgSenders() {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return listOrgSenders(runtime.connection.db, { enabledOnly: false });
}

export async function createOrgSenderRecord(input: CreateOrgSenderInput) {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return createOrgSender(runtime.connection.db, input);
}

export async function setOrgSenderEnabledState(id: string, enabled: boolean) {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return setOrgSenderEnabled(runtime.connection.db, id, enabled);
}

export async function getOrgSenderByEmailRecord(email: string) {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return getOrgSenderByEmail(runtime.connection.db, email);
}

export async function listSendableNewsletterSubscribers() {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return listSendableNewsletterSubscribersFromDb(runtime.connection.db);
}

export async function softDeleteBroadcastMediaAsset(id: string) {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 web runtime.");
  }

  return softDeleteMediaAsset(runtime.connection.db, id);
}

export function setStage1WebRuntimeForTests(
  runtime: Stage1WebRuntime | null,
): void {
  runtimeOverride = runtime;
  getRuntimeGlobal()[STAGE1_RUNTIME_PROMISE_KEY] = undefined;
}
