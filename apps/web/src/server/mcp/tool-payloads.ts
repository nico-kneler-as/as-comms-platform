import {
  applyContactPiiPolicy,
  type ContactPiiRecord
} from "./pii-policy"
import {
  applyResponseBudget,
  DEFAULT_MCP_RESPONSE_BUDGET_CAP,
  type BudgetedRows
} from "./response-budget"

export function sanitizeContactRecord<T extends ContactPiiRecord>(
  toolName: string,
  record: T
): Partial<T> {
  return applyContactPiiPolicy(toolName, record)
}

export function budgetRowsWithKnownTotal<T>(
  rows: readonly T[],
  totalAvailable: number,
  cap = DEFAULT_MCP_RESPONSE_BUDGET_CAP
): BudgetedRows<T> {
  const budgetedRows = applyResponseBudget(rows, cap)

  return {
    ...budgetedRows,
    totals: {
      available: totalAvailable,
      returned: budgetedRows.rows.length
    },
    truncated: totalAvailable > budgetedRows.rows.length
  }
}
