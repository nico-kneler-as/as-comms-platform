import {
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type DatabaseConnection
} from "@as-comms/db";
import type { TestStage1Context } from "@as-comms/db/test-helpers";
import {
  createStage1TimelinePresentationService,
  type Stage1RepositoryBundle,
  type Stage1TimelinePresentationService
} from "@as-comms/domain";

export type { TestStage1Context } from "@as-comms/db/test-helpers";

export interface Stage1WebRuntime {
  readonly connection: Pick<DatabaseConnection, "db" | "sql"> | null;
  readonly repositories: Stage1RepositoryBundle;
  readonly timelinePresentation: Stage1TimelinePresentationService;
}

export interface Stage1WebTestRuntime {
  readonly context: TestStage1Context;
  dispose(): Promise<void>;
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

  return {
    connection,
    repositories,
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

export function setStage1WebRuntimeForTests(
  runtime: Stage1WebRuntime | null
): void {
  runtimeOverride = runtime;
  runtimePromise = null;
}

export async function createStage1WebTestRuntime(): Promise<Stage1WebTestRuntime> {
  const { createTestStage1Context } = await import("@as-comms/db/test-helpers");
  const context = await createTestStage1Context();

  setStage1WebRuntimeForTests({
    connection: null,
    repositories: context.repositories,
    timelinePresentation: createStage1TimelinePresentationService(
      context.repositories
    )
  });

  return {
    context,
    async dispose() {
      setStage1WebRuntimeForTests(null);
      await context.client.close();
    }
  };
}
