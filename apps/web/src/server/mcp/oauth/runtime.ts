import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { UserRecord } from "@as-comms/domain";

import { hasAuthorizedGoogleWorkspaceEmail } from "../../auth/google-sign-in-policy";
import { getSettingsRepositories } from "../../stage1-runtime";
import { MCP_READ_SCOPE } from "./core";
import { resolveMcpOAuthMetadataConfig } from "./metadata";

export function getMcpOAuthMetadataConfigFromEnv() {
  return resolveMcpOAuthMetadataConfig(process.env.MCP_PUBLIC_URL ?? "");
}

export function createMcpUnauthorizedResponse(): Response {
  const metadata = getMcpOAuthMetadataConfigFromEnv();

  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadata.protectedResourceMetadataUrl}", scope="${MCP_READ_SCOPE}"`,
      },
    },
  );
}

export function readBearerToken(request: Request): string | null {
  const authorizationHeader = request.headers.get("authorization");
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export async function findAuthorizedMcpUserById(
  userId: string,
): Promise<UserRecord | null> {
  const { users } = await getSettingsRepositories();
  const user = await users.findById(userId);

  // `user?.deactivatedAt === null` is false when the row is missing entirely
  // (undefined !== null), so this covers "no such user" and "deactivated" in
  // one check while narrowing `user` for the email check below.
  const isActiveOperator =
    user?.deactivatedAt === null &&
    hasAuthorizedGoogleWorkspaceEmail(user.email);

  if (!isActiveOperator) {
    return null;
  }

  return user;
}

export function createMcpAuthInfo(input: {
  readonly token: string;
  readonly clientId: string;
  readonly scope: readonly string[];
  readonly resource: string;
  readonly expiresAtSeconds: number;
  readonly user: UserRecord;
}): AuthInfo {
  return {
    token: input.token,
    clientId: input.clientId,
    scopes: [...input.scope],
    expiresAt: input.expiresAtSeconds,
    resource: new URL(input.resource),
    extra: {
      userEmail: input.user.email,
      userId: input.user.id,
      userRole: input.user.role,
    },
  };
}
