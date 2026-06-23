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
      // Browser-safe subpath exports avoid transitive node:crypto pull from
      // outbound-email-dedup. Any new subpath needs another entry — check is exact-string.
      "@as-comms/domain/phone",
      "@as-comms/domain/sms-segments",
      "@as-comms/db/parse-source-url",
      "@as-comms/ui"
    ])
  },
  "apps/gmail-capture": {
    // gmail-capture is a separate Railway deployable that owns local
    // attachment storage and writes attachment metadata to durable storage
    // directly via @as-comms/db. Unlike apps/web, it does not need a
    // composition-root indirection — the entire service is the boundary.
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/integrations",
      "@as-comms/db",
      "@as-comms/db/test-helpers"
    ])
  },
  "apps/sms-capture": {
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/integrations",
      "@as-comms/db",
      "@as-comms/db/test-helpers",
      "@as-comms/domain",
      "@as-comms/domain/phone"
    ])
  },
  "apps/salesforce-capture": {
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/integrations"
    ])
  },
  "apps/worker": {
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/domain",
      "@as-comms/integrations",
      "@as-comms/db"
    ])
  },
  "packages/contracts": {
    allowedWorkspaceImports: new Set()
  },
  "packages/db": {
    // db consumes contracts (table types) and domain (record shapes
    // re-exported by repositories.ts). It does NOT consume integrations
    // — that would be a layer inversion.
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/domain",
      "@as-comms/domain/phone"
    ])
  },
  "packages/domain": {
    allowedWorkspaceImports: new Set(["@as-comms/contracts"])
  },
  "packages/integrations": {
    // integrations consumes contracts (provider record schemas) and
    // domain (capture-service types). The one test-only import of
    // `@as-comms/db/test-helpers` gets a narrow per-file exception below.
    allowedWorkspaceImports: new Set([
      "@as-comms/contracts",
      "@as-comms/domain",
      "@as-comms/domain/phone"
    ])
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
    (relativeFile === "apps/web/app/settings/actions.ts" ||
      relativeFile === "apps/web/src/server/settings/selectors.ts") &&
    specifier === "@as-comms/db"
  ) {
    // Settings server actions + selectors compose the AI Knowledge source
    // registry helpers (addSource/updateSource/removeSource/parseSourceUrl/
    // inputHashFromSources/AiKnowledgeSourceValidationError). These are pure
    // data utilities that happen to live in @as-comms/db; a future cleanup
    // can promote them to a browser-safe subpath. Until then, narrow exception.
    return true;
  }

  if (
    relativeFile === "apps/worker/test/helpers.ts" &&
    specifier === "@as-comms/db/test-helpers"
  ) {
    // Worker tests centralize Stage 1 PGlite-backed db fixture wiring here.
    // Keep the exception narrow to the single local test-helper module.
    return true;
  }

  if (
    relativeFile ===
      "packages/integrations/test/stage3-gmail-reconciliation.test.ts" &&
    specifier === "@as-comms/db/test-helpers"
  ) {
    // Test-only reconciliation coverage needs the Stage 1 db helper wiring.
    // Keep this escape hatch narrow to the single spec and specifier.
    return true;
  }

  if (
    (relativeFile === "apps/web/src/server/composer/gmail-send.ts" ||
      relativeFile === "apps/web/src/server/composer/twilio-send.ts") &&
    specifier === "@as-comms/integrations"
  ) {
    // Composition root for Composer provider sends. Reads env-based
    // transport config and forwards to the integrations send client.
    // No other apps/web file may import from @as-comms/integrations.
    return true;
  }

  if (
    relativeFile === "apps/web/tests/unit/postmark-webhook-route.test.ts" &&
    specifier === "@as-comms/db"
  ) {
    // Test-only direct use of createStage5RepositoryBundle so the webhook
    // route handler test can seed + read campaign runs / audience snapshots
    // / suppression list against the PGlite-backed runtime. Production
    // apps/web code goes through the runtime composition root.
    return true;
  }

  if (
    (relativeFile === "apps/web/src/server/composer/drafts.ts" ||
      relativeFile === "apps/web/app/inbox/_lib/composer-draft-storage.ts" ||
      relativeFile === "apps/web/app/inbox/_hooks/use-composer-draft-state.ts") &&
    specifier === "@as-comms/db"
  ) {
    // PRD #553 Brick B:
    // - drafts.ts: composer-drafts server actions need the upsert/list/delete
    //   repository functions. Narrow exception modelled after settings/actions.ts.
    // - composer-draft-storage.ts + use-composer-draft-state.ts: type-only
    //   imports of `ComposerDraftPaneMode` and `ComposerDraftRecord` (the
    //   db mapper's camelCase domain shape). The contracts schema is
    //   snake_case for wire transport, so the client-side storage layer
    //   reaches into the db package's type aliases. Type imports erase at
    //   runtime and don't pull db code into the client bundle.
    // A future cleanup can promote these through the stage1-runtime
    // composition root + a contracts-side camelCase record schema.
    return true;
  }

  if (
    (relativeFile === "apps/web/app/api/webhooks/postmark/route.ts" ||
      relativeFile === "apps/web/app/settings/actions.ts" ||
      relativeFile === "apps/web/app/broadcasts/actions.ts") &&
    specifier === "@as-comms/integrations"
  ) {
    // Stage 5A Briefs A2 + A5: Postmark client composition for the webhook
    // route handler, the Settings re-check action, and the campaign test-send
    // Server Action. Each file builds its own PostmarkClient from env vars +
    // webhook signing secret. A future cleanup could promote a single
    // composition root at apps/web/src/server/postmark/, but the three-call
    // surface today is narrow enough to track as an explicit exception.
    return true;
  }

  if (
    relativeFile === "apps/web/src/server/ai/provider.ts" &&
    specifier === "@as-comms/integrations"
  ) {
    // Composition root for Stage 4 AI draft generation. This file owns the
    // env-based Anthropic client wiring so the rest of apps/web only depends
    // on domain-facing orchestration code.
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
