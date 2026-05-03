import { describe, expect, it } from "vitest"

import { readMailchimpCaptureRuntimeConfig } from "../src/index.js"

describe("Mailchimp capture runtime config", () => {
  it("requires the Mailchimp shell env for service boot", () => {
    const config = readMailchimpCaptureRuntimeConfig({
      PORT: "3013",
      HOST: "127.0.0.1",
      LOG_LEVEL: "debug",
      MAILCHIMP_CAPTURE_BEARER_TOKEN: "mailchimp-token",
      MAILCHIMP_API_KEY: "api-key-us21",
    })

    expect(config.host).toBe("127.0.0.1")
    expect(config.port).toBe(3013)
    expect(config.logLevel).toBe("debug")
    expect(config.service.salesforceContactIdMergeField).toBe("SFCONTACTID")
    expect(config.service.volunteerIdMergeField).toBe("VOLUNTID")
    expect(config.service.timeoutMs).toBe(30_000)
  })

  it("fails closed when required Mailchimp env is missing", () => {
    expect(() =>
      readMailchimpCaptureRuntimeConfig({
        PORT: "3013",
        MAILCHIMP_CAPTURE_BEARER_TOKEN: "mailchimp-token",
      }),
    ).toThrow("MAILCHIMP_API_KEY is required.")
  })
})
