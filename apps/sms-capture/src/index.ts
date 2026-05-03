export {
  createSmsCaptureServer,
  readSmsCaptureRuntimeConfig,
  smsCaptureRuntimeConfigSchema,
  startSmsCaptureServer,
  type SmsCaptureRuntimeConfig,
} from "./server.js";
import {
  readSmsCaptureRuntimeConfig,
  startSmsCaptureServer,
} from "./server.js";

async function main(): Promise<void> {
  const config = readSmsCaptureRuntimeConfig(process.env);
  await startSmsCaptureServer(config);
  console.info(
    `SMS capture service is listening on http://${config.host}:${String(config.port)}`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).toString();

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error("SMS capture service failed to start.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
