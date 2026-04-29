import type {
  GmailRecord,
  MailchimpRecord,
  SalesforceRecord,
  SimpleTextingRecord
} from "@as-comms/integrations";

import {
  createTestStage1Context,
  type TestStage1Context
} from "../../../packages/db/test/helpers.js";
import { createStage1IngestService, type Stage1IngestService } from "../src/ingest/index.js";
import {
  createStage1SyncStateService,
  createStage1WorkerOrchestrationService,
  type Stage1CapturedBatch,
  type Stage1ProviderCapturePorts,
  type Stage1SyncStateService,
  type Stage1WorkerOrchestrationService
} from "../src/orchestration/index.js";

export interface TestWorkerContext extends TestStage1Context {
  readonly ingest: Stage1IngestService;
  readonly syncState: Stage1SyncStateService;
  readonly capture: Stage1ProviderCapturePorts;
  readonly orchestration: Stage1WorkerOrchestrationService;
  dispose(): Promise<void>;
}

type UpsertNormalizedContactGraphInput = Parameters<
  TestStage1Context["normalization"]["upsertNormalizedContactGraph"]
>[0];

export function buildCapturedBatch<TRecord>(
  records: readonly TRecord[],
  input?: {
    readonly nextCursor?: string | null;
    readonly checkpoint?: string | null;
  }
): Stage1CapturedBatch<TRecord> {
  return {
    records,
    nextCursor: input?.nextCursor ?? null,
    checkpoint: input?.checkpoint ?? null
  };
}

export function createEmptyCapturePorts(): Stage1ProviderCapturePorts {
  return {
    gmail: {
      captureHistoricalBatch: () =>
        Promise.resolve(
          buildCapturedBatch<GmailRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        ),
      captureLiveBatch: () =>
        Promise.resolve(
          buildCapturedBatch<GmailRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        )
    },
    salesforce: {
      captureHistoricalBatch: () =>
        Promise.resolve(
          buildCapturedBatch<SalesforceRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        ),
      captureLiveBatch: () =>
        Promise.resolve(
          buildCapturedBatch<SalesforceRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        )
    },
    simpleTexting: {
      captureHistoricalBatch: () =>
        Promise.resolve(
          buildCapturedBatch<SimpleTextingRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        ),
      captureLiveBatch: () =>
        Promise.resolve(
          buildCapturedBatch<SimpleTextingRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        )
    },
    mailchimp: {
      captureHistoricalBatch: () =>
        Promise.resolve(
          buildCapturedBatch<MailchimpRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        ),
      captureTransitionBatch: () =>
        Promise.resolve(
          buildCapturedBatch<MailchimpRecord>([], {
            nextCursor: null,
            checkpoint: null
          })
        )
    }
  };
}

export async function createTestWorkerContext(input?: {
  readonly capture?: Stage1ProviderCapturePorts;
  readonly gmailHistoricalReplay?: {
    readonly liveAccount?: string;
    readonly projectInboxAliases?: readonly string[];
  };
  readonly revalidateInboxViews?: (input: {
    readonly contactIds: readonly string[];
  }) => Promise<void>;
  readonly logger?: Pick<Console, "info">;
}): Promise<TestWorkerContext> {
  const baseContext = await createTestStage1Context();
  const normalization = {
    ...baseContext.normalization,
    async upsertNormalizedContactGraph(
      value: UpsertNormalizedContactGraphInput
    ) {
      const memberships = (value.memberships ?? []).map((membership) => ({
        ...membership,
        ...(membership.source === "salesforce" &&
        membership.salesforceMembershipId == null
          ? {
              salesforceMembershipId: `${membership.id}:sf`
            }
          : {})
      }));

      const projectDimensions = [...(value.projectDimensions ?? [])];
      const expeditionDimensions = [...(value.expeditionDimensions ?? [])];

      for (const membership of memberships) {
        if (
          membership.projectId !== null &&
          !projectDimensions.some(
            (dimension) => dimension.projectId === membership.projectId
          )
        ) {
          projectDimensions.push({
            projectId: membership.projectId,
            projectName: membership.projectId,
            source: "salesforce"
          });
        }

        if (
          membership.projectId !== null &&
          membership.expeditionId !== null &&
          !expeditionDimensions.some(
            (dimension) => dimension.expeditionId === membership.expeditionId
          )
        ) {
          expeditionDimensions.push({
            expeditionId: membership.expeditionId,
            projectId: membership.projectId,
            expeditionName: membership.expeditionId,
            source: "salesforce"
          });
        }
      }

      await Promise.all([
        ...projectDimensions.map((dimension) =>
          baseContext.repositories.projectDimensions.upsert(dimension)
        ),
        ...expeditionDimensions.map((dimension) =>
          baseContext.repositories.expeditionDimensions.upsert(dimension)
        ),
      ]);

      return baseContext.normalization.upsertNormalizedContactGraph({
        ...value,
        memberships,
        projectDimensions,
        expeditionDimensions
      });
    }
  };
  const { persistence } = baseContext;
  const ingest = createStage1IngestService(normalization);
  const capture = input?.capture ?? createEmptyCapturePorts();
  const orchestration = createStage1WorkerOrchestrationService({
    capture,
    ingest,
    normalization,
    persistence,
    gmailHistoricalReplay: {
      liveAccount:
        input?.gmailHistoricalReplay?.liveAccount ??
        "volunteers@adventurescientists.org",
      projectInboxAliases: [
        ...(input?.gmailHistoricalReplay?.projectInboxAliases ?? [
          "orcas@adventurescientists.org"
        ])
      ]
    },
    ...(input?.revalidateInboxViews === undefined
      ? {}
      : {
          revalidateInboxViews: input.revalidateInboxViews
        }),
    ...(input?.logger === undefined
      ? {}
      : {
          logger: input.logger
        })
  });

  return {
    ...baseContext,
    normalization,
    ingest,
    syncState: createStage1SyncStateService(persistence),
    capture,
    orchestration,
    async dispose() {
      await baseContext.client.close();
    }
  };
}
