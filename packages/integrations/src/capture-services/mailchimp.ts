import { setTimeout as sleep } from "node:timers/promises"

import {
  createCapturedBatchResponseSchema,
  type CapturedBatchResponse,
} from "../capture/shared.js"
import {
  integrationHealthCheckResponseSchema,
  mailchimpHistoricalCaptureBatchPayloadSchema,
  mailchimpTransitionCaptureBatchPayloadSchema,
  type IntegrationHealthCheckResponse,
  type IntegrationHealthStatus,
  type MailchimpHistoricalCaptureBatchPayload,
  type MailchimpTransitionCaptureBatchPayload,
} from "@as-comms/contracts"
import {
  mailchimpCampaignActivityRecordSchema,
  mailchimpRecordSchema,
  type MailchimpCampaignActivityRecord,
  type MailchimpRecord,
} from "../providers/mailchimp.js"
import { z } from "zod"

import type {
  CaptureServiceHttpRequest,
  CaptureServiceHttpResponse,
} from "./shared.js"
import {
  CaptureServiceBadRequestError,
  hasBearerToken,
  jsonResponse,
  normalizeEmail,
  parseJsonRequestBody,
  sha256Json,
  toIsoTimestamp,
  uniqueValues,
} from "./shared.js"

const DEFAULT_MAX_RECORDS = 500
const MAX_MAILCHIMP_CONCURRENCY = 5
const MAILCHIMP_PAGE_SIZE = 1_000
const MAILCHIMP_SENT_SNIPPET_MAX = 280
const mailchimpCaptureServiceResponseSchema =
  createCapturedBatchResponseSchema(mailchimpRecordSchema)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const nullableStringSchema = z.string().min(1).nullable()

const mailchimpCaptureServiceConfigSchema = z.object({
  bearerToken: z.string().min(1),
  apiKey: z.string().min(1),
  dataCenter: z.string().min(1).nullable().default(null),
  apiBaseUrl: z.string().url().nullable().default(null),
  salesforceContactIdMergeField: z
    .string()
    .min(1)
    .default("SFCONTACTID"),
  volunteerIdMergeField: z.string().min(1).default("VOLUNTID"),
  timeoutMs: z.number().int().positive().default(30_000),
  maxConcurrentRequests: z
    .number()
    .int()
    .positive()
    .max(MAX_MAILCHIMP_CONCURRENCY)
    .default(MAX_MAILCHIMP_CONCURRENCY),
  maxRetries: z.number().int().nonnegative().default(3),
  retryBaseDelayMs: z.number().int().positive().default(1_000),
  activityPageSize: z.number().int().positive().default(MAILCHIMP_PAGE_SIZE),
  campaignPageSize: z.number().int().positive().default(MAILCHIMP_PAGE_SIZE),
})
export type MailchimpCaptureServiceConfig = z.input<
  typeof mailchimpCaptureServiceConfigSchema
>
type ResolvedMailchimpCaptureServiceConfig = z.output<
  typeof mailchimpCaptureServiceConfigSchema
>

const mailchimpCampaignListItemSchema = z
  .object({
    id: z.string().min(1),
    send_time: nullableStringSchema.default(null),
    list_id: nullableStringSchema.default(null),
    campaign_title: nullableStringSchema.default(null),
    subject_line: nullableStringSchema.default(null),
    preview_text: nullableStringSchema.default(null),
    settings: z
      .object({
        title: nullableStringSchema.default(null),
        subject_line: nullableStringSchema.default(null),
        preview_text: nullableStringSchema.default(null),
      })
      .partial()
      .nullable()
      .optional(),
    recipients: z
      .object({
        list_id: nullableStringSchema.default(null),
      })
      .partial()
      .nullable()
      .optional(),
  })
  .passthrough()

