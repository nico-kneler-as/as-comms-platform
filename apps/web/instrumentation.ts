/**
 * Next.js server-startup hook (Next 15+ auto-loads `instrumentation.ts` at
 * the project root). Eagerly opens database connections so the first user
 * request after a cold deploy doesn't pay the connection-handshake cost.
 *
 * Edge runtime is intentionally skipped — the postgres-js client is Node-only.
 * Failures are swallowed so DB warm-up issues never crash the server.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  try {
    const [{ getStage1WebRuntime }, { warmConnectionPool }] = await Promise.all([
      import("@/src/server/stage1-runtime"),
      import("@as-comms/db")
    ]);
    const runtime = await getStage1WebRuntime();
    if (runtime.connection === null) {
      return;
    }
    const probeCountRaw = Number.parseInt(
      process.env.DB_WARM_PROBES ?? "5",
      10
    );
    const probeCount =
      Number.isFinite(probeCountRaw) && probeCountRaw > 0 ? probeCountRaw : 5;
    await warmConnectionPool(runtime.connection, probeCount);
    console.log(
      `[db] connection pool warmed with ${String(probeCount)} probes at boot`
    );
  } catch (error) {
    console.warn("[db] connection pool warm-up failed:", error);
  }
}
