#!/usr/bin/env tsx
/**
 * pnpm ops:backfill-project-aliases
 *
 * Backfills `project_dimensions.project_alias` for one or more projects from
 * a JSON map provided via the `PROJECT_ALIAS_MAP` environment variable.
 *
 * Background: migration 0045 enforces a CHECK constraint requiring active
 * projects to have a non-empty alias, and includes a mechanical backfill
 * that derives a default from `project_name`. This script lets the
 * architect override that mechanical default with operator-chosen aliases
 * (e.g. "PNW Biodiversity") after the migration lands.
 *
 * Idempotent: skips rows whose current alias already matches the target.
 *
 * Usage:
 *   PROJECT_ALIAS_MAP='{"<projectId1>":"<alias1>","<projectId2>":"<alias2>"}' \
 *     DATABASE_URL=postgres://... \
 *     pnpm ops:backfill-project-aliases
 *
 * Requires: DATABASE_URL, PROJECT_ALIAS_MAP env vars.
 */
import {
  createDatabaseConnection,
  createStage2RepositoryBundleFromConnection
} from "@as-comms/db";

interface AliasOverride {
  readonly projectId: string;
  readonly alias: string;
}

function parseAliasMap(raw: string): readonly AliasOverride[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `PROJECT_ALIAS_MAP is not valid JSON: ${(error as Error).message}`
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "PROJECT_ALIAS_MAP must be a JSON object mapping projectId → alias."
    );
  }

  const overrides: AliasOverride[] = [];
  for (const [projectId, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(
        `PROJECT_ALIAS_MAP value for ${projectId} must be a string.`
      );
    }
    const trimmedId = projectId.trim();
    const trimmedAlias = value.trim();
    if (trimmedId.length === 0) {
      throw new Error("PROJECT_ALIAS_MAP keys must be non-empty.");
    }
    if (trimmedAlias.length === 0) {
      throw new Error(
        `PROJECT_ALIAS_MAP alias for ${projectId} must be non-empty.`
      );
    }
    overrides.push({ projectId: trimmedId, alias: trimmedAlias });
  }
  return overrides;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const aliasMapEnv = process.env.PROJECT_ALIAS_MAP;
  if (!aliasMapEnv?.trim()) {
    console.error(
      'PROJECT_ALIAS_MAP is required (JSON map of {"projectId":"alias",...})'
    );
    process.exitCode = 1;
    return;
  }

  let overrides: readonly AliasOverride[];
  try {
    overrides = parseAliasMap(aliasMapEnv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  if (overrides.length === 0) {
    console.error("PROJECT_ALIAS_MAP must contain at least one entry.");
    process.exitCode = 1;
    return;
  }

  const connection = createDatabaseConnection({ connectionString });
  try {
    const { projects } = createStage2RepositoryBundleFromConnection(connection);

    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const { projectId, alias } of overrides) {
      const project = await projects.findById(projectId);
      if (project === null) {
        console.log(`Not found: ${projectId}`);
        notFound++;
        continue;
      }

      if ((project.projectAlias ?? "").trim() === alias) {
        console.log(`Skipping (already matches): ${projectId} = "${alias}"`);
        skipped++;
        continue;
      }

      await projects.setProjectAlias(projectId, alias);
      console.log(
        `Updated: ${projectId} "${project.projectAlias ?? "(null)"}" → "${alias}"`
      );
      updated++;
    }

    console.log(
      `Done. Updated: ${updated.toString()}, Skipped: ${skipped.toString()}, Not found: ${notFound.toString()}`
    );
  } finally {
    const sql = (connection as { sql?: { end?: () => Promise<void> } }).sql;
    if (sql && typeof sql.end === "function") {
      await sql.end();
    }
  }
}

await main();
