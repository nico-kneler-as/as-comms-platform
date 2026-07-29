import { createAuthorizationServerMetadata } from "../../../src/server/mcp/oauth/metadata";
import { getMcpOAuthMetadataConfigFromEnv } from "../../../src/server/mcp/oauth/runtime";

export const dynamic = "force-dynamic";

function jsonHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "max-age=3600",
    "Content-Type": "application/json",
  };
}

export function GET() {
  const metadata = getMcpOAuthMetadataConfigFromEnv();

  return Response.json(createAuthorizationServerMetadata(metadata), {
    headers: jsonHeaders(),
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: jsonHeaders(),
  });
}
