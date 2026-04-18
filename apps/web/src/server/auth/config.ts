/**
 * Edge-safe Auth.js v5 configuration shared by `middleware.ts` and the
 * full Node-runtime auth in `./index.ts`.
 *
 * Boundary rule: this module MUST NOT import from `@as-comms/db`,
 * `@as-comms/domain`, or `../stage1-runtime`. Transitively pulling the
 * Stage 1 composition root into the Edge Runtime bundle breaks `next build`
 * because the domain package uses `node:crypto` and db test helpers use
 * PGlite (dynamic code evaluation, banned under Edge Runtime).
 *
 * The full auth (with DrizzleAdapter + DB-backed callbacks + database
 * session strategy) lives in `./index.ts` and is used by Server Components,
 * Server Actions, and the Auth.js route handler at `/api/auth/[...nextauth]`.
 */
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30-day rolling session
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export const authEdgeConfig = {
  providers: [Google],
  pages: {
    signIn: "/auth/sign-in"
  },
  // `trustHost` is required under hosted previews / Railway where the
  // request host is not identical to `AUTH_URL`.
  trustHost: true
} satisfies NextAuthConfig;
