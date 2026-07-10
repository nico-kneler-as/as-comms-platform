#!/usr/bin/env tsx
import process from "node:process";

import { runBackfillBroadcastClickClassificationCommand } from "../../apps/worker/src/ops/backfill-broadcast-click-classification.js";

await runBackfillBroadcastClickClassificationCommand(
  process.argv.slice(2),
  process.env,
);
