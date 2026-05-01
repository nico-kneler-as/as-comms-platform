#!/usr/bin/env tsx
import process from "node:process";

import { runBackfillContentFingerprintCommand } from "../../apps/worker/src/ops/backfill-content-fingerprint.js";

await runBackfillContentFingerprintCommand(process.argv.slice(2), process.env);
