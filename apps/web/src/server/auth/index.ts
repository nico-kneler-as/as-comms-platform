/**
 * Auth.js v5 full composition for Node-runtime consumers — Server
 * Components, Server Actions, and the `/api/auth/[...nextauth]` route
 * handler.
 *
 * Environment variables:
 * - `AUTH_SECRET` (required in production): HMAC secret for JWT / CSRF.
 * - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (or the v5-preferred
 *   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`): OAuth app credentials.
 *
 * Edge-runtime middleware uses `./config.ts` instead to avoid pulling the
 * DrizzleAdapter + Stage 1 runtime into the Edge bundle. See
 * `apps/web/middleware.ts`.
 *
 * Boundary rule: this file MUST NOT import from `@as-comms/db`. The only
 * approved path into the Drizzle db instance from apps/web is through the
 * composition root at `apps/web/src/server/stage1-runtime.ts`, which
 * exposes `getStage1WebRuntime()` (returning `runtime.connection.db`).
 *
 * Adapter wiring uses Auth.js v5 lazy/async config (see `NextAuth(async …)`):
 * the DrizzleAdapter is created inside the async config callback after the
 * Stage 1 runtime has been awaited, which keeps the module load side-effect
 * free while still handing the adapter a synchronous Drizzle db instance.
 */
import NextAuth, {
  type NextAuthConfig,
  type NextAuthResult
} from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";

import {
  authAdapterTables,
  getStage1WebRuntime,
  getSettingsRepositories
} from "../stage1-runtime";
import {
  authEdgeConfig,
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS
} from "./config";

async function buildAuthConfig(): Promise<NextAuthConfig> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error(
      "Auth.js requires a live Stage 1 database connection; none is currently configured."
    );
  }

  return {
    ...authEdgeConfig,
    // `database` strategy forces Auth.js to persist sessions through the
    // adapter; this matches the settings-bundle mandate that production runs
    // with server-owned sessions rather than JWTs.
    session: {
      strategy: "database",
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS
    },
    adapter: DrizzleAdapter(runtime.connection.db, authAdapterTables),
    callbacks: {
      async signIn({ user }) {
        // Deactivated operators must not be able to sign in, even if an
        // OAuth flow succeeds against Google. The schema default is
        // `deactivatedAt = null` so freshly created operators pass.
        const email = user.email;
        if (!email) return false;
        const repos = await getSettingsRepositories();
        const record = await repos.users.findByEmail(email);
        if (record?.deactivatedAt) {
          return false;
        }
        return true;
      },
      async session({ session, user }) {
        // Project the operator's role and id onto the session so server
        // handlers can make role checks without an extra DB hit per request.
        const repos = await getSettingsRepositories();
        const record = await repos.users.findById(user.id);
        if (record) {
          session.user.id = record.id;
          session.user.role = record.role;
        } else {
          session.user.id = user.id;
        }
        return session;
      }
    }
  };
}

const nextAuth: NextAuthResult = NextAuth(async () => {
  return buildAuthConfig();
});

export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
