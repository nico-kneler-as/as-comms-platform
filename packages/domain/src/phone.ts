import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function toE164(input: string, defaultRegion = "US"): string | null {
  const parsed = parsePhoneNumberFromString(
    input,
    defaultRegion.toUpperCase() as CountryCode,
  );

  return parsed?.isValid() === true ? parsed.number : null;
}

export function parseAreaCode(e164: string): string | null {
  const parsed = parsePhoneNumberFromString(e164);

  if (parsed?.isValid() !== true || !parsed.number.startsWith("+1")) {
    return null;
  }

  const match = /^\+1([2-9]\d{2})\d{7}$/.exec(parsed.number);
  return match?.[1] ?? null;
}
