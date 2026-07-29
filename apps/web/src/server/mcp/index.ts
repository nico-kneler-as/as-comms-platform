import { createGetConnectorInfoTool } from "./tools/get-connector-info"
import { createGetContactSummaryTool } from "./tools/get-contact-summary"
import { createGetContactTimelineTool } from "./tools/get-contact-timeline"
import { createGetInboxQueueTool } from "./tools/get-inbox-queue"
import { createGetSyncFreshnessTool } from "./tools/get-sync-freshness"
import { createGetWorkloadSummaryTool } from "./tools/get-workload-summary"
import { createSearchContactsTool } from "./tools/search-contacts"
import type { McpToolEntry, McpToolRegistrar } from "./tool-registry"
import { createMcpToolRegistry } from "./tool-registry"

export {
  DEFAULT_MCP_ENVIRONMENT_NAME,
  MCP_CONNECTOR_VERSION,
  MCP_SERVER_NAME
} from "./constants"
export {
  DEFAULT_MCP_RESPONSE_BUDGET_CAP,
  applyResponseBudget,
  type BudgetedRows,
  type ResponseBudgetTotals
} from "./response-budget"
export {
  CONTACT_PII_FIELDS,
  MCP_TOOL_CONTACT_PII_ALLOWLISTS,
  applyContactPiiPolicy,
  type ContactPiiAllowlistMap,
  type ContactPiiField,
  type ContactPiiRecord
} from "./pii-policy"
export {
  createMcpToolRegistry,
  type McpToolEntry,
  type McpToolInputSchema,
  type McpToolPayload,
  type McpToolRegistrar,
  type McpToolRegistry
} from "./tool-registry"

export interface ConnectorToolContext {
  environmentName: string
}

function createConnectorTools(
  context: ConnectorToolContext
): readonly McpToolEntry[] {
  const tools: McpToolEntry[] = []

  tools.push(
    createGetConnectorInfoTool({
      environmentName: context.environmentName,
      getRegisteredToolCount: () => tools.length
    })
  )
  tools.push(createSearchContactsTool())
  tools.push(createGetContactSummaryTool())
  tools.push(createGetContactTimelineTool())
  tools.push(createGetInboxQueueTool())
  tools.push(createGetWorkloadSummaryTool())
  tools.push(createGetSyncFreshnessTool())

  return tools
}

export function registerConnectorTools(
  server: McpToolRegistrar,
  context: ConnectorToolContext
): number {
  const registry = createMcpToolRegistry(createConnectorTools(context))
  registry.registerOn(server)
  return registry.count
}
