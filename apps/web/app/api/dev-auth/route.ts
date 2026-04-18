import { NextResponse, type NextRequest } from "next/server";

import { getSettingsRepositories } from "../../../src/server/stage1-runtime";

// Dev-only cookie seeder. The production guard MUST be the first thing in
// the handler — `scripts/verify-stage0.mjs` inspects this file statically
// to ensure the `NODE_ENV === "production"` check and a 404 are present.
// Do not hoist logic above the guard.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json(
      { ok: false, code: "validation_error", message: "email is required" },
      { status: 400 }
    );
  }

  const { users } = await getSettingsRepositories();
  const user = await users.findByEmail(email);

  if (!user || user.deactivatedAt) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "user not found or deactivated" },
      { status: 404 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    email: user.email,
    role: user.role
  });
  response.cookies.set(
    "dev-session",
    JSON.stringify({ email: user.email, role: user.role }),
    {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 60 * 60
    }
  );
  return response;
}
