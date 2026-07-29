import {
  createTokenResponseBody,
  exchangeMcpAuthorizationCode,
  parseTokenEndpointClientCredentials,
  refreshMcpAccessToken,
} from "../../src/server/mcp/oauth/core";
import {
  findAuthorizedMcpUserById,
  getMcpOAuthMetadataConfigFromEnv,
} from "../../src/server/mcp/oauth/runtime";
import { getMcpOAuthRepository } from "../../src/server/stage1-runtime";

export const dynamic = "force-dynamic";

function hasResolvedClientCredentials(
  value:
    | {
        readonly clientId: string | null;
        readonly clientSecret: string | null;
      }
    | {
        readonly kind: "error";
      },
): value is {
  readonly clientId: string | null;
  readonly clientSecret: string | null;
} {
  return !("kind" in value);
}

function tokenHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Pragma: "no-cache",
  };
}

function tokenErrorResponse(input: {
  readonly error: string;
  readonly errorDescription: string;
  readonly status: number;
}): Response {
  return Response.json(
    {
      error: input.error,
      error_description: input.errorDescription,
    },
    {
      status: input.status,
      headers: tokenHeaders(),
    },
  );
}

async function parseFormBody(request: Request): Promise<URLSearchParams | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return null;
  }

  const body = await request.text();
  return new URLSearchParams(body);
}

export async function POST(request: Request) {
  const form = await parseFormBody(request);
  if (form === null) {
    return tokenErrorResponse({
      error: "invalid_request",
      errorDescription:
        "The token endpoint requires application/x-www-form-urlencoded.",
      status: 400,
    });
  }

  const metadata = getMcpOAuthMetadataConfigFromEnv();
  const oauthRepository = await getMcpOAuthRepository();
  const clientCredentials = parseTokenEndpointClientCredentials({
    authorizationHeader: request.headers.get("authorization"),
    bodyClientId: form.get("client_id"),
    bodyClientSecret: form.get("client_secret"),
  });

  if ("kind" in clientCredentials && clientCredentials.kind === "error") {
    return tokenErrorResponse({
      error: clientCredentials.error,
      errorDescription: clientCredentials.errorDescription,
      status: clientCredentials.status,
    });
  }

  if (!hasResolvedClientCredentials(clientCredentials)) {
    return tokenErrorResponse({
      error: "invalid_client",
      errorDescription: "The client is invalid.",
      status: 401,
    });
  }

  const { clientId, clientSecret } = clientCredentials;

  const isUserAuthorized = async (userId: string): Promise<boolean> =>
    (await findAuthorizedMcpUserById(userId)) !== null;

  const now = new Date();
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const result = await exchangeMcpAuthorizationCode({
      store: oauthRepository,
      clientId,
      clientSecret,
      code: form.get("code"),
      codeVerifier: form.get("code_verifier"),
      redirectUri: form.get("redirect_uri"),
      resource: form.get("resource"),
      now,
      expectedResource: metadata.resource,
      isUserAuthorized,
    });

    if (result.kind === "error") {
      return tokenErrorResponse({
        error: result.error,
        errorDescription: result.errorDescription,
        status: result.status,
      });
    }

    return Response.json(createTokenResponseBody(result), {
      headers: tokenHeaders(),
    });
  }

  if (grantType === "refresh_token") {
    const result = await refreshMcpAccessToken({
      store: oauthRepository,
      clientId,
      clientSecret,
      refreshToken: form.get("refresh_token"),
      resource: form.get("resource"),
      now,
      expectedResource: metadata.resource,
      isUserAuthorized,
    });

    if (result.kind === "error") {
      return tokenErrorResponse({
        error: result.error,
        errorDescription: result.errorDescription,
        status: result.status,
      });
    }

    return Response.json(createTokenResponseBody(result), {
      headers: tokenHeaders(),
    });
  }

  return tokenErrorResponse({
    error: "unsupported_grant_type",
    errorDescription: "The grant_type is not supported.",
    status: 400,
  });
}
