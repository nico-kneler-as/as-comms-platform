import type { McpToolExecutionContext } from "./tool-registry"

export interface McpResolvedOperator {
  userId: string
  userEmail: string
  userRole: string
  isAdmin: boolean
}

export function requireAuthenticatedOperator(
  context: McpToolExecutionContext
): McpResolvedOperator {
  const operator = context.authenticatedUser

  if (operator === null) {
    throw new Error("Authenticated operator required.")
  }

  return {
    userId: operator.userId,
    userEmail: operator.userEmail,
    userRole: operator.userRole,
    isAdmin: operator.userRole === "admin"
  }
}
