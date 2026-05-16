import type { Task } from "graphile-worker";

import { pollPostmarkSenderStatusPayloadSchema } from "@as-comms/contracts";

import {
  runPollPostmarkSenderStatus,
  type PollPostmarkSenderStatusDependencies,
} from "./poll.js";

export {
  pollPostmarkSenderStatusJobName,
  pollPostmarkSenderStatusPayloadSchema,
} from "@as-comms/contracts";
export {
  readPollPostmarkSenderStatusConfig,
  runPollPostmarkSenderStatus,
} from "./poll.js";
export type { PollPostmarkSenderStatusDependencies } from "./poll.js";

export function createPollPostmarkSenderStatusTask(
  dependencies: PollPostmarkSenderStatusDependencies,
): Task {
  return async (payload) => {
    await runPollPostmarkSenderStatus(
      dependencies,
      pollPostmarkSenderStatusPayloadSchema.parse(payload),
    );
  };
}
