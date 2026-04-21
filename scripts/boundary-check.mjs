import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoots = ["apps", "packages"];
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

const workspaceRules = {
  "apps/web": {
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/domain",
      "@as-comms/ui"
    ])
  },
  "apps/gmail-capture": {
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/integrations"
    ])
  },
  "apps/salesforce-capture": {
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/integrations"
    ])
  },
  "packages/contracts": {
    allowedWorkspaceImports: new Set()
  },
  "packages/domain": {
    allowedWorkspaceImports: new Set(["@as-comms/contracts"])
  },
  "packages/ui": {
    allowedWorkspaceImports: new Set()
  }
};

function isAllowedWorkspaceImport(scope, relativeFile, specifier) {
  if (workspaceRules[scope].allowedWorkspaceImports.has(specifier)) {
    return true;
  }

  if (
    relativeFile === "apps/web/src/server/stage1-runtime.ts" &&
    specifier.startsWith("@as-comms/db")
  ) {
    // This file is the explicit Stage 1 composition root for web runtime wiring.
    // It may assemble concrete db-backed repositories, but no other apps/web file may.
    return true;
  }

  if (
    relativeFile === "apps/web/src/server/stage1-runtime.test-support.ts" &&
    specifier.startsWith("@as-comms/db")
  ) {
    // Test-only split of the composition root. Keeps `@as-comms/db/test-helpers`
    // (which pulls in PGlite) off the production Edge Runtime bundle path.
    // Only test files may import this module.
    return true;
  }

  if (
    relativeFile === "apps/web/src/server/composer/gmail-send.ts" &&
    specifier === "@as-comms/integrations"
  ) {
    // Composition root for Composer Gmail sends. Reads env-based OAuth
    // config and forwards to the integrations send client. No other
    // apps/web file may import from @as-comms/integrations.
    return true;
  }

  return false;
}

async function collectFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (["dist", "node_modules", ".next", "coverage"].includes(entry.name)) {
        continue;
      }

      files.push(...(await collectFiles(absolutePath)));
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function findScope(relativePath) {
  for (const scope of Object.keys(workspaceRules)) {
    if (relativePath.startsWith(`${scope}/`)) {
      return scope;
    }
  }

  return null;
}

function findWorkspaceRoot(relativePath) {
  const segments = relativePath.split(path.sep);
  if (segments.length < 2) {
    return null;
  }

  return path.join(segments[0], segments[1]);
}

function extractSpecifiers(content) {
  const specifiers = [];
  const pattern =
    /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of content.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function formatViolation(filePath, specifier, message) {
  return `${filePath}: ${message} (${specifier})`;
}

async function main() {
  const files = [];
  for (const root of sourceRoots) {
    try {
      files.push(...(await collectFiles(path.join(repoRoot, root))));
    } catch {
      // Ignore missing roots during partial setup; Stage 0 verify handles shape.
    }
  }

  const violations = [];

  for (const file of files) {
    const relativeFile = path.relative(repoRoot, file);
    const scope = findScope(relativeFile);

    if (!scope) {
      continue;
    }

    const workspaceRoot = findWorkspaceRoot(relativeFile);
    const rules = workspaceRules[scope];
    const content = await fs.readFile(file, "utf8");
    const specifiers = extractSpecifiers(content);

    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        const resolved = path.normalize(
          path.relative(
            repoRoot,
            path.resolve(path.dirname(file), specifier.replace(/\.js$/, ""))
          )
        );
        const resolvedWorkspaceRoot = findWorkspaceRoot(resolved);

        if (
          workspaceRoot &&
          resolvedWorkspaceRoot &&
          resolvedWorkspaceRoot !== workspaceRoot
        ) {
          violations.push(
            formatViolation(
              relativeFile,
              specifier,
              "cross-package relative imports are not allowed"
            )
          );
        }

        continue;
      }

      if (!specifier.startsWith("@as-comms/")) {
        continue;
      }

      if (!isAllowedWorkspaceImport(scope, relativeFile, specifier)) {
        violations.push(
          formatViolation(
            relativeFile,
            specifier,
            `workspace import is outside the allowed ${scope} boundary`
          )
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error("Boundary check failed.");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Boundary check passed.");
}

await main();
