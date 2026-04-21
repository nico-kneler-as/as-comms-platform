import {
  type IdentityResolutionCase,
  type Provider,
  type SourceEvidenceRecord
} from "@as-comms/contracts";
import {
  createStage1RepositoryBundle,
  type Stage1Database
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  type NormalizedCanonicalEventResult,
  type Stage1RepositoryBundle
} from "@as-comms/domain";

import type { Stage1ProviderCapturePorts } from "../orchestration/index.js";
import { buildEventFromStoredData } from "./_reconcile-from-stored-evidence.js";

const DEFAULT_BATCH_SIZE = 100;

interface GmailHistoricalReplayConfig {
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
}

interface ReconcileTarget {
  readonly caseRecord: IdentityResolutionCase;
  readonly sourceEvidence: SourceEvidenceRecord;
}

export interface ReconcileError {
  readonly caseId: string;
  readonly sourceEvidenceId: string;
  readonly provider?: Provider;
  readonly providerRecordType?: string;
  readonly providerRecordId?: string;
  readonly message: string;
}

export interface ReconcileReport {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly resolved: number;
  readonly created: number;
  readonly skipped: number;
  readonly errors: readonly ReconcileError[];
}

interface ReconcileIdentityQueueInput {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly capture: Stage1ProviderCapturePorts;
  readonly gmailHistoricalReplay: GmailHistoricalReplayConfig;
  readonly dryRun: boolean;
  readonly limit?: number;
  readonly logger?: Pick<Console, "log">;
}

type ReconcileExecutionResult =
  | {
      readonly kind: "processed";
      readonly normalizationResult: NormalizedCanonicalEventResult;
      readonly createdNewContact: boolean;
    }
  | {
      readonly kind: "skipped";
    };

class DryRunRollback extends Error {
  constructor() {
    super("dry-run-rollback");
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

async function loadOpenIdentityMissingAnchorTargets(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly limit?: number;
}): Promise<{
  readonly targets: readonly ReconcileTarget[];
  readonly errors: readonly ReconcileError[];
}> {
  const cases = await input.repositories.identityResolutionQueue.listOpenByReasonCode(
    "identity_missing_anchor"
  );
  const selectedCases =
    input.limit === undefined ? cases : cases.slice(0, input.limit);
  const sourceEvidenceById = new Map(
    (
      await input.repositories.sourceEvidence.listByIds(
        uniqueStrings(selectedCases.map((caseRecord) => caseRecord.sourceEvidenceId))
      )
    ).map((record) => [record.id, record] as const)
  );
  const targets: ReconcileTarget[] = [];
  const errors: ReconcileError[] = [];

  for (const caseRecord of selectedCases) {
    const sourceEvidence = sourceEvidenceById.get(caseRecord.sourceEvidenceId);

    if (sourceEvidence === undefined) {
      errors.push({
        caseId: caseRecord.id,
        sourceEvidenceId: caseRecord.sourceEvidenceId,
        message: `Missing source evidence ${caseRecord.sourceEvidenceId} for open identity review case.`
      });
      continue;
    }

    targets.push({
      caseRecord,
      sourceEvidence
    });
  }

  return {
    targets,
    errors
  };
}

function shouldCloseOriginalCase(result: NormalizedCanonicalEventResult): boolean {
  if (result.outcome === "applied" || result.outcome === "duplicate") {
    return true;
  }

  if (result.outcome !== "needs_identity_review") {
    return false;
  }

  return result.identityCase.reasonCode !== "identity_missing_anchor";
}

async function markIdentityCaseResolved(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseRecord: IdentityResolutionCase;
  readonly resolvedAt: string;
}): Promise<void> {
  await input.repositories.identityResolutionQueue.upsert({
    ...input.caseRecord,
    status: "resolved",
    resolvedAt: input.resolvedAt,
    explanation: `${input.caseRecord.explanation} Reconciled from stored evidence.`
  });
}

