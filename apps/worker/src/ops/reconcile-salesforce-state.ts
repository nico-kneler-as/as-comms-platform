import { randomUUID } from "node:crypto";

import type { Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
import type {
  SalesforceApiClient,
  SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";
import {
  diffSalesforceState,
  type SalesforceRowSnapshot,
} from "@as-comms/integrations";

export type ReconcileSalesforceStateMode = "dry_run" | "enforce";

export interface ReconcileSalesforceStateInput {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly apiClient: SalesforceApiClient;
  readonly mode: ReconcileSalesforceStateMode;
  readonly salesforceConfig: SalesforceCaptureServiceConfig;
  readonly now?: () => Date;
  readonly logger?: Pick<Console, "log" | "warn">;
  /** SOQL IN-clause batch size. Default 500. */
  readonly batchSize?: number;
}

export interface ReconcileSalesforceStateEntityReport {
  readonly entityType: "contact" | "membership" | "project";
  readonly mode: ReconcileSalesforceStateMode;
  readonly scanned: number;
  readonly confirmedPresent: number;
  readonly markedDeleted: number;
  readonly missingLocallyCount: number;
  readonly errors: readonly {
    readonly message: string;
    readonly batchIndex: number;
  }[];
  readonly abortedReason: string | null;
}

export interface ReconcileSalesforceStateReport {
  readonly runs: readonly ReconcileSalesforceStateEntityReport[];
}

interface ReconciliationEntityConfig {
  readonly entityType: ReconcileSalesforceStateEntityReport["entityType"];
  readonly objectName: string;
  readonly repository:
    | Stage1RepositoryBundle["contacts"]
    | Stage1RepositoryBundle["contactMemberships"]
    | Stage1RepositoryBundle["projectDimensions"];
}

function chunkValues<T>(
  values: readonly T[],
  chunkSize: number,
): readonly (readonly T[])[] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function quoteSoqlId(id: string): string {
  return `'${id}'`;
}

function buildIdBatchQuery(objectName: string, ids: readonly string[]): string {
  return `SELECT Id, IsDeleted FROM ${objectName} WHERE Id IN (${ids
    .map(quoteSoqlId)
    .join(",")})`;
}

function toSalesforceSnapshots(
  rows: readonly Record<string, unknown>[],
): SalesforceRowSnapshot[] {
  const snapshots: SalesforceRowSnapshot[] = [];

  for (const row of rows) {
    const id = row.Id;

    if (typeof id !== "string" || id.trim().length === 0) {
      continue;
    }

    snapshots.push({
      id,
      isDeleted: row.IsDeleted === true,
    });
  }

  return snapshots;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function reconcileEntity(
  input: ReconcileSalesforceStateInput,
  entity: ReconciliationEntityConfig,
): Promise<ReconcileSalesforceStateEntityReport> {
  const now = input.now ?? (() => new Date());
  const logger = input.logger ?? console;
  const batchSize = Math.max(1, Math.floor(input.batchSize ?? 500));
  const runId = randomUUID();
  const startedAt = now().toISOString();
  const databaseIds = await entity.repository.listSalesforceAnchoredIds();
  const errors: {
    readonly message: string;
    readonly batchIndex: number;
  }[] = [];
  const salesforceRows: SalesforceRowSnapshot[] = [];

  for (const [batchIndex, batchIds] of chunkValues(databaseIds, batchSize).entries()) {
    try {
      const rows = await input.apiClient.queryAllIncludingDeleted(
        buildIdBatchQuery(entity.objectName, batchIds),
      );
      salesforceRows.push(...toSalesforceSnapshots(rows as Record<string, unknown>[]));
    } catch (error) {
      const message = toErrorMessage(error);
      const entry = {
        message,
        batchIndex,
      } as const;

      errors.push(entry);
      logger.warn(
        JSON.stringify({
          event: "salesforce.reconciliation.batch_failed",
          runId,
          entityType: entity.entityType,
          mode: input.mode,
          batchIndex,
          message,
        }),
      );
    }
  }

  const diff = diffSalesforceState({
    salesforceRows,
    databaseIds,
  });
  const report: ReconcileSalesforceStateEntityReport = {
    entityType: entity.entityType,
    mode: input.mode,
    scanned: databaseIds.length,
    confirmedPresent: diff.presentInBoth.length,
    markedDeleted: diff.deletedInSalesforce.length,
    missingLocallyCount: diff.missingLocally.length,
    errors,
    abortedReason: null,
  };

  if (input.mode === "enforce") {
    await entity.repository.markSalesforceDeleted({
      salesforceIds: diff.deletedInSalesforce,
      deletedAt: startedAt,
    });
    await entity.repository.markSalesforceReconciled({
      salesforceIds: diff.presentInBoth,
      reconciledAt: startedAt,
    });
  }

  const completedAt = now().toISOString();
  await input.repositories.salesforceReconciliationRuns.insert({
    id: runId,
    startedAt,
    completedAt,
    mode: input.mode,
    entityType: entity.entityType,
    scanned: report.scanned,
    confirmedPresent: report.confirmedPresent,
    markedDeleted: report.markedDeleted,
    missingLocallyCount: report.missingLocallyCount,
    errors: report.errors,
    abortedReason: null,
    createdAt: startedAt,
    updatedAt: now().toISOString(),
  });

  logger.log(
    JSON.stringify({
      event: "salesforce.reconciliation.completed",
      runId,
      entityType: entity.entityType,
      mode: input.mode,
      scanned: report.scanned,
      confirmedPresent: report.confirmedPresent,
      markedDeleted: report.markedDeleted,
      missingLocallyCount: report.missingLocallyCount,
      errors: report.errors.length,
    }),
  );

  return report;
}

export async function reconcileSalesforceState(
  input: ReconcileSalesforceStateInput,
): Promise<ReconcileSalesforceStateReport> {
  const entities: readonly ReconciliationEntityConfig[] = [
    {
      entityType: "contact",
      objectName: "Contact",
      repository: input.repositories.contacts,
    },
    {
      entityType: "membership",
      objectName:
        input.salesforceConfig.membershipObjectName ??
        "Expedition_Members__c",
      repository: input.repositories.contactMemberships,
    },
    {
      entityType: "project",
      objectName: "Campaign",
      repository: input.repositories.projectDimensions,
    },
  ];

  return {
    runs: await Promise.all(
      entities.map((entity) => reconcileEntity(input, entity)),
    ),
  };
}
