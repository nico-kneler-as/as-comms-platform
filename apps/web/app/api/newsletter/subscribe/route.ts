import { randomUUID } from "node:crypto";

import {
  newsletterSignupErrorSchema,
  newsletterSignupRequestSchema,
  newsletterSignupSuccessSchema,
} from "@as-comms/contracts";
import { createPostmarkClient } from "@as-comms/integrations";

import { createDirectNewsletterUnsubscribeToken } from "@/app/u/[token]/_lib/unsubscribe";
import { readWebEnv } from "@/src/server/env";
import {
  getClientIp,
  enforceRateLimit,
} from "@/src/server/security/rate-limit";
import {
  getStage1WebRuntime,
  listEnabledOrgSenders,
} from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

const NEWSLETTER_SIGNUP_ROUTE = "/api/newsletter/subscribe";
const NEWSLETTER_SIGNUP_RATE_LIMIT = 5;
const NEWSLETTER_SIGNUP_RATE_LIMIT_WINDOW_MS = 60_000;

function newRequestId(): string {
  return randomUUID();
}

function buildCorsHeaders(input: {
  readonly requestOrigin: string | null;
  readonly allowedOrigin: string;
}): Headers {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  });

  if (input.requestOrigin === input.allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", input.allowedOrigin);
  }

  return headers;
}

function jsonResponse(
  body: unknown,
  input: {
    readonly status: number;
    readonly requestOrigin: string | null;
    readonly allowedOrigin: string;
    readonly extraHeaders?: HeadersInit;
  },
): Response {
  const headers = buildCorsHeaders(input);

  if (input.extraHeaders !== undefined) {
    const extra = new Headers(input.extraHeaders);
    for (const [key, value] of extra.entries()) {
      headers.set(key, value);
    }
  }

  return Response.json(body, {
    status: input.status,
    headers,
  });
}

function successResponse(input: {
  readonly requestId: string;
  readonly requestOrigin: string | null;
  readonly allowedOrigin: string;
}): Response {
  return jsonResponse(
    newsletterSignupSuccessSchema.parse({
      ok: true,
      requestId: input.requestId,
    }),
    {
      status: 200,
      requestOrigin: input.requestOrigin,
      allowedOrigin: input.allowedOrigin,
    },
  );
}

function errorResponse(input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly requestOrigin: string | null;
  readonly allowedOrigin: string;
  readonly extraHeaders?: HeadersInit;
}): Response {
  const responseInput: {
    readonly status: number;
    readonly requestOrigin: string | null;
    readonly allowedOrigin: string;
    readonly extraHeaders?: HeadersInit;
  } = {
    status: input.status,
    requestOrigin: input.requestOrigin,
    allowedOrigin: input.allowedOrigin,
  };
  if (input.extraHeaders !== undefined) {
    Object.assign(responseInput, {
      extraHeaders: input.extraHeaders,
    });
  }

  return jsonResponse(
    newsletterSignupErrorSchema.parse({
      ok: false,
      code: input.code,
      message: input.message,
      requestId: input.requestId,
    }),
    responseInput,
  );
}

function formatSenderHeader(input: {
  readonly email: string;
  readonly label: string;
}): string {
  const label = input.label.trim();
  return label.length === 0 ? input.email : `${label} <${input.email}>`;
}

function buildPostmarkClientFromEnv() {
  const env = readWebEnv();

  if (!env.POSTMARK_SERVER_TOKEN || !env.POSTMARK_ACCOUNT_TOKEN) {
    return null;
  }

  return createPostmarkClient({
    serverToken: env.POSTMARK_SERVER_TOKEN,
    accountToken: env.POSTMARK_ACCOUNT_TOKEN,
    webhookSigningSecret: env.POSTMARK_WEBHOOK_SIGNING_SECRET ?? "unused",
    baseUrl: env.POSTMARK_BASE_URL,
  });
}

