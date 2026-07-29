import { describe, expect, it } from "vitest"

import {
  applyResponseBudget,
  DEFAULT_MCP_RESPONSE_BUDGET_CAP
} from "../../src/server/mcp/response-budget"

describe("mcp response budget", () => {
  it("passes through rows under the cap with truncated false", () => {
    const rows = [{ id: "a" }, { id: "b" }]

    expect(applyResponseBudget(rows, 5)).toEqual({
      rows,
      totals: {
        available: 2,
        returned: 2
      },
      truncated: false,
      cap: 5
    })
  })

  it("caps rows while preserving pre-truncation totals", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }]

    expect(applyResponseBudget(rows, 2)).toEqual({
      rows: [{ id: "a" }, { id: "b" }],
      totals: {
        available: 3,
        returned: 2
      },
      truncated: true,
      cap: 2
    })
  })

  it("handles empty input", () => {
    expect(applyResponseBudget([], DEFAULT_MCP_RESPONSE_BUDGET_CAP)).toEqual({
      rows: [],
      totals: {
        available: 0,
        returned: 0
      },
      truncated: false,
      cap: DEFAULT_MCP_RESPONSE_BUDGET_CAP
    })
  })

  it("preserves ordering across repeated calls", () => {
    const rows = [
      { id: "first" },
      { id: "second" },
      { id: "third" }
    ]

    const firstPass = applyResponseBudget(rows, 2)
    const secondPass = applyResponseBudget(rows, 2)

    expect(firstPass.rows).toEqual([{ id: "first" }, { id: "second" }])
    expect(secondPass.rows).toEqual([{ id: "first" }, { id: "second" }])
    expect(rows).toEqual([
      { id: "first" },
      { id: "second" },
      { id: "third" }
    ])
  })
})
