import {
  MCP_READ_SCOPE,
  OFFLINE_ACCESS_SCOPE,
  PKCE_CHALLENGE_METHOD,
} from "./core";

export interface McpOAuthMetadataConfig {
  readonly issuer: string;
  readonly resource: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly protectedResourceMetadataUrl: string;
  readonly authorizationServerMetadataUrl: string;
}

export function resolveMcpOAuthMetadataConfig(
  mcpPublicUrl: string,
): McpOAuthMetadataConfig {
  const resource = mcpPublicUrl.trim();
  if (resource.length === 0) {
    throw new Error("MCP_PUBLIC_URL must be set.");
  }

  const resourceUrl = new URL(resource);
  const issuer = resourceUrl.origin;

  return {
    issuer,
    resource,
    // Under `/api/` like every other machine endpoint in this app, and out of
    // the page-route namespace. These URLs get baked into Claude's stored
    // connector config once an Owner registers it, so they should not move
    // after that point.
    authorizationEndpoint: new URL("/api/oauth/authorize", issuer).toString(),
    tokenEndpoint: new URL("/api/oauth/token", issuer).toString(),
    protectedResourceMetadataUrl: new URL(
      "/.well-known/oauth-protected-resource",
      issuer,
    ).toString(),
    authorizationServerMetadataUrl: new URL(
      "/.well-known/oauth-authorization-server",
      issuer,
    ).toString(),
  };
}

export function createProtectedResourceMetadata(
  config: McpOAuthMetadataConfig,
): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [MCP_READ_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

export function createAuthorizationServerMetadata(
  config: McpOAuthMetadataConfig,
): Record<string, unknown> {
  return {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: [PKCE_CHALLENGE_METHOD],
    scopes_supported: [MCP_READ_SCOPE, OFFLINE_ACCESS_SCOPE],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
  };
}
