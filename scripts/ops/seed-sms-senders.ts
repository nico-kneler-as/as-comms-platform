#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import process from "node:process";

import { smsSenders } from "@as-comms/db";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  type DatabaseConnection,
} from "@as-comms/db";

export type SeedSmsSenderConfig = {
  readonly phoneE164: string;
  readonly displayName: string;
  readonly monthlyCap: number | null;
};

export type SeedSmsSenderResult = {
  readonly dryRun: boolean;
  readonly status: "would_insert" | "inserted" | "already_exists";
  readonly row: {
    readonly id: string;
    readonly phoneE164: string;
    readonly displayName: string;
    readonly monthlyCap: number | null;
    readonly isActive: true;
  };
};

function hasDryRunFlag(args: readonly string[]): boolean {
  return args.includes("--dry-run");
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function parseSeedSmsSenderConfig(env: NodeJS.ProcessEnv): SeedSmsSenderConfig {
  const phoneE164 = normalizeOptionalString(env.SMS_SENDER_PHONE_E164);
  if (phoneE164 === null) {
    throw new Error("SMS_SENDER_PHONE_E164 is required.");
  }

  const displayName =
    normalizeOptionalString(env.SMS_SENDER_DISPLAY_NAME) ?? "Adventure Scientists";
  const monthlyCapValue = normalizeOptionalString(env.SMS_SENDER_MONTHLY_CAP);

  if (monthlyCapValue === null) {
    return {
      phoneE164,
      displayName,
      monthlyCap: null,
    };
  }

  if (!/^-?\d+$/.test(monthlyCapValue)) {
    throw new Error("SMS_SENDER_MONTHLY_CAP must be an integer when provided.");
  }

  return {
    phoneE164,
    displayName,
    monthlyCap: Number.parseInt(monthlyCapValue, 10),
  };
}

function truncateId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}...`;
}

export async function seedSmsSender(input: {
  readonly db: DatabaseConnection["db"];
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
  readonly dryRun: boolean;
  readonly config: SeedSmsSenderConfig;
}): Promise<SeedSmsSenderResult> {
  const existing = await input.repositories.smsSenders.findByPhone(input.config.phoneE164);
  if (existing !== null) {
    return {
      dryRun: input.dryRun,
      status: "already_exists",
      row: {
        id: existing.id,
        phoneE164: existing.phoneE164,
        displayName: existing.displayName,
        monthlyCap: existing.monthlyCap,
        isActive: true,
      },
    };
  }

  const id = randomUUID();
  const row = {
    id,
    phoneE164: input.config.phoneE164,
    displayName: input.config.displayName,
    monthlyCap: input.config.monthlyCap,
    isActive: true as const,
  };

  if (!input.dryRun) {
    const now = new Date();
    await input.db.insert(smsSenders).values({
      ...row,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    dryRun: input.dryRun,
    status: input.dryRun ? "would_insert" : "inserted",
    row,
  };
}

export function renderSeedSmsSenderMarkdown(result: SeedSmsSenderResult): string {
  return [
    "# SMS sender seed",
    "",
    `Mode: ${result.dryRun ? "dry-run" : "execute"}`,
    "",
    "| field | value |",
    "| --- | --- |",
    `| status | ${result.status} |`,
    `| id | ${truncateId(result.row.id)} |`,
    `| phone_e164 | ${result.row.phoneE164} |`,
    `| display_name | ${result.row.displayName} |`,
    `| monthly_cap | ${result.row.monthlyCap ?? "null"} |`,
    `| is_active | ${String(result.row.isActive)} |`,
  ].join("\n");
}

export async function runSeedSmsSendersCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<SeedSmsSenderResult> {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const config = parseSeedSmsSenderConfig(env);
  const connection = createDatabaseConnection({ connectionString });
  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const result = await seedSmsSender({
      db: connection.db,
      repositories,
      dryRun: hasDryRunFlag(args),
      config,
    });
    console.log(renderSeedSmsSenderMarkdown(result));
    return result;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

if (import.meta.main) {
  runSeedSmsSendersCommand(process.argv.slice(2), process.env).catch((error) => {
    console.error(error instanceof Error ? error.message : "SMS sender seed failed.");
    process.exitCode = 1;
  });
}
