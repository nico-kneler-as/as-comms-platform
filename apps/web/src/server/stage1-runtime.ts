import {
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type DatabaseConnection
} from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
import {
  createStage1TimelinePresentationService,
  type Stage1TimelinePresentationService
} from "../../../../packages/domain/src/timeline";

export interface Stage1WebRuntime {
  readonly connection: Pick<DatabaseConnection, "db" | "sql"> | null;
  readonly repositories: Stage1RepositoryBundle;
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
