import { NextResponse, type NextRequest } from "next/server";

/**
 * Route protection for `/inbox/:path*` and `/settings/:path*`.
 *
 * Dev bypass order (non-production only):
 *   1. `x-dev-operator` header short-circuits auth.
 *   2. `dev-session` cookie short-circuits auth.
 *
 * Production: gate on Auth.js session cookie *presence only*. We
 * deliberately do NOT decode the cookie here. Decode is authoritative
 * in Server Components / Server Actions via `auth()` from
 * `./src/server/auth/index.ts`; middleware's job is to be the cheap
 * first filter. Doing decode in middleware creates two failure modes
 * we saw in prod:
 *   1. Edge Runtime import chain — even with the edge-only config,
 *      wiring Auth.js into middleware pulls in extra JOSE/crypto
 *      code and is fragile across Auth.js upgrades.
 *   2. Stale cookies from a previous session strategy (e.g., switching
 *      from `database` to `jwt`) throw `Invalid Compact JWE` on every
 *      request until the user clears cookies — the redirect itself
 *      never runs because the wrapper throws before it.
 *
 * Cookie-presence-only middleware avoids both. A forged cookie gets
 * past middleware but fails authoritative validation on the route, so
 * the user sees a normal sign-in redirect rather than a 500 page.
 */

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token"
];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some(
    (name) => (request.cookies.get(name)?.value ?? "").length > 0
  );
}

function tryDevBypass(request: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  if (request.headers.get("x-dev-operator")) {
    return true;
  }

  const devSessionCookie = request.cookies.get("dev-session");
  if (!devSessionCookie?.value) {
    return false;
  }

  try {
    const payload = JSON.parse(devSessionCookie.value) as {
      readonly email?: unknown;
    };
    return typeof payload.email === "string" && payload.email.length > 0;
  } catch {
    return false;
  }
}

export default function middleware(request: NextRequest): NextResponse {
  if (tryDevBypass(request)) {
    return NextResponse.next();
  }

  if (hasSessionCookie(request)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/auth/sign-in", request.url));
}

export const config = {
  matcher: ["/inbox/:path*", "/settings/:path*"]
};
