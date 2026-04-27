/**
 * Next.js server-startup hook (Next 15+ auto-loads `instrumentation.ts` at
 * the project root). Stays trivial — just dispatches into the Node-only
 * inner module so webpack never traces postgres-js into the Edge bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  await import("./instrumentation-node");
}
