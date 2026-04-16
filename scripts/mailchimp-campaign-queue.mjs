#!/usr/bin/env node

import { mkdir, appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_PATH = resolve(ROOT, "node_modules/.bin/tsx");
const WORKER_CLI_PATH = resolve(ROOT, "apps/worker/src/ops/cli.ts");
const DEFAULT_ARTIFACT_ROOT = resolve(
  ROOT,
  "tmp/provider-exports/mailchimp-api-backfill/campaigns"
);
const LOG_DIR = resolve(ROOT, "tmp/overnight-backfill");
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CONCURRENCY = 1;

function buildOperationId(prefix) {
  return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function timestamp() {
  return new Date().toISOString();
}

async function appendLog(logPath, message) {
  await appendFile(logPath, `[${timestamp()}] ${message}\n`, "utf8");
}

function extractJson(stdout) {
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return JSON.parse(trimmed);
}

function buildResultSummary(result, parsedPayload) {
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    parsedPayload
  };
}

function shouldRetry(result, parsedPayload) {
  const combinedText = `${result.stdout}\n${result.stderr}`;
  const retryableNetworkPattern =
    /EADDRNOTAVAIL|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|read EADDRNOTAVAIL|read ECONNRESET/iu;

  if (result.timedOut) {
    return true;
  }

  if (retryableNetworkPattern.test(combinedText)) {
    return true;
  }

  if (
    parsedPayload !== null &&
    typeof parsedPayload === "object" &&
    "outcome" in parsedPayload &&
    parsedPayload.outcome === "failed" &&
    "message" in parsedPayload &&
    typeof parsedPayload.message === "string" &&
    retryableNetworkPattern.test(parsedPayload.message)
  ) {
    return true;
  }

  return false;
}

async function runCliCommand({
  args,
  logPath,
  timeoutMs
}) {
  const child = spawn(TSX_PATH, [WORKER_CLI_PATH, ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let timeoutHandle = null;

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000).unref();
    }, timeoutMs);
    timeoutHandle.unref();
  }

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
  });

  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.on("error", rejectExit);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });

  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle);
  }

  if (stdout.trim().length > 0) {
    await appendLog(logPath, `stdout:\n${stdout.trim()}`);
  }

  if (stderr.trim().length > 0) {
    await appendLog(logPath, `stderr:\n${stderr.trim()}`);
  }

  return {
    exitCode,
    stdout,
    stderr,
    timedOut
  };
}

async function processCampaign({
  campaignId,
  artifactRoot,
  logPath,
  timeoutMs,
  maxAttempts,
  workerLabel
}) {
  let attempt = 0;
  const syncStateId = `stage1:mailchimp:artifacts:sync-state:overnight:${campaignId}`;

  while (attempt < maxAttempts) {
    attempt += 1;
    const correlationId = buildOperationId(
      `stage1:mailchimp:artifacts:correlation:overnight:${campaignId}`
    );

    await appendLog(
      logPath,
      `${workerLabel} starting campaign ${campaignId} attempt ${attempt}/${maxAttempts}`
    );

    const result = await runCliCommand({
      args: [
        "import-mailchimp-artifacts",
        "--artifact-path",
        artifactRoot,
        "--start-at-campaign-id",
        campaignId,
        "--limit-campaigns",
        "1",
        "--sync-state-id",
        syncStateId,
        "--correlation-id",
        correlationId
      ],
      logPath,
      timeoutMs
    });

    let parsedPayload = null;

    try {
      parsedPayload = extractJson(result.stdout);
      await appendLog(
        logPath,
        `${workerLabel} campaign ${campaignId} result: ${JSON.stringify(parsedPayload)}`
      );
    } catch (error) {
      await appendLog(
        logPath,
        `${workerLabel} campaign ${campaignId} produced non-JSON stdout: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    await appendLog(
      logPath,
      `${workerLabel} campaign ${campaignId} attempt ${attempt} summary: ${JSON.stringify(
        buildResultSummary(result, parsedPayload)
      )}`
    );

    if (!shouldRetry(result, parsedPayload)) {
      return;
    }

    await appendLog(
      logPath,
      `${workerLabel} campaign ${campaignId} hit a retryable failure; sleeping before retry`
    );
    await delay(5000);
  }
}

async function main() {
  const campaignIds = process.argv.slice(2);

  if (campaignIds.length === 0) {
    console.error(
      "Usage: node scripts/mailchimp-campaign-queue.mjs <campaign-id> [campaign-id...]"
    );
    process.exit(1);
  }

  await mkdir(LOG_DIR, {
    recursive: true
  });

  const logPath = resolve(
    LOG_DIR,
    `mailchimp-campaign-queue-${Date.now().toString(36)}.log`
  );
  const artifactRoot =
    process.env.MAILCHIMP_ARTIFACT_ROOT ?? DEFAULT_ARTIFACT_ROOT;
  const timeoutMs = Number.parseInt(
    process.env.MAILCHIMP_CAMPAIGN_TIMEOUT_MS ?? `${DEFAULT_TIMEOUT_MS}`,
    10
  );
  const maxAttempts = Number.parseInt(
    process.env.MAILCHIMP_CAMPAIGN_MAX_ATTEMPTS ?? `${DEFAULT_MAX_ATTEMPTS}`,
    10
  );
  const concurrency = Math.max(
    1,
    Number.parseInt(
      process.env.MAILCHIMP_CAMPAIGN_CONCURRENCY ?? `${DEFAULT_CONCURRENCY}`,
      10
    )
  );

  await appendLog(
    logPath,
    `starting Mailchimp queue with ${campaignIds.length} campaign(s); artifactRoot=${artifactRoot}; timeoutMs=${timeoutMs}; maxAttempts=${maxAttempts}; concurrency=${concurrency}`
  );

  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, campaignIds.length) },
    (_, index) =>
      (async () => {
        const workerLabel = `[worker ${index + 1}]`;

        while (nextIndex < campaignIds.length) {
          const campaignId = campaignIds[nextIndex];
          nextIndex += 1;
          await processCampaign({
            campaignId,
            artifactRoot,
            logPath,
            timeoutMs,
            maxAttempts,
            workerLabel
          });
          await delay(2000);
        }
      })()
  );

  await Promise.all(workers);

  await appendLog(logPath, "mailchimp queue finished");
}

main().catch(async (error) => {
  await mkdir(LOG_DIR, {
    recursive: true
  });
  const logPath = resolve(LOG_DIR, "mailchimp-campaign-queue-error.log");
  await appendLog(
    logPath,
    `fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  );
  console.error(error);
  process.exit(1);
});
