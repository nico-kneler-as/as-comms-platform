import {
  DEFAULT_SMS_OPT_OUT_FOOTER,
  smsMetrics,
  type SmsMetrics,
} from "./sms-segments.js";

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/gu;
const SUPPORTED_SMS_MERGE_TOKENS = ["firstName", "email"] as const;
const SUPPORTED_SMS_MERGE_TOKEN_SET = new Set<SmsMergeToken>(
  SUPPORTED_SMS_MERGE_TOKENS,
);

export type SmsMergeToken = "firstName" | "email";

export interface SmsMergeContext {
  readonly firstName: string | null;
  readonly email: string | null;
}

export interface RenderedSmsBroadcast {
  readonly body: string;
  readonly metrics: SmsMetrics;
}

function readTokenValue(
  context: SmsMergeContext,
  token: string,
): string | null {
  switch (token) {
    case "firstName":
      return context.firstName;
    case "email":
      return context.email;
    default:
      return null;
  }
}

function renderSmsTemplate(
  template: string,
  context: SmsMergeContext,
): string {
  return template.replace(TOKEN_PATTERN, (_match, rawToken: string) => {
    return readTokenValue(context, rawToken) ?? "";
  });
}

export function renderSmsBroadcast(input: {
  readonly template: string;
  readonly context: SmsMergeContext;
  readonly optOutFooter?: string;
}): RenderedSmsBroadcast {
  const merged = renderSmsTemplate(input.template, input.context);
  const footer = input.optOutFooter ?? DEFAULT_SMS_OPT_OUT_FOOTER;
  const body = footer === "" ? merged : `${merged} ${footer}`;

  return {
    body,
    metrics: smsMetrics(body),
  };
}

export function findMissingSmsMergeTokens(
  template: string,
  context: SmsMergeContext,
): readonly SmsMergeToken[] {
  const missingTokens = new Set<SmsMergeToken>();

  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1];

    if (
      token !== undefined &&
      SUPPORTED_SMS_MERGE_TOKEN_SET.has(token as SmsMergeToken) &&
      readTokenValue(context, token) === null
    ) {
      missingTokens.add(token as SmsMergeToken);
    }
  }

  return [...missingTokens];
}
