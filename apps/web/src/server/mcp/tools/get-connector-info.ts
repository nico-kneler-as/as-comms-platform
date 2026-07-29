import { z } from "zod"

import { MCP_CONNECTOR_VERSION } from "../constants"
import type { McpToolEntry } from "../tool-registry"

const getConnectorInfoInputSchema = z.object({}).strict()

export interface GetConnectorInfoToolOptions {
  environmentName: string
  getRegisteredToolCount: () => number
}

export function createGetConnectorInfoTool(
  options: GetConnectorInfoToolOptions
): McpToolEntry {
  const { environmentName, getRegisteredToolCount } = options

  return {
    name: "get_connector_info",
    title: "Get Connector Info",
    description:
      "Return static AS Comms connector metadata for transport smoke testing.",
    inputSchema: getConnectorInfoInputSchema,
    handler: () => ({
      connectorVersion: MCP_CONNECTOR_VERSION,
      registeredToolCount: getRegisteredToolCount(),
      environmentName
    })
  }
}