const mailchimpCampaignListResponseSchema = z
  .object({
    campaigns: z.array(mailchimpCampaignListItemSchema).default([]),
    total_items: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough()

const mailchimpReportSummarySchema = z
  .object({
    id: z.string().min(1),
    campaign_title: nullableStringSchema.default(null),
    subject_line: nullableStringSchema.default(null),
    preview_text: nullableStringSchema.default(null),
    plain_text_summary: nullableStringSchema.default(null),
    list_id: nullableStringSchema.default(null),
    send_time: nullableStringSchema.default(null),
    recipients: z
      .object({
        list_id: nullableStringSchema.default(null),
      })
      .partial()
      .nullable()
      .optional(),
  })
  .passthrough()

const mailchimpCampaignContentSchema = z
  .object({
    html: nullableStringSchema.default(null),
    plain_text: nullableStringSchema.default(null),
    text: nullableStringSchema.default(null),
    archive_html: nullableStringSchema.default(null),
    archive_text: nullableStringSchema.default(null),
  })
  .passthrough()

const mailchimpEmailActivityEventSchema = z
  .object({
    action: nullableStringSchema.default(null),
    activity_type: nullableStringSchema.default(null),
    type: nullableStringSchema.default(null),
    timestamp: nullableStringSchema.default(null),
    created_at: nullableStringSchema.default(null),
    url: nullableStringSchema.default(null),
    link_clicked: nullableStringSchema.default(null),
  })
  .passthrough()

const mailchimpEmailActivityMemberSchema = z
  .object({
    email_id: nullableStringSchema.default(null),
    subscriber_hash: nullableStringSchema.default(null),
    email_address: nullableStringSchema.default(null),
    list_id: nullableStringSchema.default(null),
    merge_fields: z.record(z.string(), z.unknown()).default({}),
    activity: z.array(mailchimpEmailActivityEventSchema).default([]),
  })
  .passthrough()

const mailchimpEmailActivityResponseSchema = z
  .object({
    emails: z.array(mailchimpEmailActivityMemberSchema).default([]),
    total_items: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough()

const mailchimpBatchCursorSchema = z.object({
  lastCampaignId: z.string().min(1),
  lastMemberOffset: z.number().int().nonnegative(),
  lastActivityOffset: z.number().int().nonnegative().default(0),
})

interface MailchimpListedCampaign {
  readonly id: string
  readonly sendTime: string | null
  readonly audienceId: string | null
  readonly campaignName: string | null
}

interface MailchimpCampaignContext {
  readonly campaignId: string
  readonly audienceId: string
  readonly campaignName: string | null
  readonly sendTime: string
  readonly sentSnippet: string
}

interface MailchimpMemberActivityCandidate {
  readonly activityType: MailchimpCampaignActivityRecord["activityType"]
  readonly occurredAt: string
  readonly snippet: string
}

interface MailchimpBatchCursor {
  readonly lastCampaignId: string
  readonly lastMemberOffset: number
  readonly lastActivityOffset: number
}

interface MailchimpApiRequestContext {
  readonly fetchImplementation: typeof fetch
  readonly config: ResolvedMailchimpCaptureServiceConfig
  readonly baseUrl: string
  readonly authorizationHeader: string
  readonly now: () => Date
  readonly sleepImplementation: typeof sleep
  readonly runLimited: <T>(work: () => Promise<T>) => Promise<T>
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveMailchimpDataCenter(
  apiKey: string,
  explicitDataCenter: string | null,
): string {
  if (explicitDataCenter !== null) {
    return explicitDataCenter
  }

  const suffix = apiKey.split("-").at(-1)?.trim()

  if (suffix === undefined || suffix.length === 0 || suffix === apiKey.trim()) {
    throw new Error(
      "MAILCHIMP_API_KEY must include a Mailchimp data-center suffix like us21.",
    )
  }

  return suffix
}

function buildMailchimpBaseUrl(
  config: ResolvedMailchimpCaptureServiceConfig,
): string {
  if (config.apiBaseUrl !== null) {
    return new URL(config.apiBaseUrl).toString()
  }

  return new URL(
    `https://${resolveMailchimpDataCenter(config.apiKey, config.dataCenter)}.api.mailchimp.com/3.0/`,
  ).toString()
}

function encodeMailchimpCursor(cursor: MailchimpBatchCursor): string {
  return Buffer.from(
    JSON.stringify(mailchimpBatchCursorSchema.parse(cursor)),
    "utf8",
  ).toString("base64url")
}

function decodeMailchimpCursor(cursor: string | null): MailchimpBatchCursor | null {
  if (cursor === null) {
    return null
  }

  try {
    return mailchimpBatchCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown,
    )
  } catch {
    throw new CaptureServiceBadRequestError(
      "Cursor is not valid Mailchimp capture state.",
    )
  }
}

function createConcurrencyLimiter(maxConcurrent: number): <T>(
  work: () => Promise<T>,
) => Promise<T> {
  let activeCount = 0
  const queue: (() => void)[] = []

  function release(): void {
    activeCount = Math.max(0, activeCount - 1)
    const next = queue.shift()
    if (next !== undefined) {
      next()
    }
  }

  return async function runLimited<T>(work: () => Promise<T>): Promise<T> {
    if (activeCount >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        queue.push(resolve)
      })
    }

    activeCount += 1

    try {
      return await work()
    } finally {
      release()
    }
  }
}

function createMailchimpAuthorizationHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`anystring:${apiKey}`, "utf8").toString("base64")}`
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) {
    return null
  }

  const seconds = Number.parseInt(value, 10)

  if (Number.isInteger(seconds) && seconds >= 0) {
    return seconds * 1_000
  }

  const dateMs = Date.parse(value)
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now())
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

async function requestMailchimpJson<TSchema extends z.ZodType<unknown>>(
  context: MailchimpApiRequestContext,
  input: {
    readonly path: string
    readonly query?: Record<string, string | number | null | undefined>
    readonly schema: TSchema
    readonly notFoundValue?: z.output<TSchema> | null
  },
): Promise<z.output<TSchema> | null> {
  const url = new URL(input.path.replace(/^\//u, ""), context.baseUrl)

  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === null || value === undefined) {
      continue
    }

    url.searchParams.set(key, String(value))
  }

  let lastError: Error | null = null

  for (
    let attemptIndex = 0;
    attemptIndex <= context.config.maxRetries;
    attemptIndex += 1
  ) {
    try {
      const response = await context.runLimited(() =>
        context.fetchImplementation(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: context.authorizationHeader,
          },
          signal: AbortSignal.timeout(context.config.timeoutMs),
        }),
      )

      if (response.status === 404 && input.notFoundValue !== undefined) {
        return input.notFoundValue
      }

      if (!response.ok) {
        const responseText = await readResponseText(response)

        if (
          isRetryableStatus(response.status) &&
          attemptIndex < context.config.maxRetries
        ) {
          const retryAfterMs =
            parseRetryAfterMs(response.headers.get("retry-after")) ??
            context.config.retryBaseDelayMs * 2 ** attemptIndex
          await context.sleepImplementation(retryAfterMs)
          continue
        }

        throw new Error(
          `Mailchimp request failed with status ${String(response.status)} for ${url.pathname}: ${responseText || "empty response body"}`,
        )
      }

      const parsedJson = (await response.json()) as unknown
      return input.schema.parse(parsedJson) as z.output<TSchema>
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        error instanceof CaptureServiceBadRequestError
      ) {
        throw error
      }

      const normalizedError =
        error instanceof Error ? error : new Error(String(error))
      lastError = normalizedError

      if (
        attemptIndex < context.config.maxRetries &&
        (isAbortError(error) ||
          normalizedError instanceof TypeError ||
          /status 429|status 5\d\d/u.test(normalizedError.message))
      ) {
        await context.sleepImplementation(
          context.config.retryBaseDelayMs * 2 ** attemptIndex,
        )
        continue
      }

      throw normalizedError
    }
  }

  throw lastError ?? new Error("Mailchimp request failed.")
}

function sortCampaigns(
  campaigns: readonly MailchimpListedCampaign[],
): MailchimpListedCampaign[] {
  return [...campaigns].sort((left, right) => {
    const leftSendTime = left.sendTime ?? ""
    const rightSendTime = right.sendTime ?? ""

    if (leftSendTime !== rightSendTime) {
      return leftSendTime.localeCompare(rightSendTime)
    }

    return left.id.localeCompare(right.id)
  })
}

async function listSentCampaigns(
  context: MailchimpApiRequestContext,
  input: {
    readonly windowStart: string
    readonly windowEnd: string
  },
): Promise<readonly MailchimpListedCampaign[]> {
  const campaigns: MailchimpListedCampaign[] = []
  let offset = 0

  for (;;) {
    const response = await requestMailchimpJson(context, {
      path: "/campaigns",
      query: {
        status: "sent",
        since_send_time: input.windowStart,
        before_send_time: input.windowEnd,
        count: context.config.campaignPageSize,
        offset,
      },
      schema: mailchimpCampaignListResponseSchema,
    })

    const page = response?.campaigns ?? []

    campaigns.push(
      ...page.map((campaign): MailchimpListedCampaign => ({
        id: campaign.id,
        sendTime: toIsoTimestamp(campaign.send_time ?? null),
        audienceId:
          normalizeOptionalString(campaign.recipients?.list_id ?? null) ??
          normalizeOptionalString(campaign.list_id),
        campaignName:
          normalizeOptionalString(campaign.campaign_title) ??
          normalizeOptionalString(campaign.settings?.title ?? null) ??
          normalizeOptionalString(campaign.subject_line) ??
          normalizeOptionalString(campaign.settings?.subject_line ?? null),
      })),
    )

    if (
      page.length < context.config.campaignPageSize ||
      page.length === 0 ||
      page.length + offset >= (response?.total_items ?? Number.MAX_SAFE_INTEGER)
    ) {
      break
    }

    offset += page.length
  }

  return sortCampaigns(campaigns)
}

async function getCampaignReportContext(
  context: MailchimpApiRequestContext,
  listedCampaign: MailchimpListedCampaign,
): Promise<MailchimpCampaignContext | null> {
  const report = await requestMailchimpJson(context, {
    path: `/reports/${encodeURIComponent(listedCampaign.id)}`,
    schema: mailchimpReportSummarySchema,
    notFoundValue: null,
  })

  if (report === null) {
    console.warn(
      JSON.stringify({
        event: "mailchimp_capture.report.missing",
        campaignId: listedCampaign.id,
        occurredAt: context.now().toISOString(),
      }),
    )
    return null
  }

  const audienceId =
    normalizeOptionalString(report.recipients?.list_id ?? null) ??
    normalizeOptionalString(report.list_id) ??
    listedCampaign.audienceId
  const sendTime =
    toIsoTimestamp(report.send_time ?? null) ?? listedCampaign.sendTime

  if (audienceId === null || sendTime === null) {
    throw new CaptureServiceBadRequestError(
      `Mailchimp campaign ${listedCampaign.id} is missing required report fields.`,
    )
  }

  const reportSnippet = normalizeOptionalString(report.plain_text_summary)
  const content =
    reportSnippet !== null
      ? null
      : await requestMailchimpJson(context, {
          path: `/campaigns/${encodeURIComponent(listedCampaign.id)}/content`,
          schema: mailchimpCampaignContentSchema,
          notFoundValue: null,
        })
  const sentSnippet = buildSentSnippet({
    report,
    content,
  })

  return {
    campaignId: listedCampaign.id,
    audienceId,
    campaignName:
      normalizeOptionalString(report.campaign_title) ??
      listedCampaign.campaignName,
    sendTime,
    sentSnippet,
  }
}

async function getCampaignsForIds(
  context: MailchimpApiRequestContext,
  campaignIds: readonly string[],
): Promise<readonly MailchimpListedCampaign[]> {
  const campaigns = await Promise.all(
    uniqueValues(campaignIds).map(async (campaignId) => {
      const report = await requestMailchimpJson(context, {
        path: `/reports/${encodeURIComponent(campaignId)}`,
        schema: mailchimpReportSummarySchema,
        notFoundValue: null,
      })

      if (report === null) {
        console.warn(
          JSON.stringify({
            event: "mailchimp_capture.report.missing",
            campaignId,
            occurredAt: context.now().toISOString(),
          }),
        )
        return null
      }

      return {
        id: campaignId,
        sendTime: toIsoTimestamp(report.send_time ?? null),
        audienceId:
          normalizeOptionalString(report.recipients?.list_id ?? null) ??
          normalizeOptionalString(report.list_id),
        campaignName: normalizeOptionalString(report.campaign_title),
      } satisfies MailchimpListedCampaign
    }),
  )

  return sortCampaigns(
    campaigns.filter(
      (campaign): campaign is MailchimpListedCampaign => campaign !== null,
    ),
  )
}

async function getEmailActivityPage(
  context: MailchimpApiRequestContext,
  input: {
    readonly campaignId: string
    readonly offset: number
  },
): Promise<{
  readonly members: readonly z.infer<typeof mailchimpEmailActivityMemberSchema>[]
  readonly hasMore: boolean
}> {
  const response = await requestMailchimpJson(context, {
    path: `/reports/${encodeURIComponent(input.campaignId)}/email-activity`,
    query: {
      count: context.config.activityPageSize,
      offset: input.offset,
    },
    schema: mailchimpEmailActivityResponseSchema,
    notFoundValue: null,
  })

  if (response === null) {
    console.warn(
      JSON.stringify({
        event: "mailchimp_capture.email_activity.missing",
        campaignId: input.campaignId,
        occurredAt: context.now().toISOString(),
      }),
    )

    return {
      members: [],
      hasMore: false,
    }
  }

  const members = response.emails
  const totalItems = response.total_items ?? members.length

  return {
    members,
    hasMore: input.offset + members.length < totalItems,
  }
}

function normalizeCampaignBodyText(value: string): string {
  return value
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/[ \t]*\n[ \t]*/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value.replaceAll(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu,
    (match, entity: string) => {
      const lowered = entity.toLowerCase()

      switch (lowered) {
        case "amp":
          return "&"
        case "lt":
          return "<"
        case "gt":
          return ">"
        case "quot":
          return '"'
        case "apos":
          return "'"
        case "nbsp":
          return " "
        default:
          break
      }

      if (lowered.startsWith("#x")) {
        const codePoint = Number.parseInt(lowered.slice(2), 16)
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match
      }

      if (lowered.startsWith("#")) {
        const codePoint = Number.parseInt(lowered.slice(1), 10)
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match
      }

      return match
    },
  )
}

function htmlToPlainText(html: string): string {
  const withoutScripts = html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
  const withLineBreaks = withoutScripts
    .replaceAll(/<\s*br\s*\/?\s*>/giu, "\n")
    .replaceAll(
      /<\/(p|div|section|article|header|footer|tr|li|h[1-6])>/giu,
      "\n\n",
    )
    .replaceAll(/<li\b[^>]*>/giu, "- ")

  return normalizeCampaignBodyText(
    decodeHtmlEntities(withLineBreaks.replaceAll(/<[^>]+>/gu, " "))
      .replaceAll("\u00a0", " "),
  )
}

function stripMailchimpFooter(value: string): string {
  const boundaries = [
    "\n============================================================",
    "\nCopyright ©",
    "\nWant to change how you receive these emails?",
    "\nOur mailing address is:",
  ]
  let earliestBoundary = -1

  for (const boundary of boundaries) {
    const index = value.indexOf(boundary)

    if (index === -1) {
      continue
    }

    if (earliestBoundary === -1 || index < earliestBoundary) {
      earliestBoundary = index
    }
  }

  return earliestBoundary === -1 ? value : value.slice(0, earliestBoundary)
}

function sanitizeMailchimpBodyText(value: string): string {
  return normalizeCampaignBodyText(
    stripMailchimpFooter(value)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !/^\*\|[A-Z0-9_:]+\|\*$/u.test(line))
      .join("\n"),
  )
}

function extractCampaignBodyText(
  content: z.output<typeof mailchimpCampaignContentSchema> | null,
): string | null {
  if (content === null) {
    return null
  }

  for (const candidate of [content.plain_text, content.text, content.archive_text]) {
    const normalized = normalizeOptionalString(candidate)
    if (normalized !== null) {
      return sanitizeMailchimpBodyText(normalized)
    }
  }

  for (const candidate of [content.html, content.archive_html]) {
    const normalized = normalizeOptionalString(candidate)
    if (normalized !== null) {
      return sanitizeMailchimpBodyText(htmlToPlainText(normalized))
    }
  }

  return null
}

function buildSentSnippet(input: {
  readonly report: z.output<typeof mailchimpReportSummarySchema>
  readonly content: z.output<typeof mailchimpCampaignContentSchema> | null
}): string {
  const plainTextSummary = normalizeOptionalString(input.report.plain_text_summary)

  if (plainTextSummary !== null) {
    return plainTextSummary.slice(0, MAILCHIMP_SENT_SNIPPET_MAX)
  }

  const campaignBody = extractCampaignBodyText(input.content)

  if (campaignBody !== null) {
    return campaignBody.slice(0, MAILCHIMP_SENT_SNIPPET_MAX)
  }

  return (
    normalizeOptionalString(input.report.preview_text) ??
    normalizeOptionalString(input.report.subject_line) ??
    normalizeOptionalString(input.report.campaign_title) ??
    ""
  ).slice(0, MAILCHIMP_SENT_SNIPPET_MAX)
}

function normalizeMergeFieldKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/gu, "").toUpperCase()
}

function readConfiguredMergeField(
  mergeFields: Record<string, unknown>,
  configuredKey: string,
): unknown {
  const normalizedConfiguredKey = normalizeMergeFieldKey(configuredKey)

  for (const [key, value] of Object.entries(mergeFields)) {
    if (normalizeMergeFieldKey(key) === normalizedConfiguredKey) {
      return value
    }
  }

  return null
}

function readMergeFieldString(
  mergeFields: Record<string, unknown>,
  configuredKey: string,
): string | null {
  const value = readConfiguredMergeField(mergeFields, configuredKey)
  return typeof value === "string" ? normalizeOptionalString(value) : null
}

function readMergeFieldStringArray(
  mergeFields: Record<string, unknown>,
  configuredKey: string,
): string[] {
  const value = readConfiguredMergeField(mergeFields, configuredKey)

  if (typeof value === "string") {
    return uniqueValues(
      value
        .split(/[,\n;]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
  }

  if (Array.isArray(value)) {
    return uniqueValues(
      value.filter((item): item is string => typeof item === "string"),
    )
  }

  return []
}

function resolveMailchimpMemberId(input: {
  readonly member: z.output<typeof mailchimpEmailActivityMemberSchema>
  readonly normalizedEmail: string
}): string {
  return (
    normalizeOptionalString(input.member.email_id) ??
    normalizeOptionalString(input.member.subscriber_hash) ??
    input.normalizedEmail
  )
}

function resolveMailchimpActivityType(
  event: z.output<typeof mailchimpEmailActivityEventSchema>,
): MailchimpCampaignActivityRecord["activityType"] | null {
  const rawType = normalizeOptionalString(
    event.action ?? event.activity_type ?? event.type,
  )

  switch (rawType?.toLowerCase()) {
    case "sent":
      return "sent"
    case "open":
    case "opened":
      return "opened"
    case "click":
    case "clicked":
      return "clicked"
    case "unsub":
    case "unsubscribe":
    case "unsubscribed":
      return "unsubscribed"
    default:
      return null
  }
}

function buildMailchimpMemberActivityCandidates(input: {
  readonly member: z.output<typeof mailchimpEmailActivityMemberSchema>
  readonly campaign: MailchimpCampaignContext
}): readonly MailchimpMemberActivityCandidate[] {
  const earliestTimestamps = new Map<
    MailchimpCampaignActivityRecord["activityType"],
    string
  >()
  let clickedUrl = ""

  for (const event of input.member.activity) {
    const activityType = resolveMailchimpActivityType(event)

    if (activityType === null) {
      continue
    }

    const occurredAt = toIsoTimestamp(
      event.timestamp ?? event.created_at ?? null,
    )

    if (occurredAt === null) {
      continue
    }

    const current = earliestTimestamps.get(activityType)

    if (current === undefined || occurredAt < current) {
      earliestTimestamps.set(activityType, occurredAt)
    }

    if (activityType === "clicked" && clickedUrl.length === 0) {
      clickedUrl =
        normalizeOptionalString(event.url ?? event.link_clicked) ?? clickedUrl
    }
  }

  if (!earliestTimestamps.has("sent")) {
    earliestTimestamps.set("sent", input.campaign.sendTime)
  }

  const orderedTypes: readonly MailchimpCampaignActivityRecord["activityType"][] =
    ["sent", "opened", "clicked", "unsubscribed"]

  return orderedTypes.flatMap((activityType) => {
    const occurredAt = earliestTimestamps.get(activityType)

    if (occurredAt === undefined) {
      return []
    }

    return [
      {
        activityType,
        occurredAt,
        snippet:
          activityType === "sent"
            ? input.campaign.sentSnippet
            : activityType === "clicked"
              ? clickedUrl
              : "",
      } satisfies MailchimpMemberActivityCandidate,
    ]
  })
}

function isTransitionActivityInWindow(
  occurredAt: string,
  windowStart: string | null,
  windowEnd: string | null,
): boolean {
  if (windowStart !== null && occurredAt <= windowStart) {
    return false
  }

  if (windowEnd !== null && occurredAt > windowEnd) {
    return false
  }

  return true
}

function buildMailchimpCampaignMemberRecord(input: {
  readonly campaign: MailchimpCampaignContext
  readonly memberId: string
  readonly normalizedEmail: string
  readonly mergeFields: Record<string, unknown>
  readonly activity: MailchimpMemberActivityCandidate
  readonly receivedAt: string
  readonly config: ResolvedMailchimpCaptureServiceConfig
}): MailchimpCampaignActivityRecord {
  return mailchimpCampaignActivityRecordSchema.parse({
    recordType: "campaign_member_activity",
    recordId: [
      input.campaign.audienceId,
      input.campaign.campaignId,
      input.memberId,
      input.activity.activityType,
    ].join(":"),
    activityType: input.activity.activityType,
    occurredAt: input.activity.occurredAt,
    receivedAt: input.receivedAt,
    payloadRef: `mailchimp-api://${input.campaign.campaignId}#member=${encodeURIComponent(input.memberId)}`,
    checksum: sha256Json({
      campaignId: input.campaign.campaignId,
      memberId: input.memberId,
      activityType: input.activity.activityType,
      occurredAt: input.activity.occurredAt,
    }),
    normalizedEmail: input.normalizedEmail,
    salesforceContactId: readMergeFieldString(
      input.mergeFields,
      input.config.salesforceContactIdMergeField,
    ),
    volunteerIdPlainValues: readMergeFieldStringArray(
      input.mergeFields,
      input.config.volunteerIdMergeField,
    ),
    normalizedPhones: [],
    campaignId: input.campaign.campaignId,
    audienceId: input.campaign.audienceId,
    memberId: input.memberId,
    campaignName: input.campaign.campaignName,
    snippet: input.activity.snippet,
  })
}

