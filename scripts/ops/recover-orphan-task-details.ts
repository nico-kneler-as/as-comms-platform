#!/usr/bin/env tsx

import process from "node:process";

import { main } from "../../apps/worker/src/ops/recover-orphan-task-details.js";

await main(process.argv.slice(2), process.env);
