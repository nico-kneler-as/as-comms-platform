import { describe, expect, it, vi } from "vitest"

import {
  handleMailchimpHealthRequest,
  readMailchimpCaptureRuntimeConfig,
} from "../src/index.js"

function createConfig() {
  return readMailchimpCaptureRuntimeConfig({
    MAILCHIMP_CAPTURE_BEARER_TOKEN: "mailchimp-token",
    MAILCHIMP_API_KEY: "api-key-us21",
  })
}

function resolveRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

describe("Mailchimp /health", () => {
  it("returns healthy when Mailchimp /ping succeeds", async () => {
    const fetchImplementation = vi.fn((input: string | URL | Request): Response => {
      const url = resolveRequestUrl(input)

      if (url === "https://us21.api.mailchimp.com/3.0/ping") {
        return new Response(JSON.stringify({ health_status: "Everything's Chimpy!" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      throw new Error(`Unexpected Mailchimp health request: ${url}`)
    })
    const result = await handleMailchimpHealthRequest(createConfig(), {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      now: () => new Date("2026-05-03T14:00:00.000Z"),
      version: "mailchimp-sha",
    })

    expect(result).toEqual({
      service: "mailchimp",
      status: "healthy",
      checkedAt: "2026-05-03T14:00:00.000Z",
      detail: null,
      version: "mailchimp-sha",
    })
  })

  it("returns disconnected when Mailchimp rejects the /ping request", async () => {
    const result = await handleMailchimpHealthRequest(createConfig(), {
      fetchImplementation: (() =>
        Promise.resolve(
          new Response("unauthorized", {
            status: 401,
          }),
        )) as unknown as typeof fetch,
      now: () => new Date("2026-05-03T14:00:00.000Z"),
    })

    expect(result).toMatchObject({
      service: "mailchimp",
      status: "disconnected",
      detail: "Mailchimp /ping returned status 401.",
    })
  })

  it("returns needs_attention when the /ping request fails", async () => {
    const result = await handleMailchimpHealthRequest(createConfig(), {
      fetchImplementation: (() => {
        throw new TypeError("network failure")
      }) as unknown as typeof fetch,
      now: () => new Date("2026-05-03T14:00:00.000Z"),
    })

    expect(result).toMatchObject({
      service: "mailchimp",
      status: "needs_attention",
      detail: "Mailchimp /ping request failed.",
    })
  })
})