function maxIsoTimestamp(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null
  }

  return [...values].sort((left, right) => left.localeCompare(right)).at(-1) ?? null
}

function buildHistoricalCampaignWindow(
  payload: MailchimpHistoricalCaptureBatchPayload,
): {
  readonly windowStart: string
  readonly windowEnd: string
} | null {
  if (payload.recordIds.length > 0) {
    return null
  }

  if (payload.windowStart === null || payload.windowEnd === null) {
    throw new CaptureServiceBadRequestError(
      "windowStart and windowEnd are required when recordIds are not provided.",
    )
  }

  if (payload.windowStart >= payload.windowEnd) {
    throw new CaptureServiceBadRequestError(
      "windowStart must be earlier than windowEnd.",
    )
  }

  return {
    windowStart: payload.windowStart,
    windowEnd: payload.windowEnd,
  }
}

function buildTransitionCampaignWindow(
  now: Date,
  payload: MailchimpTransitionCaptureBatchPayload,
): {
  readonly windowStart: string
  readonly windowEnd: string
} {
  const windowEndIso = payload.windowEnd ?? now.toISOString()
  const windowEnd = new Date(windowEndIso)

  if (Number.isNaN(windowEnd.getTime())) {
    throw new CaptureServiceBadRequestError("windowEnd must be a valid timestamp.")
  }

  const windowStart = new Date(windowEnd.getTime())
  windowStart.setUTCDate(windowStart.getUTCDate() - 30)

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  }
}

