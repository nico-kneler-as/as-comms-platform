import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".css",
  ".yml",
  ".yaml"
]);

const secretPatterns = [
  { name: "private key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "GitHub token", regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Stripe live key", regex: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  {
    name: "hard-coded database URL",
    regex:
      /\b(?:DATABASE_URL|WORKER_DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["'`][^"'`\s]{8,}/g
  }
];

async function collectFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (
        ["node_modules", ".next", "dist", "coverage", "playwright-report", "test-results"].includes(
          entry.name
        )
      ) {
        continue;
      }

      files.push(...(await collectFiles(absolutePath)));
      continue;
    }

    if (textExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function findLine(content, index) {
  return content.slice(0, index).split("\n").length;
}

function isClientVisibleFile(relativePath, content) {
  return (
    relativePath.startsWith("packages/ui/") ||
    (relativePath.startsWith("apps/web/") && content.includes('"use client"'))
  );
}

async function runDependencyAudit() {
  const hasPnpm = spawnSync("pnpm", ["--version"], {
    cwd: repoRoot,
    stdio: "ignore"
  }).status === 0;

  if (!hasPnpm) {
    console.log("Security audit skipped: pnpm is not available in this environment.");
    return process.env.CI === "true" ? 1 : 0;
  }

  const result = spawnSync("pnpm", ["audit", "--audit-level", "high"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status === 0) {
    console.log("Dependency audit passed.");
    return 0;
  }

  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const message = stderr || stdout || "pnpm audit failed.";

  if (process.env.CI === "true") {
    console.error(message);
    return 1;
  }

  console.warn(`Dependency audit skipped locally: ${message}`);
  return 0;
}

async function main() {
  const files = await collectFiles(repoRoot);
  const failures = [];

  for (const file of files) {
    const relativePath = path.relative(repoRoot, file);
    const content = await fs.readFile(file, "utf8");

    for (const { name, regex } of secretPatterns) {
      for (const match of content.matchAll(regex)) {
        failures.push(
          `${relativePath}:${findLine(content, match.index ?? 0)} potential ${name}`
        );
      }
    }

    if (isClientVisibleFile(relativePath, content)) {
      for (const match of content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        const envName = match[1];
        if (envName && !envName.startsWith("NEXT_PUBLIC_")) {
          failures.push(
            `${relativePath}:${findLine(
              content,
              match.index ?? 0
            )} client-visible code must not reference server-only env vars (${envName})`
          );
        }
      }
    }
  }

  const auditStatus = await runDependencyAudit();

  if (failures.length > 0 || auditStatus !== 0) {
    console.error("Security check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Security check passed.");
}

await main();
