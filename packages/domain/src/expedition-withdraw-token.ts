import { createHmac, timingSafeEqual } from "node:crypto";

const tokenPrefix = "w1";
const salesforceIdPattern = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/u;

export interface ExpeditionWithdrawTokenPayload {
  readonly expeditionMemberId: string;
  readonly projectId: string;
}

function isValidSecret(secret: string): boolean {
  return secret.trim().length >= 32;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Creates the opaque, signed token used by public project-withdraw links. */
export function createExpeditionWithdrawToken(input: ExpeditionWithdrawTokenPayload & {
  readonly expiresAt: Date;
  readonly secret: string;
}): string {
  if (
    !isValidSecret(input.secret) ||
    !salesforceIdPattern.test(input.expeditionMemberId) ||
    !salesforceIdPattern.test(input.projectId) ||
    !Number.isSafeInteger(Math.floor(input.expiresAt.getTime() / 1_000))
  ) {
    throw new Error("Invalid expedition withdraw token input.");
  }

  const expiresAt = Math.floor(input.expiresAt.getTime() / 1_000);
  const unsigned = [
    tokenPrefix,
    input.expeditionMemberId,
    input.projectId,
    String(expiresAt),
  ].join(".");
  return `${unsigned}.${sign(unsigned, input.secret)}`;
}

/** Verifies a public withdraw token without allowing the GET request to mutate state. */
export function verifyExpeditionWithdrawToken(
  token: string,
  input: { readonly secret: string; readonly now: Date },
): ExpeditionWithdrawTokenPayload | null {
  if (!isValidSecret(input.secret)) return null;

  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [prefix, expeditionMemberId, projectId, expiresAtRaw, signature] = parts;
  if (
    prefix !== tokenPrefix ||
    expeditionMemberId === undefined ||
    projectId === undefined ||
    expiresAtRaw === undefined ||
    signature === undefined ||
    !salesforceIdPattern.test(expeditionMemberId) ||
    !salesforceIdPattern.test(projectId) ||
    !/^\d+$/u.test(expiresAtRaw)
  ) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(input.now.getTime() / 1_000)) {
    return null;
  }

  // Compare the exact base64url text, not decoded bytes: base64url decoding
  // ignores the unused low bits of the last character, so a decoded compare
  // would accept a slightly altered signature.
  const expected = sign(parts.slice(0, -1).join("."), input.secret);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  return { expeditionMemberId, projectId };
}

export function isSalesforceRecordId(value: string): boolean {
  return salesforceIdPattern.test(value);
}