async function collectMailchimpBatch(input: {
  readonly campaigns: readonly MailchimpListedCampaign[]
  readonly cursor: MailchimpBatchCursor | null
  readonly maxRecords: number
  readonly receivedAt: string
  readonly context: MailchimpApiRequestContext
  readonly mode: "historical" | "transition"
  readonly payload: {
    readonly checkpoint: string | null
    readonly windowStart: string | null
    readonly windowEnd: string | null
  }
  readonly config: ResolvedMailchimpCaptureServiceConfig
}): Promise<CapturedBatchResponse<MailchimpRecord>> {
  const records: MailchimpRecord[] = []
  const checkpointCandidates: string[] = []
  let resumeCursorConsumed = input.cursor === null

  for (
    let campaignIndex = 0;
    campaignIndex < input.campaigns.length;
    campaignIndex += 1
  ) {
    const listedCampaign = input.campaigns[campaignIndex]

    if (listedCampaign === undefined) {
      continue
    }

    if (
      !resumeCursorConsumed &&
      listedCampaign.id !== input.cursor?.lastCampaignId
    ) {
      continue
    }

    const campaign = await getCampaignReportContext(input.context, listedCampaign)

    if (campaign === null) {
      if (
        !resumeCursorConsumed &&
        listedCampaign.id === input.cursor?.lastCampaignId
      ) {
        resumeCursorConsumed = true
      }
      continue
    }

    let offset =
      !resumeCursorConsumed && listedCampaign.id === input.cursor?.lastCampaignId
        ? input.cursor.lastMemberOffset
        : 0
    let memberActivityOffset =
      !resumeCursorConsumed && listedCampaign.id === input.cursor?.lastCampaignId
        ? input.cursor.lastActivityOffset
        : 0

    resumeCursorConsumed = true

    for (;;) {
      const page = await getEmailActivityPage(input.context, {
        campaignId: campaign.campaignId,
        offset,
      })

      if (page.members.length === 0) {
        break
      }

      for (let memberIndex = 0; memberIndex < page.members.length; memberIndex += 1) {
        const member = page.members[memberIndex]

        if (member === undefined) {
          continue
        }

        const normalizedEmailValue = normalizeEmail(member.email_address)

        if (normalizedEmailValue === null) {
          memberActivityOffset = 0
          continue
        }

        const memberId = resolveMailchimpMemberId({
          member,
          normalizedEmail: normalizedEmailValue,
        })
        const activities = buildMailchimpMemberActivityCandidates({
          member,
          campaign,
        })
          .filter((activity) =>
            input.mode === "historical"
              ? true
              : isTransitionActivityInWindow(
                  activity.occurredAt,
                  input.payload.windowStart,
                  input.payload.windowEnd,
                ),
          )
          .map((activity) =>
            buildMailchimpCampaignMemberRecord({
              campaign,
              memberId,
              normalizedEmail: normalizedEmailValue,
              mergeFields: member.merge_fields,
              activity,
              receivedAt: input.receivedAt,
              config: input.config,
            }),
          )

        const memberOffset = offset + memberIndex

        for (
          let activityIndex = memberActivityOffset;
          activityIndex < activities.length;
          activityIndex += 1
        ) {
          const activityRecord = activities[activityIndex]

          if (activityRecord === undefined) {
            continue
          }

          records.push(activityRecord as MailchimpRecord)
          checkpointCandidates.push(activityRecord.occurredAt)

          if (records.length === input.maxRecords) {
            const hasMoreInCurrentMember = activityIndex + 1 < activities.length
            const hasMoreInCurrentPage = memberIndex + 1 < page.members.length
            const hasMoreCampaignPages = page.hasMore
            const hasMoreCampaigns = campaignIndex + 1 < input.campaigns.length
            const hasMore =
              hasMoreInCurrentMember ||
              hasMoreInCurrentPage ||
              hasMoreCampaignPages ||
              hasMoreCampaigns

            return mailchimpCaptureServiceResponseSchema.parse({
              records,
              nextCursor: hasMore
                ? encodeMailchimpCursor({
                    lastCampaignId: campaign.campaignId,
                    lastMemberOffset: memberOffset,
                    lastActivityOffset: activityIndex + 1,
                  })
                : null,
              checkpoint:
                maxIsoTimestamp(checkpointCandidates) ??
                input.payload.checkpoint ??
                input.payload.windowEnd ??
                null,
            })
          }
        }

        memberActivityOffset = 0
      }

      if (!page.hasMore) {
        break
      }

      offset += page.members.length
    }
  }

  return mailchimpCaptureServiceResponseSchema.parse({
    records,
    nextCursor: null,
    checkpoint:
      maxIsoTimestamp(checkpointCandidates) ??
      input.payload.checkpoint ??
      input.payload.windowEnd ??
      null,
  })
}

