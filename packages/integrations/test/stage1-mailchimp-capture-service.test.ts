import { readFile } from "node:fs/promises"

import { describe, expect, it, vi } from "vitest"

import {
  createMailchimpCaptureService,
  type MailchimpCampaignActivityRecord,
  sha256Json,
} from "../src/index.js"

async function readFixtureJson(name: string): Promise<unknown> {
  const fixtureUrl = new URL(`./fixtures/mailchimp/${name}`, import.meta.url)
  return JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown
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

async function createMailchimpFixtureResponses() {
  return {
    campaignsPage: await readFixtureJson("campaigns-page.json"),
    reportCampaign1: await readFixtureJson("report-campaign-1.json"),
    emailActivityOffset0: await readFixtureJson("email-activity-offset-0.json"),
    emailActivityOffset1: await readFixtureJson("email-activity-offset-1.json"),
  }
}

function createFetchFromFixtures(fixtures: Awaited<
  ReturnType<typeof createMailchimpFixtureResponses>
>) {
  return vi.fn((input: string | URL | Request): Response => {
    const url = new URL(resolveRequestUrl(input))

    if (url.pathname === "/3.0/campaigns") {
      return new Response(JSON.stringify(fixtures.campaignsPage), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    }

    if (url.pathname === "/3.0/reports/campaign-1") {
      return new Response(JSON.stringify(fixtures.reportCampaign1), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    }

    if (url.pathname === "/3.0/reports/campaign-1/email-activity") {
      const offset = Number(url.searchParams.get("offset") ?? "0")
      const fixture =
        offset === 0
          ? fixtures.emailActivityOffset0
          : fixtures.emailActivityOffset1

      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    }

    if (url.pathname === "/3.0/ping") {
      return new Response(JSON.stringify({ health_status: "Everything's Chimpy!" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    }

    throw new Error(`Unexpected Mailchimp request: ${url.toString()}`)
  })
}

function isActivityRecord(
  record: unknown,
): record is MailchimpCampaignActivityRecord {
  return (
    typeof record === "object" &&
    record !== null &&
    "recordType" in record &&
    record.recordType === "campaign_member_activity"
  )
}

describe("Mailchimp capture service", () => {
  it("normalizes Mailchimp campaign activity records into the provider-close shape", async () => {
    const fixtures = await createMailchimpFixtureResponses()
    const fetchImplementation = createFetchFromFixtures(fixtures)
    const service = createMailchimpCaptureService(
      {
        bearerToken: "mailchimp-token",
        apiKey: "api-key-us21",
        activityPageSize: 1,
      },
      {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
        now: () => new Date("2026-02-03T00:00:00.000Z"),
      },
    )

    const result = await service.captureHistoricalBatch({
      version: 1,
      jobId: "job:mailchimp:historical:1",
      correlationId: "corr:mailchimp:historical:1",
      traceId: null,
      batchId: "batch:mailchimp:historical:1",
      syncStateId: "sync:mailchimp:historical:1",
      attempt: 1,
      maxAttempts: 3,
      provider: "mailchimp",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-02-01T00:00:00.000Z",
      windowEnd: "2026-02-02T00:00:00.000Z",
      recordIds: [],
      maxRecords: 10,
    })

    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "campaign_member_activity",
        recordId: "audience-1:campaign-1:member-1:sent",
        activityType: "sent",
        occurredAt: "2026-02-01T15:00:00.000Z",
        receivedAt: "2026-02-03T00:00:00.000Z",
        payloadRef: "mailchimp-api://campaign-1#member=member-1",
        normalizedEmail: "volunteer@example.org",
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: ["VOL-123"],
        normalizedPhones: [],
        campaignId: "campaign-1",
        audienceId: "audience-1",
        memberId: "member-1",
        campaignName: "Volunteer Update",
        snippet: "Project updates for this week",
      }),
      expect.objectContaining({
        activityType: "opened",
        snippet: "",
      }),
      expect.objectContaining({
        activityType: "clicked",
        snippet: "https://example.org/project",
      }),
      expect.objectContaining({
        activityType: "unsubscribed",
        snippet: "",
      }),
      expect.objectContaining({
        recordId: "audience-1:campaign-1:member-2:sent",
        normalizedEmail: "second@example.org",
      }),
    ])
    expect(result.nextCursor).toBeNull()
    expect(result.checkpoint).toBe("2026-02-02T10:00:00.000Z")
    const firstRecord = result.records[0]
    expect(isActivityRecord(firstRecord)).toBe(true)
    expect(isActivityRecord(firstRecord) ? firstRecord.checksum : null).toBe(
      sha256Json({
        campaignId: "campaign-1",
        memberId: "member-1",
        activityType: "sent",
        occurredAt: "2026-02-01T15:00:00.000Z",
      }),
    )
    expect(
      fetchImplementation.mock.calls.some((call) =>
        resolveRequestUrl(call[0]).includes("/campaigns/campaign-1/content"),
      ),
    ).toBe(false)
  })

  it("resumes historical pagination from the returned opaque cursor", async () => {
    const fixtures = await createMailchimpFixtureResponses()
    const service = createMailchimpCaptureService(
      {
        bearerToken: "mailchimp-token",
        apiKey: "api-key-us21",
        activityPageSize: 1,
      },
      {
        fetchImplementation: createFetchFromFixtures(
          fixtures,
        ) as unknown as typeof fetch,
        now: () => new Date("2026-02-03T00:00:00.000Z"),
      },
    )

    const firstBatch = await service.captureHistoricalBatch({
      version: 1,
      jobId: "job:mailchimp:historical:cursor-1",
      correlationId: "corr:mailchimp:historical:cursor-1",
      traceId: null,
      batchId: "batch:mailchimp:historical:cursor-1",
      syncStateId: "sync:mailchimp:historical:cursor-1",
      attempt: 1,
      maxAttempts: 3,
      provider: "mailchimp",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-02-01T00:00:00.000Z",
      windowEnd: "2026-02-02T00:00:00.000Z",
      recordIds: [],
      maxRecords: 2,
    })

    expect(
      firstBatch.records
        .filter(isActivityRecord)
        .map((record) => record.activityType),
    ).toEqual(["sent", "opened"])
    expect(firstBatch.nextCursor).not.toBeNull()

    const secondBatch = await service.captureHistoricalBatch({
      version: 1,
      jobId: "job:mailchimp:historical:cursor-2",
      correlationId: "corr:mailchimp:historical:cursor-2",
      traceId: null,
      batchId: "batch:mailchimp:historical:cursor-2",
      syncStateId: "sync:mailchimp:historical:cursor-2",
      attempt: 1,
      maxAttempts: 3,
      provider: "mailchimp",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: firstBatch.nextCursor,
      checkpoint: firstBatch.checkpoint,
      windowStart: "2026-02-01T00:00:00.000Z",
      windowEnd: "2026-02-02T00:00:00.000Z",
      recordIds: [],
      maxRecords: 2,
    })

    expect(
      secondBatch.records
        .filter(isActivityRecord)
        .map((record) => record.activityType),
    ).toEqual(["clicked", "unsubscribed"])
  })

  it("filters transition batches to activity strictly after windowStart", async () => {
    const fixtures = await createMailchimpFixtureResponses()
    const fetchImplementation = createFetchFromFixtures(fixtures)
    const service = createMailchimpCaptureService(
      {
        bearerToken: "mailchimp-token",
        apiKey: "api-key-us21",
        activityPageSize: 1,
      },
      {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
        now: () => new Date("2026-02-03T00:00:00.000Z"),
      },
    )

    const result = await service.captureTransitionBatch({
      version: 1,
      jobId: "job:mailchimp:transition:1",
      correlationId: "corr:mailchimp:transition:1",
      traceId: null,
      batchId: "batch:mailchimp:transition:1",
      syncStateId: "sync:mailchimp:transition:1",
      attempt: 1,
      maxAttempts: 3,
      provider: "mailchimp",
      mode: "transition_live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: null,
      windowStart: "2026-02-01T15:11:00.000Z",
      windowEnd: "2026-02-03T00:00:00.000Z",
      recordIds: [],
      maxRecords: 10,
    })

    expect(result.records.filter(isActivityRecord).map((record) => record.activityType)).toEqual([
      "clicked",
      "unsubscribed",
    ])
    const campaignRequest = fetchImplementation.mock.calls.find((call) => {
      const url = new URL(resolveRequestUrl(call[0]))

      return url.pathname === "/3.0/campaigns"
    })

    expect(campaignRequest).toBeDefined()
    if (campaignRequest === undefined) {
      throw new Error("Expected transition capture to list campaigns.")
    }

    const campaignRequestUrl = new URL(resolveRequestUrl(campaignRequest[0]))
    expect(campaignRequestUrl.searchParams.get("since_send_time")).toBe(
      "2026-02-01T15:11:00.000Z",
    )
    expect(campaignRequestUrl.searchParams.get("before_send_time")).toBe(
      "2026-02-03T00:00:00.000Z",
    )
  })
})
