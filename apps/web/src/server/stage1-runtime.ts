import {
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  contactInboxProjection,
  mapInboxProjectionRow,
  type DatabaseConnection
} from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
import { asc, desc, eq, sql } from "drizzle-orm";
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
  const baseRepositories = createStage1RepositoryBundleFromConnection(connection);
  const repositories: Stage1RepositoryBundle = {
    ...baseRepositories,
    inboxProjection: {
      ...baseRepositories.inboxProjection,
      async listAllOrderedByRecency() {
        const rows = await connection.db
          .select()
          .from(contactInboxProjection)
          .orderBy(
            desc(
              sql`coalesce(${contactInboxProjection.lastInboundAt}, ${contactInboxProjection.lastActivityAt})`
            ),
            desc(contactInboxProjection.lastActivityAt),
            asc(contactInboxProjection.contactId)
          );

        return rows.map(mapInboxProjectionRow);
      },
      async setNeedsFollowUp(input) {
        const [row] = await connection.db
          .update(contactInboxProjection)
          .set({
            isStarred: input.needsFollowUp,
            updatedAt: new Date()
          })
          .where(eq(contactInboxProjection.contactId, input.contactId))
          .returning();

        return row === undefined ? null : mapInboxProjectionRow(row);
      }
    }
  };

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
