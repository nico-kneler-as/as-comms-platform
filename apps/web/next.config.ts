import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// TODO(canon): document D-035 — security hygiene minimums (headers, rate limits, read audit)
const contentSecurityPolicy = [
  "default-src 'self'",
  [
    "script-src",
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    "accounts.google.com",
  ].join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  ["connect-src", "'self'", ...(isDev ? ["ws:", "wss:"] : [])].join(" "),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' accounts.google.com",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: [
    "@as-comms/contracts",
    "@as-comms/db",
    "@as-comms/domain",
    "@as-comms/ui",
  ],
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
    ]);
  },
};

export default nextConfig;