function classifyExecution(input: {
  readonly report: ReconcileReport;
  readonly execution: ReconcileExecutionResult;
}): ReconcileReport {
  const { report, execution } = input;

  if (execution.kind === "skipped") {
    return {
      ...report,
      skipped: report.skipped + 1
    };
  }

  if (
    execution.normalizationResult.outcome === "applied" ||
    execution.normalizationResult.outcome === "duplicate"
  ) {
    return {
      ...report,
      resolved: report.resolved + (execution.createdNewContact ? 0 : 1),
      created: report.created + (execution.createdNewContact ? 1 : 0)
    };
  }

  return {
    ...report,
    skipped: report.skipped + 1
  };
}

async function executeTarget(input: {
  readonly db: Stage1Database;
  readonly target: ReconcileTarget;
  readonly dryRun: boolean;
}): Promise<ReconcileExecutionResult> {
  const processedAt = new Date().toISOString();
  let execution: ReconcileExecutionResult | null = null;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    const persistence = createStage1PersistenceService(repositories);
    const normalization = createStage1NormalizationService(persistence);
    const currentCase = await repositories.identityResolutionQueue.findById(
      input.target.caseRecord.id
    );

    if (
      currentCase?.status !== "open" ||
      currentCase.reasonCode !== "identity_missing_anchor"
    ) {
      execution = {
        kind: "skipped"
      };

      if (input.dryRun) {
        throw new DryRunRollback();
      }

      return;
    }

    const normalizedIntake = await buildEventFromStoredData({
      repositories,
      sourceEvidence: input.target.sourceEvidence,
      caseRecord: currentCase
    });
    const beforeContactCount = (await repositories.contacts.listAll()).length;
    const normalizationResult =
      await normalization.applyNormalizedCanonicalEvent(normalizedIntake);
    const afterContactCount = (await repositories.contacts.listAll()).length;

    if (shouldCloseOriginalCase(normalizationResult)) {
      await markIdentityCaseResolved({
        repositories,
        caseRecord: currentCase,
        resolvedAt: processedAt
      });
    }

    execution = {
      kind: "processed",
      normalizationResult,
      createdNewContact: afterContactCount > beforeContactCount
    };

    if (input.dryRun) {
      throw new DryRunRollback();
    }
  };

  if (input.dryRun) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }
  } else {
    await input.db.transaction(runInTransaction);
  }

  // TS can't narrow through the closure assignment in runInTransaction, so this
  // check looks unnecessary to the linter even though it's a real runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (execution === null) {
    throw new Error(
      `Expected reconcile execution result for source evidence ${input.target.sourceEvidence.id}.`
    );
  }

  return execution;
}

export async function reconcileIdentityQueue(
  input: ReconcileIdentityQueueInput
): Promise<ReconcileReport> {
  const logger = input.logger ?? console;
  const initialTargets = await loadOpenIdentityMissingAnchorTargets({
    repositories: input.repositories,
    ...(input.limit === undefined ? {} : { limit: input.limit })
  });
  let report: ReconcileReport = {
    dryRun: input.dryRun,
    scanned: initialTargets.targets.length,
    resolved: 0,
    created: 0,
    skipped: 0,
    errors: initialTargets.errors
  };
  const batches = chunkValues(initialTargets.targets, DEFAULT_BATCH_SIZE);

  for (const [batchIndex, batch] of batches.entries()) {
    for (const target of batch) {
      try {
        const execution = await executeTarget({
          db: input.db,
          target,
          dryRun: input.dryRun
        });

        report = classifyExecution({
          report,
          execution
        });
      } catch (error) {
        report = {
          ...report,
          errors: [
            ...report.errors,
            {
              caseId: target.caseRecord.id,
              sourceEvidenceId: target.sourceEvidence.id,
              provider: target.sourceEvidence.provider,
              providerRecordType: target.sourceEvidence.providerRecordType,
              providerRecordId: target.sourceEvidence.providerRecordId,
              message: error instanceof Error ? error.message : String(error)
            }
          ]
        };
      }
    }

    logger.log(
      JSON.stringify({
        batchIndex: batchIndex + 1,
        batchSize: batch.length,
        scanned: report.scanned,
        resolved: report.resolved,
        created: report.created,
        skipped: report.skipped,
        errors: report.errors.length,
        dryRun: report.dryRun
      })
    );
  }

  return report;
}