export interface MailchimpCaptureService {
  captureHistoricalBatch(
    payload: MailchimpHistoricalCaptureBatchPayload,
  ): Promise<CapturedBatchResponse<MailchimpRecord>>
  captureTransitionBatch(
    payload: MailchimpTransitionCaptureBatchPayload,
  ): Promise<CapturedBatchResponse<MailchimpRecord>>
  handleHttpRequest(
    request: CaptureServiceHttpRequest,
  ): Promise<CaptureServiceHttpResponse>
  checkHealth(input?: {
    readonly timeoutMs?: number
    readonly version?: string | null
  }): Promise<IntegrationHealthCheckResponse>
}

export async function checkMailchimpCaptureServiceHealth(
  config: MailchimpCaptureServiceConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch
    readonly now?: () => Date
    readonly timeoutMs?: number
    readonly version?: string | null
    readonly lastSuccessAt?: string | null
  },
): Promise<IntegrationHealthCheckResponse> {
  const parsedConfig = mailchimpCaptureServiceConfigSchema.parse(config)
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch
  const now = input?.now ?? (() => new Date())
  const checkedAt = now().toISOString()
  const timeoutMs = Math.min(parsedConfig.timeoutMs, input?.timeoutMs ?? 5_000)
  const baseUrl = buildMailchimpBaseUrl(parsedConfig)

  if (typeof fetchImplementation !== "function") {
    return integrationHealthCheckResponseSchema.parse({
      service: "mailchimp",
      status: "needs_attention",
      checkedAt,
      detail: "Global fetch is unavailable.",
      version: input?.version ?? null,
    })
  }

  try {
    const response = await fetchImplementation(new URL("ping", baseUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: createMailchimpAuthorizationHeader(parsedConfig.apiKey),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (response.ok) {
      return integrationHealthCheckResponseSchema.parse({
        service: "mailchimp",
        status: "healthy",
        checkedAt,
        detail: null,
        version: input?.version ?? null,
      })
    }

    const lastSuccessSuffix =
      input?.lastSuccessAt === undefined || input.lastSuccessAt === null
        ? ""
        : ` Last success at ${input.lastSuccessAt}.`
    const status: Extract<
      IntegrationHealthStatus,
      "needs_attention" | "disconnected"
    > = response.status === 401 || response.status === 403
      ? "disconnected"
      : "needs_attention"

    return integrationHealthCheckResponseSchema.parse({
      service: "mailchimp",
      status,
      checkedAt,
      detail: `Mailchimp /ping returned status ${String(response.status)}.${lastSuccessSuffix}`,
      version: input?.version ?? null,
    })
  } catch (error) {
    const detail =
      isAbortError(error)
        ? "Mailchimp /ping timed out."
        : "Mailchimp /ping request failed."
    const lastSuccessSuffix =
      input?.lastSuccessAt === undefined || input.lastSuccessAt === null
        ? ""
        : ` Last success at ${input.lastSuccessAt}.`

    return integrationHealthCheckResponseSchema.parse({
      service: "mailchimp",
      status: "needs_attention",
      checkedAt,
      detail: `${detail}${lastSuccessSuffix}`,
      version: input?.version ?? null,
    })
  }
}

export function createMailchimpCaptureService(
  config: MailchimpCaptureServiceConfig,
  input?: {
    readonly fetchImplementation?: typeof fetch
    readonly now?: () => Date
    readonly sleepImplementation?: typeof sleep
  },
): MailchimpCaptureService {
  const parsedConfig = mailchimpCaptureServiceConfigSchema.parse(config)
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch
  const now = input?.now ?? (() => new Date())
  const runLimited = createConcurrencyLimiter(parsedConfig.maxConcurrentRequests)
  const baseUrl = buildMailchimpBaseUrl(parsedConfig)
  const authorizationHeader = createMailchimpAuthorizationHeader(
    parsedConfig.apiKey,
  )
  const sleepImplementation = input?.sleepImplementation ?? sleep
  let lastSuccessAt: string | null = null

  if (typeof fetchImplementation !== "function") {
    throw new Error(
      "Global fetch is unavailable; provide a fetch implementation for Mailchimp capture.",
    )
  }

  const context: MailchimpApiRequestContext = {
    fetchImplementation,
    config: parsedConfig,
    baseUrl,
    authorizationHeader,
    now,
    sleepImplementation,
    runLimited,
  }

  function parseHistoricalPayload(
    payload: MailchimpHistoricalCaptureBatchPayload | Record<string, unknown>,
  ): MailchimpHistoricalCaptureBatchPayload {
    return mailchimpHistoricalCaptureBatchPayloadSchema.parse(
      Object.assign({ maxRecords: DEFAULT_MAX_RECORDS }, payload),
    )
  }

  function parseTransitionPayload(
    payload: MailchimpTransitionCaptureBatchPayload | Record<string, unknown>,
  ): MailchimpTransitionCaptureBatchPayload {
    return mailchimpTransitionCaptureBatchPayloadSchema.parse(
      Object.assign({ maxRecords: DEFAULT_MAX_RECORDS }, payload),
    )
  }

  return {
    async captureHistoricalBatch(payload) {
      const parsedPayload = parseHistoricalPayload(payload)
      const cursor = decodeMailchimpCursor(parsedPayload.cursor)
      const campaignWindow = buildHistoricalCampaignWindow(parsedPayload)
      const campaigns =
        parsedPayload.recordIds.length > 0
          ? await getCampaignsForIds(context, parsedPayload.recordIds)
          : await listSentCampaigns(context, campaignWindow as {
              readonly windowStart: string
              readonly windowEnd: string
            })

      return collectMailchimpBatch({
        campaigns,
        cursor,
        maxRecords: parsedPayload.maxRecords,
        receivedAt: now().toISOString(),
        context,
        mode: "historical",
        payload: parsedPayload,
        config: parsedConfig,
      })
    },

    async captureTransitionBatch(payload) {
      const parsedPayload = parseTransitionPayload(payload)
      const cursor = decodeMailchimpCursor(parsedPayload.cursor)
      const campaignWindow = buildTransitionCampaignWindow(now(), parsedPayload)
      const campaigns =
        parsedPayload.recordIds.length > 0
          ? await getCampaignsForIds(context, parsedPayload.recordIds)
          : await listSentCampaigns(context, campaignWindow)

      return collectMailchimpBatch({
        campaigns,
        cursor,
        maxRecords: parsedPayload.maxRecords,
        receivedAt: now().toISOString(),
        context,
        mode: "transition",
        payload: parsedPayload,
        config: parsedConfig,
      })
    },

    async handleHttpRequest(request) {
      if (!hasBearerToken(request, parsedConfig.bearerToken)) {
        return jsonResponse(401, {
          error: "unauthorized",
        })
      }

      if (request.method !== "POST") {
        return jsonResponse(405, {
          error: "method_not_allowed",
        })
      }

      try {
        const rawPayload = parseJsonRequestBody(request, jsonObjectSchema)

        if (request.path === "/historical") {
          return jsonResponse(
            200,
            await this.captureHistoricalBatch(
              parseHistoricalPayload(
                rawPayload as MailchimpHistoricalCaptureBatchPayload,
              ),
            ),
          )
        }

        if (request.path === "/transition") {
          return jsonResponse(
            200,
            await this.captureTransitionBatch(
              parseTransitionPayload(
                rawPayload as MailchimpTransitionCaptureBatchPayload,
              ),
            ),
          )
        }

        return jsonResponse(404, {
          error: "not_found",
        })
      } catch (error) {
        if (
          error instanceof z.ZodError ||
          error instanceof CaptureServiceBadRequestError
        ) {
          const message =
            error instanceof Error ? error.message : "Invalid request."

          return jsonResponse(400, {
            error: "invalid_request",
            message,
          })
        }

        throw error
      }
    },

    async checkHealth(healthInput) {
      const health = await checkMailchimpCaptureServiceHealth(parsedConfig, {
        fetchImplementation,
        now,
        ...(healthInput?.timeoutMs === undefined
          ? {}
          : { timeoutMs: healthInput.timeoutMs }),
        version: healthInput?.version ?? null,
        lastSuccessAt,
      })

      if (health.status === "healthy") {
        lastSuccessAt = health.checkedAt
      }

      return health
    },
  }
}
