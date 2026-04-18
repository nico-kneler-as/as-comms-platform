import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@as-comms/db/test-helpers",
        replacement: path.resolve(repoRoot, "packages/db/src/test-helpers.ts")
      },
      {
        find: "@as-comms/contracts",
        replacement: path.resolve(repoRoot, "packages/contracts/src/index.ts")
      },
      {
        find: "@as-comms/db",
        replacement: path.resolve(repoRoot, "packages/db/src/index.ts")
      },
      {
        find: "@as-comms/domain",
        replacement: path.resolve(repoRoot, "packages/domain/src/index.ts")
      },
      {
        find: "@as-comms/integrations",
        replacement: path.resolve(repoRoot, "packages/integrations/src/index.ts")
      },
      {
        find: "@as-comms/ui",
        replacement: path.resolve(repoRoot, "packages/ui/src/index.ts")
      }
    ]
  },
  test: {
    include: [
      "test/**/*.test.ts",
      "tests/**/*.test.ts",
      "src/**/*.test.ts"
    ],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage/unit"
    }
  }
});
