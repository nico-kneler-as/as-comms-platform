import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageDirs = [
  "packages/contracts",
  "packages/db",
  "packages/domain",
  "packages/integrations",
  "packages/ui",
  "apps/worker"
];

/**
 * @param {string} packageDir
 * @param {string} relativePath
 * @param {string} label
 */
function assertFileExists(packageDir, relativePath, label) {
  const absolutePath = resolve(packageDir, relativePath);

  if (!existsSync(absolutePath)) {
    throw new Error(
      `${packageDir} ${label} points to ${relativePath}, but that file does not exist after build.`
    );
  }
}

for (const packageDir of packageDirs) {
  const packageJsonPath = resolve(packageDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  if (typeof packageJson.main === "string") {
    assertFileExists(packageDir, packageJson.main, "main");
  }

  const rootExport = packageJson.exports?.["."];

  if (
    rootExport !== undefined &&
    rootExport !== null &&
    typeof rootExport === "object"
  ) {
    if (typeof rootExport.default === "string") {
      assertFileExists(packageDir, rootExport.default, "exports.default");
    }
  }
}

console.info("Runtime export verification passed.");
