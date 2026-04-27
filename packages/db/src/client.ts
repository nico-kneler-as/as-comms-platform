import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import type { DatabaseSchema } from "./schema/index.js";
import { databaseSchema } from "./schema/index.js";

export const databaseConfigSchema = z.object({
  connectionString: z.string().min(1)
});
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

export type PostgresClient = ReturnType<typeof postgres>;
export type DatabaseClient = PostgresJsDatabase<DatabaseSchema>;
export interface DatabaseConnection {
  readonly db: DatabaseClient;
  readonly sql: PostgresClient;
}

export function createDatabaseConnection(rawConfig: DatabaseConfig): DatabaseConnection {
  const config = databaseConfigSchema.parse(rawConfig);
  // Pool sized to allow Promise.all-style parallel queries within a single
  // request. The inbox layout fires 3 in parallel (getInboxList,
  // getInboxComposerAliases, getInboxIntegrationHealthBanner) and each of
  // those internally does ~5-10 queries also via Promise.all. With max:1
  // every "parallel" query serialized on the one connection, blowing inbox
  // TTFB to ~5-6s. 20 fits comfortably under Railway's managed-Postgres
  // connection budget across the web + worker services. Override via
  // DB_POOL_MAX env var if Railway tier limits change.
  const poolSize = Number.parseInt(process.env.DB_POOL_MAX ?? "20", 10);
  const sql = postgres(config.connectionString, {
    max: Number.isFinite(poolSize) && poolSize > 0 ? poolSize : 20,
    prepare: false
  });

  return {
    db: drizzle(sql, { schema: databaseSchema }),
    sql
  };
}

export async function closeDatabaseConnection(connection: DatabaseConnection): Promise<void> {
  await connection.sql.end({ timeout: 5 });
}
