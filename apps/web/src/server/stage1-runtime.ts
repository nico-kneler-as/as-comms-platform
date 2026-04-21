import {
  accounts,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  createStage2RepositoryBundleFromConnection,
  sessions,
  users,
  verificationTokens,
  type DatabaseConnection
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  createStage1TimelinePresentationService,
  type Stage1NormalizationService,
  type Stage1RepositoryBundle,
  type Stage1TimelinePresentationService,
  type Stage2RepositoryBundle
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
  verificationTokensTable: verificationTokens
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
  readonly settings: Stage2RepositoryBundle;
  readonly normalization: Stage1NormalizationService;
  readonly timelinePresentation: Stage1TimelinePresentationService;
}

let runtimeOverride: Stage1WebRuntime | null = null;
let runtimePromise: Promise<Stage1WebRuntime> | null = null;

function createRuntime(): Stage1WebRuntime {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before using the Stage 1 inbox runtime.");
  }

  const connection = createDatabaseConnection({
    connectionString
  });
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const settings = createStage2RepositoryBundleFromConnection(connection);
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);

  return {
    connection,
    repositories,
    settings,
    normalization,
    timelinePresentation: createStage1TimelinePresentationService(repositories)
  };
}

export async function getStage1WebRuntime(): Promise<Stage1WebRuntime> {
  if (runtimeOverride !== null) {
    return runtimeOverride;
  }

  runtimePromise ??= Promise.resolve(createRuntime());
  return runtimePromise;
}

export async function getSettingsRepositories(): Promise<Stage2RepositoryBundle> {
  const runtime = await getStage1WebRuntime();
  return runtime.settings;
}

export function setStage1WebRuntimeForTests(
  runtime: Stage1WebRuntime | null
): void {
  runtimeOverride = runtime;
  runtimePromise = null;
}
