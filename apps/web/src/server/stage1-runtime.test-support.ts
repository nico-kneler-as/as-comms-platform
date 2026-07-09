/**
 * Test-only extensions to the Stage 1 web runtime.
 *
 * Lives as a separate module so that production code paths (especially
 * Edge-runtime surfaces like `middleware.ts` and the auth chain) never
 * transitively bundle `@as-comms/db/test-helpers` — which pulls in PGlite
 * and its dynamic-code-evaluation requirement, banned under Next.js Edge
 * Runtime.
 *
 * Production code must import only from `./stage1-runtime`. Test files may
 * import from here to get `createStage1WebTestRuntime`, `TestStage1Context`,
 * and related helpers.
 */
import type { TestStage1Context } from "@as-comms/db/test-helpers";
import {
  createStage1InternalNoteService,
  createStage1TimelinePresentationService,
} from "@as-comms/domain";
import type { OrgSenderRecord } from "@as-comms/contracts";

import {
  setStage1WebRuntimeForTests,
  type Stage1WebRuntime,
} from "./stage1-runtime";
import {
  createOrgSender,
  createStage5RepositoryBundle,
  insertBroadcastLinkClick,
  setOrgSenderEnabled,
  upsertNewsletterSubscriber,
} from "@as-comms/db";

export type { TestStage1Context } from "@as-comms/db/test-helpers";

export interface Stage1WebTestRuntime {
  readonly context: TestStage1Context;
  readonly runtime: Stage1WebRuntime;
  dispose(): Promise<void>;
}

export async function createStage1WebTestRuntime(): Promise<Stage1WebTestRuntime> {
  const { createTestStage1Context } = await import("@as-comms/db/test-helpers");
  const context = await createTestStage1Context();

  const runtime: Stage1WebRuntime = {
    connection: {
      db: context.db as unknown as NonNullable<Stage1WebRuntime["connection"]>["db"],
      sql: null as never,
    },
    repositories: context.repositories,
    campaigns: createStage5RepositoryBundle(context.db),
    settings: context.settings,
    normalization: context.normalization,
    timelinePresentation: createStage1TimelinePresentationService(
      context.repositories,
    ),
    internalNotes: createStage1InternalNoteService({
      persistence: context.persistence,
      normalization: context.normalization,
    }),
  };
  setStage1WebRuntimeForTests(runtime);

  return {
    context,
    runtime,
    async dispose() {
      setStage1WebRuntimeForTests(null);
      await context.client.close();
    },
  };
}

export async function createOrgSenderForTests(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly email: string;
    readonly label: string;
  },
): Promise<OrgSenderRecord> {
  return createOrgSender(runtime.context.db, input);
}

export async function setOrgSenderEnabledForTests(
  runtime: Stage1WebTestRuntime,
  id: string,
  enabled: boolean,
): Promise<void> {
  await setOrgSenderEnabled(runtime.context.db, id, enabled);
}

export async function upsertNewsletterSubscriberForTests(
  runtime: Stage1WebTestRuntime,
  input: Parameters<typeof upsertNewsletterSubscriber>[1],
) {
  return upsertNewsletterSubscriber(runtime.context.db, input);
}

export async function insertBroadcastLinkClickForTests(
  runtime: Stage1WebTestRuntime,
  input: Parameters<typeof insertBroadcastLinkClick>[1],
) {
  return insertBroadcastLinkClick(runtime.context.db, input);
}
