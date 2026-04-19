import { NextResponse } from "next/server";

import type { UserRecord } from "@as-comms/domain";

import { requireSession } from "./session";

export async function requireApiSession(): Promise<
  | {
      readonly ok: true;
      readonly user: UserRecord;
    }
  | {
      readonly ok: false;
      readonly response: NextResponse;
    }
> {
  try {
    return {
      ok: true,
      user: await requireSession(),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            code: "unauthorized",
          },
          {
            status: 401,
          },
        ),
      };
    }

    throw error;
  }
}
