import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import {
  createStage1NormalizationService,
  createStage1PersistenceService
} from "@as-comms/domain";

import {
  createStage1RepositoryBundle,
  databaseSchema,
  type Stage1Database
} from "../src/index.js";

export interface TestStage1Context {
  readonly client: PGlite;
  readonly db: Stage1Database;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundle>;
  readonly persistence: ReturnType<typeof createStage1PersistenceService>;
  readonly normalization: ReturnType<typeof createStage1NormalizationService>;
}

export async function createTestStage1Context(): Promise<TestStage1Context> {
  const client = new PGlite();
  const drizzleDirectoryUrl = new URL("../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(drizzleDirectoryUrl))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const migrationFile of migrationFiles) {
    const migrationSql = await readFile(
      new URL(migrationFile, drizzleDirectoryUrl),
      "utf8"
    );

    await client.exec(migrationSql);
  }

  const db = drizzle(client, {
    schema: databaseSchema
  }) as Stage1Database;
  const repositories = createStage1RepositoryBundle(db);
  const persistence = createStage1PersistenceService(repositories);

  return {
    client,
    db,
    repositories,
    persistence,
    normalization: createStage1NormalizationService(persistence)
  };
}
