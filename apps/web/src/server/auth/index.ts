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
import { canSignInWithGoogle } from "./google-sign-in-policy";

async function buildAuthConfig(): Promise<NextAuthConfig> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error(
      "Auth.js requires a live Stage 1 database connection; none is currently configured."
    );
  }

  return {
    ...authEdgeConfig,
    // JWT session strategy so Edge middleware can decode the session
    // cookie without a DB call. The cookie is a JWE signed + encrypted
    // with AUTH_SECRET — "server-owned" in the sense that only the
    // server can mint or verify it. Database strategy is incompatible
    // with middleware gating (middleware can't query the sessions
    // table from Edge Runtime) and is unnecessary at our operator scale.
    //
    // Note: the `sessions` table added by migration 0005 is unused under
    // JWT strategy and can be dropped in a later cleanup. Users,
    // accounts, and verification_tokens are still required by the
    // adapter for OAuth linking and email verification flows.
    session: {
      strategy: "jwt",
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS
    },
    adapter: DrizzleAdapter(runtime.connection.db, authAdapterTables),
    callbacks: {
      async signIn({ user }) {
        const email = user.email;
        const repos = await getSettingsRepositories();
        const record = email ? await repos.users.findByEmail(email) : null;

        // Fail closed: only pre-seeded, active AS Workspace users may
        // complete Google OAuth. This blocks adapter-driven first-time
        // operator creation for arbitrary Google accounts.
        return canSignInWithGoogle({
          email,
          userRecord: record
        });
      },
      async jwt({ token, user }) {
        // `user` is only present on the initial sign-in. On every
        // subsequent JWT decode, only `token` is populated — so we
        // early-return to avoid redundant DB lookups per request.
        // On sign-in, stamp the operator's id and role onto the token
        // so middleware + session callbacks don't need another DB hit.
        // Auth.js types `user` as non-nullable in this callback, but at
        // runtime it's only set on the initial sign-in (undefined on
        // subsequent JWT decodes). The optional chain is semantically
        // required; the lint rule is wrong here.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const userId = user?.id;
        if (!userId) {
          return token;
        }
        const repos = await getSettingsRepositories();
        const record = await repos.users.findById(userId);
        if (record) {
          token.id = record.id;
          token.role = record.role;
        } else {
          token.id = userId;
        }
        return token;
      },
      session({ session, token }) {
        // Project the operator's role and id from the JWT token onto
        // the session object consumed by Server Components / Actions.
        if (typeof token.id === "string") {
          session.user.id = token.id;
        }
        if (token.role) {
          session.user.role = token.role;
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
