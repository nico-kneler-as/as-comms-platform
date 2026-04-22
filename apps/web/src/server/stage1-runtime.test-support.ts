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

import {
  setStage1WebRuntimeForTests,
  type Stage1WebRuntime,
} from "./stage1-runtime";

export type { TestStage1Context } from "@as-comms/db/test-helpers";

export interface Stage1WebTestRuntime {
  readonly context: TestStage1Context;
  dispose(): Promise<void>;
}

export async function createStage1WebTestRuntime(): Promise<Stage1WebTestRuntime> {
  const { createTestStage1Context } = await import("@as-comms/db/test-helpers");
  const context = await createTestStage1Context();

  const runtime: Stage1WebRuntime = {
    connection: null,
    repositories: context.repositories,
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
    async dispose() {
      setStage1WebRuntimeForTests(null);
      await context.client.close();
    },
  };
}
