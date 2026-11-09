import { NextResponse } from "next/server";

/**
 * Redirect to a page of this app with a relative `Location` header.
 *
 * Never build a redirect target from `request.url` in a route handler: behind
 * Railway's proxy it carries the container's own address
 * (`https://localhost:8080`), so an absolute `Location` built from it sends
 * the browser to a page that can't load. A relative `Location` resolves
 * against the address the browser actually used.
 */
export function redirectToAppPath(
  path: string,
  status: 303 | 307 = 303,
): NextResponse {
  // Only same-app paths: "//host" and "/\host" would be read as another site.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    throw new Error("redirectToAppPath needs a path on this app, such as /u/abc");
  }
  return new NextResponse(null, { status, headers: { Location: path } });
}
