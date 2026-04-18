import { NextResponse } from "next/server";

import { auth } from "./src/server/auth";

/**
 * Route protection for `/inbox/:path*` and `/settings/:path*`.
 *
 * Dev bypass order (non-production only):
 *   1. `x-dev-operator` header short-circuits auth.
 *   2. `dev-session` cookie short-circuits auth.
 *
 * Production: unauthenticated requests get redirected to `/auth/sign-in`.
 *
 * Constraint: this file is a Next.js Edge middleware. It must NOT import
 * Node-only modules (fs, pg, etc.) or perform DB calls. Session lookup is
 * delegated to the Auth.js `auth()` wrapper, which handles Edge-safe
 * session decoding.
 */
// Explicit `unknown` assertion avoids TS2742 portability errors from the
// Auth.js return type referencing internal `next-auth/lib` paths.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const middleware: any = auth((request) => {
  if (process.env.NODE_ENV !== "production") {
    if (request.headers.get("x-dev-operator")) {
      return NextResponse.next();
    }

    const devSessionCookie = request.cookies.get("dev-session");
    if (devSessionCookie?.value) {
      try {
        const payload = JSON.parse(devSessionCookie.value) as {
          readonly email?: unknown;
        };
        if (typeof payload.email === "string" && payload.email.length > 0) {
          return NextResponse.next();
        }
      } catch {
        // Malformed dev cookie: fall through to the standard session check.
      }
    }
  }

  if (!request.auth) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export default middleware;

export const config = {
  matcher: ["/inbox/:path*", "/settings/:path*"]
};
