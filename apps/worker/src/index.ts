import { startWorker } from "./runtime.js";

async function main() {
  const runner = await startWorker();
  if (!runner) {
    return;
  }

  console.info(
    "Stage 1 worker runtime is active. Stage 1 capture, replay, rebuild, parity, and cutover-support tasks now execute through the single normalization path."
  );
  await runner.promise;
}

void main().catch((error: unknown) => {
  console.error("Stage 1 worker bootstrap failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
