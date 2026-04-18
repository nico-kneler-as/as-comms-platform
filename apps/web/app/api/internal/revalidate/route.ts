import { NextResponse } from "next/server";
import { z } from "zod";

import { revalidateInboxViews } from "../../../../src/server/inbox/revalidate";

export const dynamic = "force-dynamic";

const revalidateRequestSchema = z.object({
  contactIds: z.array(z.string().min(1)).default([])
});

function isAuthorized(request: Request): boolean {
  const expectedToken = process.env.INBOX_REVALIDATE_TOKEN;

  if (!expectedToken || expectedToken.trim().length === 0) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        code: "unauthorized"
      },
      {
        status: 401
      }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = revalidateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "validation_error"
      },
      {
        status: 400
      }
    );
  }

  const result = revalidateInboxViews({
    contactIds: parsed.data.contactIds
  });

  return NextResponse.json({
    ok: true,
    contactIds: result.contactIds
  });
}
