import { randomUUID } from "node:crypto";

export type CliFlagValue = string | boolean;
export type CliFlags = Record<string, CliFlagValue>;

export function parseCliFlags(args: readonly string[]): CliFlags {
  const flags: CliFlags = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === undefined) {
      continue;
    }

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const nextToken = args[index + 1];

    if (nextToken === undefined || nextToken.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = nextToken;
    index += 1;
  }

  return flags;
}

export function readRequiredFlag(flags: CliFlags, key: string): string {
  const value = flags[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required flag --${key}.`);
  }

  return value.trim();
}

export function readOptionalStringFlag(
  flags: CliFlags,
  key: string
): string | null {
  const value = flags[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readOptionalStringArrayFlag(
  flags: CliFlags,
  key: string
): string[] {
  const value = readOptionalStringFlag(flags, key);

  if (value === null) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function readOptionalBooleanFlag(
  flags: CliFlags,
  key: string,
  defaultValue: boolean
): boolean {
  const value = flags[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Flag --${key} must be true or false.`);
}

export function readOptionalIntegerFlag(
  flags: CliFlags,
  key: string,
  defaultValue: number
): number {
  const value = readOptionalStringFlag(flags, key);

  if (value === null) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Flag --${key} must be a positive integer.`);
  }

  return parsed;
}

export function buildOperationId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}
