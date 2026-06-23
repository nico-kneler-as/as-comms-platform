import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export class PhoneE164NormalizationError extends Error {
  readonly input: string;

  constructor(input: string) {
    super(`Could not normalize phone number to E.164: ${input}`);
    this.name = "PhoneE164NormalizationError";
    this.input = input;
  }
}

export function tryNormalizePhoneE164(
  input: string,
  defaultRegion = "US",
): string | null {
  const parsed = parsePhoneNumberFromString(
    input,
    defaultRegion.toUpperCase() as CountryCode,
  );

  return parsed?.isValid() === true ? parsed.number : null;
}

export function normalizePhoneE164(
  input: string,
  defaultRegion = "US",
): string {
  const normalized = tryNormalizePhoneE164(input, defaultRegion);

  if (normalized === null) {
    throw new PhoneE164NormalizationError(input);
  }

  return normalized;
}

export function toE164(input: string, defaultRegion = "US"): string | null {
  return tryNormalizePhoneE164(input, defaultRegion);
}

export function parseAreaCode(e164: string): string | null {
  const parsed = parsePhoneNumberFromString(e164);

  if (parsed?.isValid() !== true || !parsed.number.startsWith("+1")) {
    return null;
  }

  const match = /^\+1([2-9]\d{2})\d{7}$/.exec(parsed.number);
  return match?.[1] ?? null;
}
