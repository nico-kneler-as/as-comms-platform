import { NextResponse, type NextRequest } from "next/server";

import { handlers } from "../../../../src/server/auth";
import {
  enforceRateLimit,
  getClientIp,
} from "../../../../src/server/security/rate-limit";

// The Auth.js v5 callback endpoints must not be pre-rendered — they need to
// read cookies + set-cookie on every request.
export const dynamic = "force-dynamic";

async function rateLimitAuthRequest(
  request: NextRequest,
): Promise<NextResponse | null> {
  const clientIp = getClientIp(request);
  const decision = await enforceRateLimit({
    scope: "route:/api/auth",
    identifier: clientIp,
    limit: 10,
    audit: {
      actorType: "system",
      actorId: clientIp,
      action: "auth.request.rate_limited",
      entityType: "route",
      entityId: request.nextUrl.pathname,
      metadataJson: {
        method: request.method,
      },
    },
  });

  if (decision.allowed) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      code: "rate_limit_exceeded",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
      },
    },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const limitedResponse = await rateLimitAuthRequest(request);
  if (limitedResponse !== null) {
    return limitedResponse;
  }

  return handlers.GET(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const limitedResponse = await rateLimitAuthRequest(request);
  if (limitedResponse !== null) {
    return limitedResponse;
  }

  return handlers.POST(request);
}
