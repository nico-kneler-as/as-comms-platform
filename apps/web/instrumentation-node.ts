/**
 * Node-runtime-only instrumentation. Imported dynamically from
 * `instrumentation.ts` so the postgres-js + drizzle module graph never
 * enters the Edge bundle.
 */
import { warmConnectionPool } from "@as-comms/db";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

const probeCountRaw = Number.parseInt(process.env.DB_WARM_PROBES ?? "5", 10);
const probeCount =
  Number.isFinite(probeCountRaw) && probeCountRaw > 0 ? probeCountRaw : 5;

try {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection !== null) {
    await warmConnectionPool(runtime.connection, probeCount);
    console.log(
      `[db] connection pool warmed with ${String(probeCount)} probes at boot`
    );
  }
} catch (error) {
  console.warn("[db] connection pool warm-up failed:", error);
}