async function sendWelcomeEmail(input: {
  readonly request: Request;
  readonly subscriber: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
  };
}): Promise<void> {
  const client = buildPostmarkClientFromEnv();
  if (client === null) {
    throw new Error(
      "Postmark is not configured for transactional newsletter welcome sends.",
    );
  }

  const sender = (await listEnabledOrgSenders())[0];
  if (sender === undefined) {
    throw new Error(
      "No enabled org sender is configured for newsletter welcome sends.",
    );
  }

  const env = readWebEnv();
  const unsubscribeToken = createDirectNewsletterUnsubscribeToken(
    input.subscriber.id,
  );
  const unsubscribeUrl = new URL(
    `/u/${encodeURIComponent(unsubscribeToken)}`,
    input.request.url,
  ).toString();
  const greeting =
    input.subscriber.firstName === null
      ? "Hi there,"
      : `Hi ${input.subscriber.firstName},`;
  const htmlBody = [
    "<html>",
    "  <body style=\"margin:0;padding:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif;\">",
    "    <div style=\"max-width:640px;margin:0 auto;padding:32px 20px;\">",
    "      <div style=\"background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:32px;\">",
    `        <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;\">${greeting}</p>`,
    "        <h1 style=\"margin:0 0 16px;font-size:28px;line-height:1.2;\">Welcome to the Adventure Scientists newsletter.</h1>",
    "        <p style=\"margin:0 0 16px;font-size:16px;line-height:1.6;\">You're subscribed and we'll send updates about fieldwork, impact, and ways to stay involved.</p>",
    "        <p style=\"margin:0 0 24px;font-size:16px;line-height:1.6;\">If this inbox isn't the right fit, you can unsubscribe at any time.</p>",
    `        <p style=\"margin:0 0 24px;\"><a href=\"${unsubscribeUrl}\" style=\"display:inline-block;background:#253746;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:600;\">Unsubscribe from this newsletter</a></p>`,
    `        <p style=\"margin:0;font-size:14px;line-height:1.6;color:#475569;\">Or use this link: <a href=\"${unsubscribeUrl}\" style=\"color:#253746;\">${unsubscribeUrl}</a></p>`,
    "      </div>",
    "    </div>",
    "  </body>",
    "</html>",
  ].join("\n");
  const textBody = [
    greeting,
    "",
    "Welcome to the Adventure Scientists newsletter.",
    "",
    "You're subscribed and we'll send updates about fieldwork, impact, and ways to stay involved.",
    "",
    `Unsubscribe at any time: ${unsubscribeUrl}`,
  ].join("\n");

  await client.sendBatch({
    messages: [
      {
        From: formatSenderHeader({
          email: sender.email,
          label: sender.label,
        }),
        To: input.subscriber.email,
        Subject: "Welcome to the Adventure Scientists newsletter",
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: env.POSTMARK_TRANSACTIONAL_STREAM_ID,
        Headers: [
          {
            Name: "List-Unsubscribe",
            Value: `<${unsubscribeUrl}>`,
          },
        ],
        Metadata: {
          category: "newsletter_welcome",
          recipient: input.subscriber.email,
        },
      },
    ],
  });
}

export function OPTIONS(request: Request): Response {
  const env = readWebEnv();
  const requestOrigin = request.headers.get("origin");

  if (requestOrigin !== env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN) {
    return new Response(null, {
      status: 403,
      headers: buildCorsHeaders({
        requestOrigin,
        allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
      }),
    });
  }

  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders({
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    }),
  });
}

export async function POST(request: Request): Promise<Response> {
  const env = readWebEnv();
  const requestId = newRequestId();
  const requestOrigin = request.headers.get("origin");

  if (
    requestOrigin !== null &&
    requestOrigin !== env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN
  ) {
    return errorResponse({
      status: 403,
      code: "origin_not_allowed",
      message: "This origin is not allowed to subscribe.",
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    });
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return errorResponse({
      status: 400,
      code: "malformed_json",
      message: "Request body must be valid JSON.",
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    });
  }

  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return errorResponse({
      status: 400,
      code: "invalid_request",
      message: "Request body must be a JSON object.",
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    });
  }

  const requestBody = rawBody as Record<string, unknown>;
  const website =
    typeof requestBody.website === "string" ? requestBody.website.trim() : "";
  if (website.length > 0) {
    return errorResponse({
      status: 400,
      code: "bot_detected",
      message: "Unable to process this subscription request.",
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    });
  }

  const clientIp = getClientIp(request);
  const rateLimit = await enforceRateLimit({
    scope: "newsletter.subscribe",
    identifier: clientIp,
    limit: NEWSLETTER_SIGNUP_RATE_LIMIT,
    windowMs: NEWSLETTER_SIGNUP_RATE_LIMIT_WINDOW_MS,
    audit: {
      actorType: "system",
      actorId: clientIp,
      action: "newsletter_signup.request.rate_limited",
      entityType: "route",
      entityId: NEWSLETTER_SIGNUP_ROUTE,
      metadataJson: {
        requestId,
      },
    },
  });

  if (!rateLimit.allowed) {
    return errorResponse({
      status: 429,
      code: "rate_limit_exceeded",
      message: "Too many signup attempts. Please try again shortly.",
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
      extraHeaders: {
        "Retry-After": String(rateLimit.retryAfterSeconds),
      },
    });
  }

  const parsed = newsletterSignupRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse({
      status: 400,
      code: "invalid_request",
      message: "Enter a valid email address.",
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    });
  }

  try {
    const runtime = await getStage1WebRuntime();
    const result = await runtime.campaigns.newsletterSubscribers.signUp({
      email: parsed.data.email,
      firstName: parsed.data.firstName ?? null,
      lastName: parsed.data.lastName ?? null,
      optinTime: new Date().toISOString(),
      optinIp: clientIp,
      source: "website_signup",
    });

    if (result.disposition === "created") {
      try {
        await sendWelcomeEmail({
          request,
          subscriber: {
            id: result.subscriber.id,
            email: result.subscriber.email,
            firstName: result.subscriber.firstName,
          },
        });
      } catch (error) {
        console.error("Newsletter welcome email failed.", {
          requestId,
          email: result.subscriber.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return successResponse({
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    });
  } catch (error) {
    console.error("Newsletter signup failed.", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse({
      status: 500,
      code: "internal_error",
      message: "Unable to subscribe right now.",
      requestId,
      requestOrigin,
      allowedOrigin: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    });
  }
}
