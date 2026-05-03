import { describe, expect, it } from "vitest"

import {
  handleMailchimpCaptureHttpRequest,
  readMailchimpCaptureRuntimeConfig,
} from "../src/index.js"

function createConfig() {
  return readMailchimpCaptureRuntimeConfig({
    HOST: "127.0.0.1",
    PORT: "3003",
    MAILCHIMP_CAPTURE_BEARER_TOKEN: "mailchimp-token",
    MAILCHIMP_API_KEY: "api-key-us21",
  })
}

describe("Mailchimp capture auth", () => {
  it("enforces bearer auth at the HTTP boundary", async () => {
    const response = await handleMailchimpCaptureHttpRequest(createConfig(), {
      method: "POST",
      path: "/transition",
      headers: {},
      bodyText: JSON.stringify({
        version: 1,
      }),
    })

    expect(response.status).toBe(401)
    expect(JSON.parse(response.body)).toEqual({
      error: "unauthorized",
    })
  })
})
