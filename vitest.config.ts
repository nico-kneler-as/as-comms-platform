import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@as-comms/contracts": path.resolve(
        repoRoot,
        "packages/contracts/src/index.ts"
      ),
      "@as-comms/db": path.resolve(repoRoot, "packages/db/src/index.ts"),
      "@as-comms/domain": path.resolve(repoRoot, "packages/domain/src/index.ts"),
      "@as-comms/integrations": path.resolve(
        repoRoot,
        "packages/integrations/src/index.ts"
      ),
      "@as-comms/ui": path.resolve(repoRoot, "packages/ui/src/index.ts")
    }
  },
  test: {
    include: [
      "test/**/*.test.ts",
      "tests/**/*.test.ts",
      "src/**/*.test.ts"
    ],
    environment: "node",
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage/unit"
    }
  }
});
