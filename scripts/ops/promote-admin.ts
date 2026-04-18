#!/usr/bin/env tsx
/**
 * promote-admin
 *
 * Usage: pnpm ops:promote-admin -- --email <email>
 *
 * Promotes an existing operator to `admin`. Requires `DATABASE_URL` to be
 * set in the environment (or loaded via a shell wrapper).
 *
 * This script is an ops tool, not part of `apps/web`. The repo boundary rule
 * that restricts direct `@as-comms/db` imports to the Stage 1 composition
 * root only applies to workspace packages under `apps/` and `packages/`.
 */
import { parseArgs } from "node:util";

import {
  createDatabaseConnection,
  createStage2RepositoryBundleFromConnection
} from "@as-comms/db";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" }
    }
  });

  const email = values.email;
  if (!email) {
    console.error("Usage: pnpm ops:promote-admin -- --email <email>");
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const connection = createDatabaseConnection({ connectionString });
  try {
    const { users } = createStage2RepositoryBundleFromConnection(connection);
    const user = await users.findByEmail(email);
    if (!user) {
      console.error(`User not found: ${email}`);
      process.exitCode = 1;
      return;
    }

    if (user.deactivatedAt) {
      console.error(
        `Refusing to promote a deactivated user (${email}); reactivate first.`
      );
      process.exitCode = 1;
      return;
    }

    await users.updateRole(user.id, "admin");
    console.log(`Promoted ${email} to admin.`);
  } finally {
    // postgres.js exposes an `end` on the underlying sql client when present.
    const sql = (connection as { sql?: { end?: () => Promise<void> } }).sql;
    if (sql && typeof sql.end === "function") {
      await sql.end();
    }
  }
}

await main();
