import type { TaskList } from "graphile-worker";

import { noopJobName } from "@as-comms/contracts";

import { runStage0NoopJob } from "./jobs/noop.js";

export function createTaskList(): TaskList {
  return {
    [noopJobName]: runStage0NoopJob
  };
}
