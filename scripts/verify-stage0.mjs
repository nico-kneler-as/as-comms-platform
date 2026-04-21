import { promises as fs } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const requiredPaths = [
  "apps/web",
  "apps/worker",
  "packages/contracts",
  "packages/db",
  "packages/domain",
  "packages/integrations",
  "packages/ui",
  ".github/workflows/ci.yml",
  "docs/build-web-apps-scope.md",
  "docs/stage-0-summary.md",
  "docs/stage-0-open-questions.md",
  "scripts/boundary-check.mjs",
  "scripts/security-check.mjs"
];

const requiredRootScripts = [
  "lint",
  "typecheck",
  "build",
  "test:unit",
  "test:e2e",
  "boundaries",
  "security",
  "verify"
];

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  const content = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(content);
}

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function assertWorkspaceDependencySubset(pkg, packageName, allowed) {
  const dependencies = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  };

  const workspaceDeps = Object.keys(dependencies).filter((name) =>
    name.startsWith("@as-comms/")
  );

  for (const dependency of workspaceDeps) {
    if (!allowed.has(dependency)) {
      throw new Error(
        `${packageName} depends on ${dependency}, which is outside its Stage 0 boundary.`
      );
    }
  }
}

async function main() {
  const failures = [];

  for (const requiredPath of requiredPaths) {
    if (!(await exists(requiredPath))) {
      failures.push(`Missing required path: ${requiredPath}`);
    }
  }

  try {
    const rootPackage = await readJson("package.json");
    if (rootPackage.packageManager !== "pnpm@9.15.4") {
      failures.push("Root package.json must pin pnpm via packageManager.");
    }

    for (const scriptName of requiredRootScripts) {
      if (!rootPackage.scripts?.[scriptName]) {
        failures.push(`Root package.json is missing the ${scriptName} script.`);
      }
    }
  } catch (error) {
    failures.push(
      `Unable to validate root package.json: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    const webPackage = await readJson("apps/web/package.json");
    assertWorkspaceDependencySubset(
      webPackage,
      "@as-comms/web",
      // apps/web carries @as-comms/db only to support the explicit Stage 1
      // composition root in src/server/stage1-runtime.ts, and
      // @as-comms/integrations only to support the Composer send composition
      // root in src/server/composer/gmail-send.ts. File-level import
      // enforcement still lives in scripts/boundary-check.mjs.
      new Set([
        "@as-comms/contracts",
        "@as-comms/db",
        "@as-comms/domain",
        "@as-comms/integrations",
        "@as-comms/ui"
      ])
    );
  } catch (error) {
    failures.push(
      error instanceof Error ? error.message : "Unable to validate apps/web boundaries."
    );
  }

  try {
    const domainPackage = await readJson("packages/domain/package.json");
    assertWorkspaceDependencySubset(
      domainPackage,
      "@as-comms/domain",
      new Set(["@as-comms/contracts"])
    );
  } catch (error) {
    failures.push(
      error instanceof Error
        ? error.message
        : "Unable to validate packages/domain boundaries."
    );
  }

  try {
    const uiPackage = await readJson("packages/ui/package.json");
    assertWorkspaceDependencySubset(uiPackage, "@as-comms/ui", new Set());
  } catch (error) {
    failures.push(
      error instanceof Error ? error.message : "Unable to validate packages/ui boundaries."
    );
  }

  try {
    const dbSchema = await readText("packages/db/src/schema/index.ts");
    // Assert the databaseSchema export includes the full set of Stage 1 tables.
    // This catches accidental deletions or import drift; it does not forbid table additions.
    const expectedTables = [
      "sourceEvidenceLog",
      "contacts",
      "contactIdentities",
      "contactMemberships",
      "projectDimensions",
      "expeditionDimensions",
      "gmailMessageDetails",
      "salesforceEventContext",
      "salesforceCommunicationDetails",
      "simpleTextingMessageDetails",
      "mailchimpCampaignActivityDetails",
      "manualNoteDetails",
      "canonicalEventLedger",
      "identityResolutionQueue",
      "routingReviewQueue",
      "contactInboxProjection",
      "contactTimelineProjection",
      "syncState",
      "auditPolicyEvidence"
    ];
    const missingTables = expectedTables.filter(
      (table) => !dbSchema.includes(table)
    );
    if (missingTables.length > 0) {
      failures.push(
        `packages/db/src/schema/index.ts is missing expected Stage 1 table exports: ${missingTables.join(", ")}.`
      );
    }
  } catch (error) {
    failures.push(
      `Unable to validate DB schema exports: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    const scopeDoc = await readText("docs/build-web-apps-scope.md");
    if (!scopeDoc.includes("apps/web") || !scopeDoc.includes("packages/ui")) {
      failures.push(
        "docs/build-web-apps-scope.md must name the approved Build Web Apps write surfaces."
      );
    }
  } catch (error) {
    failures.push(
      `Unable to validate Build Web Apps scope doc: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    const ciWorkflow = await readText(".github/workflows/ci.yml");
    for (const command of [
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build",
      "pnpm test:unit",
      "pnpm test:e2e",
      "pnpm boundaries",
      "pnpm security",
      "pnpm verify"
    ]) {
      if (!ciWorkflow.includes(command)) {
        failures.push(`CI workflow must run ${command}.`);
      }
    }
  } catch (error) {
    failures.push(
      `Unable to validate CI workflow: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    const devAuthContent = await readText("apps/web/app/api/dev-auth/route.ts");
    if (
      !devAuthContent.includes("NODE_ENV") ||
      !devAuthContent.includes('"production"') ||
      !devAuthContent.includes("404")
    ) {
      failures.push(
        "apps/web/app/api/dev-auth/route.ts is missing a NODE_ENV production guard — this endpoint MUST 404 in production."
      );
    }
  } catch {
    failures.push("Missing required file: apps/web/app/api/dev-auth/route.ts");
  }

  if (failures.length > 0) {
    console.error("Stage 0 verification gate failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Stage 0 verification gate passed.");
}

await main();
