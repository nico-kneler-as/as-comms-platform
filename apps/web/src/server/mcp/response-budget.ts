export const DEFAULT_MCP_RESPONSE_BUDGET_CAP = 25

export interface ResponseBudgetTotals {
  available: number
  returned: number
}

export interface BudgetedRows<T> {
  rows: T[]
  totals: ResponseBudgetTotals
  truncated: boolean
  cap: number
}

function normalizeCap(cap: number): number {
  if (!Number.isFinite(cap)) {
    return DEFAULT_MCP_RESPONSE_BUDGET_CAP
  }

  return Math.max(0, Math.trunc(cap))
}

export function applyResponseBudget<T>(
  rows: readonly T[],
  cap = DEFAULT_MCP_RESPONSE_BUDGET_CAP
): BudgetedRows<T> {
  const normalizedCap = normalizeCap(cap)
  const available = rows.length
  const truncated = available > normalizedCap
  const budgetedRows = rows.slice(0, normalizedCap)

  return {
    rows: budgetedRows,
    totals: {
      available,
      returned: budgetedRows.length
    },
    truncated,
    cap: normalizedCap
  }
}
