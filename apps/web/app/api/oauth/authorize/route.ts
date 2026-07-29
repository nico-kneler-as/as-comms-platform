import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../src/server/auth/session";
import { hasAuthorizedGoogleWorkspaceEmail } from "../../../../src/server/auth/google-sign-in-policy";
import { authorizeMcpClient } from "../../../../src/server/mcp/oauth/core";
import {
  getMcpOAuthMetadataConfigFromEnv,
} from "../../../../src/server/mcp/oauth/runtime";
import { getMcpOAuthRepository } from "../../../../src/server/stage1-runtime";

export const dynamic = "force-dynamic";

function redirectWithQuery(input: {
  readonly redirectUri: string;
  readonly params: Record<string, string>;
}): Response {
  const redirectUrl = new URL(input.redirectUri);

  for (const [key, value] of Object.entries(input.params)) {
    redirectUrl.searchParams.set(key, value);
  }

  return NextResponse.redirect(redirectUrl);
}

function plainTextError(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const currentUser = await getCurrentUser();

  // `currentUser?.deactivatedAt === null` is false when there is no user at
  // all (undefined !== null), so this single check covers "not signed in" and
  // "deactivated" together, and narrows `currentUser` for the email check.
  const isActiveOperator =
    currentUser?.deactivatedAt === null &&
    hasAuthorizedGoogleWorkspaceEmail(currentUser.email);

  if (!isActiveOperator) {
    const signInUrl = new URL("/auth/sign-in", requestUrl.origin);
    signInUrl.searchParams.set(
      "callbackUrl",
      `${requestUrl.pathname}${requestUrl.search}`,
    );
    return NextResponse.redirect(signInUrl);
  }

  const metadata = getMcpOAuthMetadataConfigFromEnv();
  const oauthRepository = await getMcpOAuthRepository();
  const result = await authorizeMcpClient({
    store: oauthRepository,
    clientId: requestUrl.searchParams.get("client_id"),
    redirectUri: requestUrl.searchParams.get("redirect_uri"),
    responseType: requestUrl.searchParams.get("response_type"),
    codeChallenge: requestUrl.searchParams.get("code_challenge"),
    codeChallengeMethod: requestUrl.searchParams.get("code_challenge_method"),
    scope: requestUrl.searchParams.get("scope"),
    resource: requestUrl.searchParams.get("resource"),
    state: requestUrl.searchParams.get("state"),
    userId: currentUser.id,
    now: new Date(),
    expectedResource: metadata.resource,
  });

  if (result.kind === "plain_error") {
    return plainTextError(result.status, result.message);
  }

  if (result.kind === "redirect_error") {
    const params: Record<string, string> = {
      error: result.error,
      error_description: result.errorDescription,
    };
    if (result.state !== null) {
      params.state = result.state;
    }
    return redirectWithQuery({
      redirectUri: result.redirectUri,
      params,
    });
  }

  const params: Record<string, string> = {
    code: result.code,
  };
  if (result.state !== null) {
    params.state = result.state;
  }

  return redirectWithQuery({
    redirectUri: result.redirectUri,
    params,
  });
}
