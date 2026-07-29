import { timingSafeEqual } from "node:crypto"

import { createMcpHandler } from "mcp-handler"
import { NextResponse } from "next/server"

import {
  DEFAULT_MCP_ENVIRONMENT_NAME,
  MCP_CONNECTOR_VERSION,
  MCP_SERVER_NAME,
  registerConnectorTools
} from "../../../src/server/mcp/index"

export const dynamic = "force-dynamic"

function isAuthorized(request: Request): boolean {
  const expectedToken = process.env.MCP_DEV_TOKEN

  // Brick 1 stopgap only. Brick 2 replaces this with OAuth, and this bearer
  // token guard must not ship to the team as the final auth model.
  if (!expectedToken || expectedToken.trim().length === 0) {
    return false
  }

  const received = request.headers.get("authorization") ?? ""
  const expectedHeader = `Bearer ${expectedToken}`
  const receivedBuffer = Buffer.from(received, "utf8")
  const expectedBuffer = Buffer.from(expectedHeader, "utf8")
  // Compare BYTE lengths, not string lengths. `timingSafeEqual` throws a
  // RangeError on a byte-length mismatch, and a multi-byte header can match
  // on `String.length` while differing in bytes (e.g. "Bearer abcñ23" vs
  // "Bearer abc123") — which would surface as an unhandled 500 instead of a
  // 401. Short-circuiting here keeps equal-length comparisons constant time.
  if (receivedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer)
}

function resolveEnvironmentName(): string {
  // Railway is the deploy target for every app in this repo; the capture
  // services read `RAILWAY_*` for the same purpose. There is no Vercel
  // deployment, so no `VERCEL_ENV` fallback.
  const railwayEnvironment = process.env.RAILWAY_ENVIRONMENT

  if (railwayEnvironment && railwayEnvironment.trim().length > 0) {
    return railwayEnvironment
  }

  const nodeEnvironment = process.env.NODE_ENV

  if (nodeEnvironment.trim().length > 0) {
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
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, code: "unauthorized" },
      { status: 401 }
    )
  }

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
