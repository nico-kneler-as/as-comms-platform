export type BroadcastActivityBotReason = "machine_user_agent" | "fast_activity";

export interface BroadcastActivityClassifierInput {
  /** Raw user-agent from the Postmark Open/Click event (may be null/empty). */
  readonly userAgent: string | null;
  /** Postmark "Platform" field, e.g. "Desktop" | "Mobile" | "WebMail" (may be null). */
  readonly platform: string | null;
  /** When the open/click occurred (Postmark ReceivedAt). Accept Date or ISO string. */
  readonly occurredAt: Date | string;
  /** When the message was delivered, if known (Postmark DeliveredAt). null when unknown. */
  readonly deliveredAt: Date | string | null;
}

export interface BroadcastActivityClassification {
  readonly isBot: boolean;
  readonly reason: BroadcastActivityBotReason | null;
}

const MACHINE_USER_AGENT_TOKENS: readonly string[] = [
  "safelinks",
  "atpimages",
  "proofpoint",
  "urldefense",
  "mimecast",
  "barracuda",
  "symantec",
  "messagelabs",
  "fireeye",
  "forcepoint",
  "cloudmark",
  "googleimageproxy",
  "ggpht.com",
  "yahoomailproxy",
  "slackbot",
  "slack-imgproxy",
  "facebookexternalhit",
  "whatsapp",
  "telegrambot",
  "linkpreview",
  "skypeuripreview",
  "bingpreview",
  "curl",
  "wget",
  "python-requests",
  "python-urllib",
  "go-http-client",
  "okhttp",
  "java/",
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "bot",
  "crawler",
  "spider",
];

// Humans do not receive, render, and interact with an email within two seconds.
const FAST_ACTIVITY_THRESHOLD_MS = 2000;

function matchesMachineUserAgent(userAgent: string | null): boolean {
  const normalizedUserAgent = userAgent?.trim().toLowerCase() ?? "";

  if (normalizedUserAgent.length === 0) {
    return false;
  }

  return MACHINE_USER_AGENT_TOKENS.some((token) =>
    normalizedUserAgent.includes(token),
  );
}

function toTimestamp(value: Date | string | null): number | null {
  if (value === null) {
    return null;
  }

  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function isFastActivity(
  occurredAt: Date | string,
  deliveredAt: Date | string | null,
): boolean {
  const deliveredTimestamp = toTimestamp(deliveredAt);

  if (deliveredTimestamp === null) {
    return false;
  }

  const occurredTimestamp = toTimestamp(occurredAt);

  if (occurredTimestamp === null) {
    return false;
  }

  const deltaMs = occurredTimestamp - deliveredTimestamp;

  if (deltaMs < 0) {
    return false;
  }

  return deltaMs <= FAST_ACTIVITY_THRESHOLD_MS;
}

export function classifyBroadcastActivity(
  input: BroadcastActivityClassifierInput,
): BroadcastActivityClassification {
  const machineUserAgent = matchesMachineUserAgent(input.userAgent);

  if (machineUserAgent) {
    return {
      isBot: true,
      reason: "machine_user_agent",
    };
  }

  if (isFastActivity(input.occurredAt, input.deliveredAt)) {
    return {
      isBot: true,
      reason: "fast_activity",
    };
  }

  return {
    isBot: false,
    reason: null,
  };
}
