import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: [
    "@as-comms/contracts",
    "@as-comms/db",
    "@as-comms/domain",
    "@as-comms/ui"
  ]
};

export default nextConfig;
