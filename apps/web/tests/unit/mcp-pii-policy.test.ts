import { describe, expect, it } from "vitest"

import { applyContactPiiPolicy } from "../../src/server/mcp/pii-policy"

describe("mcp PII policy", () => {
  it("strips fields not present in the tool allowlist", () => {
    const record = {
      id: "contact-1",
      displayName: "Casey Contact",
      primaryEmail: "casey@example.com",
      primaryPhone: "+15555555555",
      salesforceContactId: "003123",
      internalOnly: "secret"
    }

    expect(
      applyContactPiiPolicy("contact_preview", record, {
        contact_preview: ["displayName", "primaryEmail"]
      })
    ).toEqual({
      displayName: "Casey Contact",
      primaryEmail: "casey@example.com"
    })
  })

  it("keeps allowlisted fields intact", () => {
    const record = {
      displayName: "Casey Contact",
      primaryEmail: "casey@example.com"
    }

    expect(
      applyContactPiiPolicy("contact_preview", record, {
        contact_preview: ["displayName", "primaryEmail"]
      })
    ).toEqual(record)
  })

  it("fails closed for unknown tools", () => {
    const record = {
      displayName: "Casey Contact",
      primaryEmail: "casey@example.com",
      primaryPhone: "+15555555555"
    }

    expect(applyContactPiiPolicy("unknown_tool", record)).toEqual({})
  })
})
