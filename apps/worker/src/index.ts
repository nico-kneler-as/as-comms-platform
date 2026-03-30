import { startWorker } from "./runtime.js";

async function main() {
  const runner = await startWorker();
  if (!runner) {
    return;
  }

  console.info("Stage 0 worker runtime is active with no-op jobs only.");
  await runner.promise;
}

void main().catch((error: unknown) => {
  console.error("Stage 0 worker bootstrap failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
