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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ADVENTURE_SCIENTISTS_DOMAIN = "@adventurescientists.org";

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
  readonly reason: "source_evidence_missing" | "target_execution_failed";
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

function isAdventureScientistsEmail(value: string): boolean {
  return (
    EMAIL_PATTERN.test(value) &&
    value.toLowerCase().endsWith(ADVENTURE_SCIENTISTS_DOMAIN)
  );
}

function isReplayEligibleGmailMultiCandidateCase(
  caseRecord: IdentityResolutionCase
): boolean {
  const normalizedEmails = uniqueStrings(caseRecord.normalizedIdentityValues).filter(
    (value) => EMAIL_PATTERN.test(value)
  );
  const internalEmails = normalizedEmails.filter(isAdventureScientistsEmail);
  const externalEmails = normalizedEmails.filter(
    (value) => !isAdventureScientistsEmail(value)
  );

  return internalEmails.length > 0 && externalEmails.length === 1;
}

function isSupportedReconcileCase(input: {
  readonly caseRecord: IdentityResolutionCase;
  readonly sourceEvidence: SourceEvidenceRecord;
}): boolean {
  if (input.caseRecord.reasonCode === "identity_missing_anchor") {
    return true;
  }

  return (
    input.caseRecord.reasonCode === "identity_multi_candidate" &&
    input.sourceEvidence.provider === "gmail" &&
    isReplayEligibleGmailMultiCandidateCase(input.caseRecord)
  );
}

async function loadOpenIdentityReconcileTargets(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly limit?: number;
}): Promise<{
  readonly targets: readonly ReconcileTarget[];
  readonly errors: readonly ReconcileError[];
}> {
  const [missingAnchorCases, multiCandidateCases] = await Promise.all([
    input.repositories.identityResolutionQueue.listOpenByReasonCode(
      "identity_missing_anchor"
    ),
    input.repositories.identityResolutionQueue.listOpenByReasonCode(
      "identity_multi_candidate"
    )
  ]);
  const cases = [...missingAnchorCases, ...multiCandidateCases];
  const dedupedCases = Array.from(
    new Map(cases.map((caseRecord) => [caseRecord.id, caseRecord] as const)).values()
  );
  const sourceEvidenceById = new Map(
    (
      await input.repositories.sourceEvidence.listByIds(
        uniqueStrings(dedupedCases.map((caseRecord) => caseRecord.sourceEvidenceId))
      )
    ).map((record) => [record.id, record] as const)
  );
  const targets: ReconcileTarget[] = [];
  const errors: ReconcileError[] = [];
  const limit = input.limit ?? Number.POSITIVE_INFINITY;
  let selectedCount = 0;

  for (const caseRecord of dedupedCases) {
    if (selectedCount >= limit) {
      break;
    }

    const sourceEvidence = sourceEvidenceById.get(caseRecord.sourceEvidenceId);

    if (sourceEvidence === undefined) {
      errors.push({
        caseId: caseRecord.id,
        sourceEvidenceId: caseRecord.sourceEvidenceId,
        reason: "source_evidence_missing",
        message: `Missing source evidence ${caseRecord.sourceEvidenceId} for open identity review case.`
      });
      selectedCount += 1;
      continue;
    }

    if (
      !isSupportedReconcileCase({
        caseRecord,
        sourceEvidence
      })
    ) {
      continue;
    }

    targets.push({
      caseRecord,
      sourceEvidence
    });
    selectedCount += 1;
  }

  return {
    targets,
    errors
  };
}

function resolveOriginalCaseClosure(input: {
  readonly currentReasonCode: IdentityResolutionCase["reasonCode"];
  readonly result: NormalizedCanonicalEventResult;
}): { readonly explanation: string } | null {
  const { currentReasonCode, result } = input;

  if (result.outcome === "applied" || result.outcome === "duplicate") {
    return {
      explanation: "Reconciled from stored evidence."
    };
  }

  if (result.outcome === "skipped") {
    return {
      explanation:
        "Reconciled from stored evidence; task is outside volunteer scope (no memberships for anchored contact)."
    };
  }

  if (result.outcome !== "needs_identity_review") {
    return null;
  }

  if (result.identityCase.reasonCode === currentReasonCode) {
    return null;
  }

  return {
    explanation: "Reconciled from stored evidence."
  };
}

async function markIdentityCaseResolved(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseRecord: IdentityResolutionCase;
  readonly resolvedAt: string;
  readonly explanation: string;
}): Promise<void> {
  await input.repositories.identityResolutionQueue.upsert({
    ...input.caseRecord,
    status: "resolved",
    resolvedAt: input.resolvedAt,
    explanation: `${input.caseRecord.explanation} ${input.explanation}`
  });
}

async function markIdentityCaseAttempted(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseId: string;
  readonly attemptedAt: string;
}): Promise<void> {
  const currentCase = await input.repositories.identityResolutionQueue.findById(
    input.caseId
  );

  if (currentCase === null) {
    return;
  }

  await input.repositories.identityResolutionQueue.upsert({
    ...currentCase,
    lastAttemptedAt: input.attemptedAt
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
      !isSupportedReconcileCase({
        caseRecord: currentCase,
        sourceEvidence: input.target.sourceEvidence
      })
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

    const closure = resolveOriginalCaseClosure({
      currentReasonCode: currentCase.reasonCode,
      result: normalizationResult
    });

    if (closure !== null) {
      await markIdentityCaseResolved({
        repositories,
        caseRecord: currentCase,
        resolvedAt: processedAt,
        explanation: closure.explanation
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
  const initialTargets = await loadOpenIdentityReconcileTargets({
    repositories: input.repositories,
    ...(input.limit === undefined ? {} : { limit: input.limit })
  });

  if (!input.dryRun) {
    const attemptedAt = new Date().toISOString();

    for (const error of initialTargets.errors) {
      await markIdentityCaseAttempted({
        repositories: input.repositories,
        caseId: error.caseId,
        attemptedAt
      });
    }
  }

  let report: ReconcileReport = {
    dryRun: input.dryRun,
    scanned: initialTargets.targets.length + initialTargets.errors.length,
    resolved: 0,
    created: 0,
    skipped: 0,
    errors: initialTargets.errors
  };
  const batches = chunkValues(initialTargets.targets, DEFAULT_BATCH_SIZE);

  for (const [batchIndex, batch] of batches.entries()) {
    for (const target of batch) {
      try {
        if (!input.dryRun) {
          await markIdentityCaseAttempted({
            repositories: input.repositories,
            caseId: target.caseRecord.id,
            attemptedAt: new Date().toISOString()
          });
        }

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
              reason: "target_execution_failed",
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
