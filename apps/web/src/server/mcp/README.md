# MCP connector

The MCP transport at `/api/mcp` now authenticates operators through our own OAuth 2.1 authorization server.

## Required env

- `MCP_PUBLIC_URL`
  Use the exact public MCP resource URL, including `/api/mcp`.
  Example: `https://as-comms.example.com/api/mcp`

`MCP_PUBLIC_URL` drives:

- the protected resource metadata `resource` field
- the `WWW-Authenticate` `resource_metadata` URL
- the expected RFC 8707 `resource` value on issued tokens

Do not reconstruct this URL from request headers.

## Endpoints

- MCP resource: `/api/mcp`
- Protected resource metadata: `/.well-known/oauth-protected-resource`
- Authorization server metadata: `/.well-known/oauth-authorization-server`
- Authorization endpoint: `/authorize`
- Token endpoint: `/token`

## Flow

1. Claude discovers the MCP resource and receives `401` with:
   `WWW-Authenticate: Bearer resource_metadata="<absolute metadata URL>", scope="mcp:read"`
2. Claude reads the protected resource metadata and the authorization server metadata.
3. Claude sends the operator to `/authorize` with `response_type=code`, PKCE `S256`, `mcp:read`, and `resource=<MCP_PUBLIC_URL>`.
4. `/authorize` reuses the existing Auth.js session. If there is no session, it redirects to `/auth/sign-in` and returns to the original authorize URL after Google sign-in.
5. `/token` accepts `application/x-www-form-urlencoded` exchanges for `authorization_code` and `refresh_token`.
6. `/api/mcp` accepts bearer access tokens only. `MCP_DEV_TOKEN` is gone; there is no fallback path.

## Client provisioning

Mint a connector client with:

```bash
pnpm ops:mcp-create-oauth-client -- --name "Claude MCP connector"
```

The script prints the plaintext `client_id` and `client_secret` once, stores only the SHA-256 hash of the secret, and pre-registers:

- `https://claude.ai/api/mcp/auth_callback`
- `http://localhost/callback`
- `http://127.0.0.1/callback`

## Local testing

For Claude.ai, use a real public deployment URL for `MCP_PUBLIC_URL`; the metadata `resource` must match what the owner types into Claude exactly.

For Claude Code loopback testing:

1. Run the web app with `MCP_PUBLIC_URL=http://localhost:3000/api/mcp`.
2. Mint a client with `pnpm ops:mcp-create-oauth-client`.
3. Configure the connector with:
   - resource URL: `http://localhost:3000/api/mcp`
   - client ID: the printed `client_id`
   - client secret: the printed `client_secret`
4. When Claude Code opens the browser, sign in with an active `@adventurescientists.org` Google account.
5. Confirm the token exchange succeeds and `/api/mcp` answers authenticated `initialize`, `tools/list`, and `tools/call`.

Claude Code uses loopback redirect URIs of the form `http://localhost:<ephemeral-port>/callback` and `http://127.0.0.1:<ephemeral-port>/callback`; the auth server accepts those port-agnostically.
