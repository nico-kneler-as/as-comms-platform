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
  const { normalization, persistence } = baseContext;
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
    ingest,
    syncState: createStage1SyncStateService(persistence),
    capture,
    orchestration,
    async dispose() {
      await baseContext.client.close();
    }
  };
}
