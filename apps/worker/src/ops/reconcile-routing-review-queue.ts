import type {
  ExpeditionDimensionRecord,
  NormalizedCanonicalEventIntake,
  ProjectDimensionRecord,
  RoutingReviewCase,
  SalesforceEventContextRecord,
  SourceEvidenceRecord,
} from "@as-comms/contracts";
import {
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

const DEFAULT_BATCH_SIZE = 100;

interface ReconcileTarget {
  readonly caseRecord: RoutingReviewCase;
  readonly sourceEvidence: SourceEvidenceRecord;
}

export interface ReconcileError {
  readonly caseId: string;
  readonly sourceEvidenceId: string;
  readonly provider?: SourceEvidenceRecord["provider"];
  readonly providerRecordType?: string;
  readonly providerRecordId?: string;
  readonly reason: "source_evidence_missing" | "target_execution_failed";
  readonly message: string;
}

export interface ReconcileReport {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly resolved: number;
  readonly skipped: number;
  readonly errors: readonly ReconcileError[];
}

interface ReconcileRoutingReviewQueueInput {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly dryRun: boolean;
  readonly limit?: number;
  readonly logger?: Pick<Console, "log">;
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run-rollback");
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number,
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

async function loadOpenRoutingReconcileTargets(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly limit?: number;
}): Promise<{
  readonly targets: readonly ReconcileTarget[];
  readonly errors: readonly ReconcileError[];
}> {
  const cases =
    await input.repositories.routingReviewQueue.listOpenByReasonCode(
      "routing_missing_membership",
    );
  const sourceEvidenceById = new Map(
    (
      await input.repositories.sourceEvidence.listByIds(
        uniqueStrings(cases.map((caseRecord) => caseRecord.sourceEvidenceId)),
      )
    ).map((record) => [record.id, record] as const),
  );
  const targets: ReconcileTarget[] = [];
  const errors: ReconcileError[] = [];
  const limit = input.limit ?? Number.POSITIVE_INFINITY;
  let selectedCount = 0;

  for (const caseRecord of cases) {
    if (selectedCount >= limit) {
      break;
    }

    const sourceEvidence = sourceEvidenceById.get(caseRecord.sourceEvidenceId);

    if (sourceEvidence === undefined) {
      errors.push({
        caseId: caseRecord.id,
        sourceEvidenceId: caseRecord.sourceEvidenceId,
        reason: "source_evidence_missing",
        message: `Missing source evidence ${caseRecord.sourceEvidenceId} for open routing review case.`,
      });
      selectedCount += 1;
      continue;
    }

    targets.push({
      caseRecord,
      sourceEvidence,
    });
    selectedCount += 1;
  }

  return {
    targets,
    errors,
  };
}

function buildRoutingContext(input: {
  readonly eventContext: SalesforceEventContextRecord | undefined;
  readonly project: ProjectDimensionRecord | undefined;
  readonly expedition: ExpeditionDimensionRecord | undefined;
}): NonNullable<NormalizedCanonicalEventIntake["routing"]> | undefined {
  if (input.eventContext === undefined) {
    return undefined;
  }

  return {
    required:
      input.eventContext.projectId !== null ||
      input.eventContext.expeditionId !== null,
    projectId: input.eventContext.projectId,
    expeditionId: input.eventContext.expeditionId,
    projectName: input.project?.projectName ?? null,
    expeditionName: input.expedition?.expeditionName ?? null,
  };
}

async function buildRoutingFromStoredData(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly sourceEvidence: SourceEvidenceRecord;
}): Promise<
  NonNullable<NormalizedCanonicalEventIntake["routing"]> | undefined
> {
  if (input.sourceEvidence.provider !== "salesforce") {
    return undefined;
  }

  const sourceEvidenceId = input.sourceEvidence.id;
  const eventContext = (
    await input.repositories.salesforceEventContext.listBySourceEvidenceIds([
      sourceEvidenceId,
    ])
  )[0];
  const [project, expedition] = await Promise.all([
    eventContext?.projectId === null || eventContext?.projectId === undefined
      ? Promise.resolve(undefined)
      : input.repositories.projectDimensions
          .listByIds([eventContext.projectId])
          .then((records) => records[0]),
    eventContext?.expeditionId === null ||
    eventContext?.expeditionId === undefined
      ? Promise.resolve(undefined)
      : input.repositories.expeditionDimensions
          .listByIds([eventContext.expeditionId])
          .then((records) => records[0]),
  ]);

  return buildRoutingContext({
    eventContext,
    project,
    expedition,
  });
}

