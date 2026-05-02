import type { UserRecord, UsersRepository } from "@as-comms/domain";

export function resolveBackfillProfileName(input: {
  readonly profileName: string | null | undefined;
  readonly userName: string | null | undefined;
}): string | null {
  const profileName = normalizeName(input.profileName);
  if (profileName !== null) {
    return profileName;
  }

  return normalizeName(input.userName);
}

export async function backfillUserNameOnSignIn(input: {
  readonly record: UserRecord | null;
  readonly profileName: string | null | undefined;
  readonly userName: string | null | undefined;
  readonly usersRepository: Pick<UsersRepository, "updateName">;
  readonly logWarn?: typeof console.warn;
}): Promise<void> {
  const { record } = input;
  if (record === null) {
    return;
  }

  const nextName = resolveBackfillProfileName({
    profileName: input.profileName,
    userName: input.userName,
  });
  const existingName = normalizeName(record.name);

  if (nextName === null || existingName !== null || nextName === record.name) {
    return;
  }

  try {
    await input.usersRepository.updateName(record.id, nextName);
  } catch (cause) {
    (input.logWarn ?? console.warn)("auth.signIn name backfill failed", {
      userId: record.id,
      cause,
    });
  }
}

function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
