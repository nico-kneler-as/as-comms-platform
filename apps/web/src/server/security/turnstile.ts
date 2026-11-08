import type { WebEnv } from "@/src/server/env";

export type TurnstileMode = "off" | "log" | "enforce";

export interface TurnstileVerificationResult {
  readonly outcome: "valid" | "invalid" | "error";
  readonly errorCodes: readonly string[];
}

type TurnstileEnv = Pick<
  WebEnv,
  | "TURNSTILE_SECRET_KEY"
  | "NEWSLETTER_SIGNUP_ALLOWED_ORIGIN"
  | "NEWSLETTER_SIGNUP_TURNSTILE_MODE"
>;

interface TurnstileSiteverifyResponse {
  readonly success?: unknown;
  readonly hostname?: unknown;
  readonly ["error-codes"]?: unknown;
}

function readErrorCodes(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === "string")
    : [];
}

/**
 * The configured mode, downgraded safely when enforcing would be impossible.
 * The caller is responsible for emitting the per-request misconfiguration log.
 */
export function resolveTurnstileMode(env: TurnstileEnv): TurnstileMode {
  return env.NEWSLETTER_SIGNUP_TURNSTILE_MODE === "enforce" &&
    env.TURNSTILE_SECRET_KEY === undefined
    ? "log"
    : env.NEWSLETTER_SIGNUP_TURNSTILE_MODE;
}

export async function verifyTurnstile(input: {
  readonly env: TurnstileEnv;
  readonly token: string;
  readonly remoteIp: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<TurnstileVerificationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    secret: input.env.TURNSTILE_SECRET_KEY ?? "",
    response: input.token,
    remoteip: input.remoteIp,
  });

  try {
    const response = await fetchImpl(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      return { outcome: "error", errorCodes: [] };
    }

    const payload = (await response.json()) as TurnstileSiteverifyResponse;
    const errorCodes = readErrorCodes(payload["error-codes"]);
    const expectedHostname = new URL(input.env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN)
      .hostname;
    const isValid =
      payload.success === true && payload.hostname === expectedHostname;

    return {
      outcome: isValid ? "valid" : "invalid",
      errorCodes,
    };
  } catch {
    return { outcome: "error", errorCodes: [] };
  }
}
