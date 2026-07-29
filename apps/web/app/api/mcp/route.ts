import { createMcpHandler } from "mcp-handler"

import {
  DEFAULT_MCP_ENVIRONMENT_NAME,
  MCP_CONNECTOR_VERSION,
  MCP_SERVER_NAME,
  registerConnectorTools
} from "../../../src/server/mcp/index"
import { getMcpOAuthRepository } from "../../../src/server/stage1-runtime"
import { validateMcpAccessToken } from "../../../src/server/mcp/oauth/core"
import {
  createMcpAuthInfo,
  createMcpUnauthorizedResponse,
  findAuthorizedMcpUserById,
  getMcpOAuthMetadataConfigFromEnv,
  readBearerToken
} from "../../../src/server/mcp/oauth/runtime"

export const dynamic = "force-dynamic"

function resolveEnvironmentName(): string {
  const railwayEnvironment = process.env.RAILWAY_ENVIRONMENT

  if (railwayEnvironment && railwayEnvironment.trim().length > 0) {
    return railwayEnvironment
  }

  const nodeEnvironment = process.env.NODE_ENV

  if (nodeEnvironment && nodeEnvironment.trim().length > 0) {
    return nodeEnvironment
  }

  return DEFAULT_MCP_ENVIRONMENT_NAME
}

const mcpHandler = createMcpHandler(
  (server) => {
    registerConnectorTools(server, {
      environmentName: resolveEnvironmentName()
    })
  },
  {
    serverInfo: {
      name: MCP_SERVER_NAME,
      version: MCP_CONNECTOR_VERSION
    }
  },
  {
    basePath: "/api",
    disableSse: true
  }
)

async function handleMcpRequest(request: Request): Promise<Response> {
  const accessToken = readBearerToken(request)
  if (accessToken === null) {
    return createMcpUnauthorizedResponse()
  }

  const metadata = getMcpOAuthMetadataConfigFromEnv()
  const oauthRepository = await getMcpOAuthRepository()
  const validation = await validateMcpAccessToken({
    store: oauthRepository,
    accessToken,
    expectedResource: metadata.resource,
    now: new Date()
  })

  if (validation.kind === "error") {
    return createMcpUnauthorizedResponse()
  }

  const user = await findAuthorizedMcpUserById(validation.token.userId)
  if (user === null) {
    await oauthRepository.revokeAllTokensForUser(validation.token.userId, new Date())
    return createMcpUnauthorizedResponse()
  }

  request.auth = createMcpAuthInfo({
    token: accessToken,
    clientId: validation.token.clientId,
    scope: validation.scopes,
    resource: validation.token.resource,
    expiresAtSeconds: Math.floor(
      new Date(validation.token.accessExpiresAt).getTime() / 1000
    ),
    user
  })

  return mcpHandler(request)
}

export async function GET(request: Request) {
  return handleMcpRequest(request)
}

export async function POST(request: Request) {
  return handleMcpRequest(request)
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request)
}
