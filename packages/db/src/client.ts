import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import { stage0Schema } from "./schema/index.js";

export const databaseConfigSchema = z.object({
  connectionString: z.string().min(1)
});
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

export type PostgresClient = ReturnType<typeof postgres>;
export interface DatabaseConnection {
  readonly db: ReturnType<typeof drizzle>;
  readonly sql: PostgresClient;
}

export function createDatabaseConnection(rawConfig: DatabaseConfig): DatabaseConnection {
  const config = databaseConfigSchema.parse(rawConfig);
  const sql = postgres(config.connectionString, {
    max: 1,
    prepare: false
  });

  return {
    db: drizzle(sql, { schema: stage0Schema }),
    sql
  };
}

export async function closeDatabaseConnection(connection: DatabaseConnection): Promise<void> {
  await connection.sql.end({ timeout: 5 });
}
