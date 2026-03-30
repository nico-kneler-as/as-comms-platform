import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@as-comms/contracts", "@as-comms/domain", "@as-comms/ui"]
};

export default nextConfig;