async function shouldResolveRoutingCase(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseRecord: RoutingReviewCase;
  readonly routing:
    | NonNullable<NormalizedCanonicalEventIntake["routing"]>
    | undefined;
}): Promise<boolean> {
  if (!input.routing?.required) {
    return false;
  }

  const memberships =
    await input.repositories.contactMemberships.listByContactId(
      input.caseRecord.contactId,
    );

  if (memberships.length === 0) {
    return false;
  }

  const { projectId, expeditionId } = input.routing;
  const hasExplicitContext = projectId !== null || expeditionId !== null;

  if (hasExplicitContext) {
    const matchingMemberships = memberships.filter((membership) => {
      if (projectId !== null && membership.projectId !== projectId) {
        return false;
      }

      if (expeditionId !== null && membership.expeditionId !== expeditionId) {
        return false;
      }

      return true;
    });

    return matchingMemberships.length === 1;
  }

  return memberships.length === 1;
}

async function markRoutingCaseResolved(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseRecord: RoutingReviewCase;
  readonly resolvedAt: string;
}): Promise<void> {
  await input.repositories.routingReviewQueue.upsert({
    ...input.caseRecord,
    status: "resolved",
    resolvedAt: input.resolvedAt,
    explanation: `${input.caseRecord.explanation} Reconciled from stored evidence.`,
  });
}

async function executeTarget(input: {
  readonly db: Stage1Database;
  readonly target: ReconcileTarget;
  readonly dryRun: boolean;
}): Promise<"resolved" | "skipped"> {
  const processedAt = new Date().toISOString();
  let execution: "resolved" | "skipped" | null = null;

  const runInTransaction = async (tx: Stage1Database) => {
    const repositories = createStage1RepositoryBundle(tx);
    const currentCase = await repositories.routingReviewQueue.findById(
      input.target.caseRecord.id,
    );

    if (
      currentCase?.status !== "open" ||
      currentCase.reasonCode !== "routing_missing_membership"
    ) {
      execution = "skipped";

      if (input.dryRun) {
        throw new DryRunRollback();
      }

      return;
    }

    const routing = await buildRoutingFromStoredData({
      repositories,
      sourceEvidence: input.target.sourceEvidence,
    });
    const shouldResolve = await shouldResolveRoutingCase({
      repositories,
      caseRecord: currentCase,
      routing,
    });

    if (shouldResolve) {
      await markRoutingCaseResolved({
        repositories,
        caseRecord: currentCase,
        resolvedAt: processedAt,
      });
      execution = "resolved";
    } else {
      execution = "skipped";
    }

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
      `Expected reconcile execution result for source evidence ${input.target.sourceEvidence.id}.`,
    );
  }

  return execution;
}

export async function reconcileRoutingReviewQueue(
  input: ReconcileRoutingReviewQueueInput,
): Promise<ReconcileReport> {
  const logger = input.logger ?? console;
  const initialTargets = await loadOpenRoutingReconcileTargets({
    repositories: input.repositories,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  let report: ReconcileReport = {
    dryRun: input.dryRun,
    scanned: initialTargets.targets.length + initialTargets.errors.length,
    resolved: 0,
    skipped: 0,
    errors: initialTargets.errors,
  };
  const batches = chunkValues(initialTargets.targets, DEFAULT_BATCH_SIZE);

  for (const [batchIndex, batch] of batches.entries()) {
    for (const target of batch) {
      try {
        const execution = await executeTarget({
          db: input.db,
          target,
          dryRun: input.dryRun,
        });

        report = {
          ...report,
          resolved: report.resolved + (execution === "resolved" ? 1 : 0),
          skipped: report.skipped + (execution === "skipped" ? 1 : 0),
        };
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
              reason: "target_execution_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    }

    logger.log(
      JSON.stringify({
        batchIndex: batchIndex + 1,
        batchSize: batch.length,
        scanned: report.scanned,
        resolved: report.resolved,
        skipped: report.skipped,
        errors: report.errors.length,
        dryRun: report.dryRun,
      }),
    );
  }

  return report;
}
