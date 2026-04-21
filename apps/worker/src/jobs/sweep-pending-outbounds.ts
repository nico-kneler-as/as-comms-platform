import type { Task } from "graphile-worker";

import type { PendingComposerOutboundRepository } from "@as-comms/domain";

export const sweepPendingOutboundsJobName = "sweep-pending-outbounds" as const;

export interface PendingOutboundSweepTaskDependencies {
  readonly pendingOutbounds: PendingComposerOutboundRepository;
  readonly logger?: Pick<Console, "log">;
  readonly now?: () => Date;
}

export function createSweepPendingOutboundsTask(
  dependencies: PendingOutboundSweepTaskDependencies
): Task {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? (() => new Date());

  return async () => {
    const olderThan = new Date(now().getTime() - 30 * 60 * 1000);
    const count = await dependencies.pendingOutbounds.sweepOrphans({ olderThan });

    logger.log(
      JSON.stringify({
        event: "composer.orphan_sweep.completed",
        count,
        olderThan: olderThan.toISOString()
      })
    );
  };
}
