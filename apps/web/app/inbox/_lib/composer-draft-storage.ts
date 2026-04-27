const MAX_LOCAL_STORAGE_BYTES = 4 * 1024 * 1024;
const DRAFT_KEY_PREFIX = "composer-draft:v1:";

export interface StoredComposerDraft {
  readonly subject: string;
  readonly bodyPlaintext: string;
  readonly bodyHtml: string;
  readonly selectedAlias: string | null;
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly attachments: readonly {
    readonly filename: string;
    readonly size: number;
    readonly contentType: string;
  }[];
  readonly updatedAt: number;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function estimateStorageBytes(storage: Storage): number {
  let total = 0;

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (key === null) {
      continue;
    }

    const value = storage.getItem(key) ?? "";
    total += (key.length + value.length) * 2;
  }

  return total;
}

function pruneIfTooLarge(storage: Storage): void {
  while (estimateStorageBytes(storage) > MAX_LOCAL_STORAGE_BYTES) {
    let oldestKey: string | null = null;
    let oldestUpdatedAt = Number.POSITIVE_INFINITY;

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (!key?.startsWith(DRAFT_KEY_PREFIX)) {
        continue;
      }

      const value = storage.getItem(key);
      if (value === null) {
        continue;
      }

      try {
        const parsed = JSON.parse(value) as Partial<StoredComposerDraft>;
        const updatedAt =
          typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;

        if (updatedAt < oldestUpdatedAt) {
          oldestUpdatedAt = updatedAt;
          oldestKey = key;
        }
      } catch {
        oldestKey = key;
        oldestUpdatedAt = Number.NEGATIVE_INFINITY;
      }
    }

    if (oldestKey === null) {
      return;
    }

    storage.removeItem(oldestKey);
  }
}

export function saveDraft(
  key: string,
  draft: Omit<StoredComposerDraft, "updatedAt">,
): void {
  const storage = getStorage();

  if (storage === null) {
    return;
  }

  storage.setItem(
    key,
    JSON.stringify({
      ...draft,
      updatedAt: Date.now(),
    } satisfies StoredComposerDraft),
  );
  pruneIfTooLarge(storage);
}

export function loadDraft(key: string): StoredComposerDraft | null {
  const storage = getStorage();

  if (storage === null) {
    return null;
  }

  const value = storage.getItem(key);

  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as StoredComposerDraft;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearDraft(key: string): void {
  const storage = getStorage();

  if (storage === null) {
    return;
  }

  storage.removeItem(key);
}
