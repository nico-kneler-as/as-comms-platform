import { afterEach, describe, expect, it, vi } from "vitest"

import type * as IntegrationsModule from "@as-comms/integrations"

const { createMailchimpCaptureServiceMock } = vi.hoisted(() => ({
  createMailchimpCaptureServiceMock: vi.fn(),
}))

vi.mock("@as-comms/integrations", async () => {
  const actual = await vi.importActual<typeof IntegrationsModule>(
    "@as-comms/integrations",
  )

  return {
    ...actual,
    createMailchimpCaptureService: createMailchimpCaptureServiceMock,
  }
})

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

afterEach(() => {
  createMailchimpCaptureServiceMock.mockReset()
  vi.restoreAllMocks()
})

describe("Mailchimp capture server", () => {
  it("logs safe structured details and returns generic 500 bodies for transition failures", async () => {
    const serviceError = new TypeError("Mailchimp transition failure")
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)

    createMailchimpCaptureServiceMock.mockReturnValue({
      handleHttpRequest: vi.fn(() => {
        throw serviceError
      }),
    })

    const response = await handleMailchimpCaptureHttpRequest(createConfig(), {
      method: "POST",
      path: "/transition",
      headers: {
        authorization: "Bearer mailchimp-token",
        "content-type": "application/json",
        "x-correlation-id": "corr-mailchimp-1",
      },
      bodyText: JSON.stringify({
        jobId: "job:mailchimp:transition:1",
      }),
    })

    expect(response.status).toBe(500)
    const responseBody = JSON.parse(response.body) as Record<string, unknown>
    expect(responseBody).toEqual({
      ok: false,
      error: "internal_error",
      requestId: "corr-mailchimp-1",
    })

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    const loggedError = JSON.parse(
      String(consoleErrorSpy.mock.calls[0]?.[0] ?? ""),
    ) as Record<string, unknown>

    expect(loggedError).toMatchObject({
      event: "mailchimp_capture.transition.error",
      requestId: "corr-mailchimp-1",
      errorName: "TypeError",
      requestMethod: "POST",
      requestPath: "/transition",
    })
    expect(loggedError).not.toHaveProperty("errorMessage")
    expect(loggedError).not.toHaveProperty("errorStack")
    expect(loggedError).not.toHaveProperty("requestBody")
    expect(typeof loggedError.occurredAt).toBe("string")
  })

  it("rejects oversized request bodies before invoking the capture service", async () => {
    const handleHttpRequest = vi.fn()

    createMailchimpCaptureServiceMock.mockReturnValue({
      handleHttpRequest,
    })

    const response = await handleMailchimpCaptureHttpRequest(createConfig(), {
      method: "POST",
      path: "/transition",
      headers: {
        authorization: "Bearer mailchimp-token",
        "content-type": "application/json",
      },
      bodyText: "x".repeat(1_000_001),
    })

    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: "payload_too_large",
    })
    expect(handleHttpRequest).not.toHaveBeenCalled()
  })
})
