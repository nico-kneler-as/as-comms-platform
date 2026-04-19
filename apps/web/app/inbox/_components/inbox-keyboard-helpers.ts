export const INBOX_ROW_SELECTOR =
  '[data-inbox-row="true"][data-contact-id]';

export const INBOX_SEARCH_INPUT_SELECTOR =
  '[data-inbox-search-input="true"]';

export const INBOX_FOLLOW_UP_TOGGLE_SELECTOR =
  '[data-inbox-follow-up-toggle="true"]';

export type InboxRowDirection = 1 | -1;

export interface ShortcutTargetMeta {
  readonly tagName: string | null;
  readonly isContentEditable: boolean;
}

export function isInboxKeyboardPath(pathname: string | null): boolean {
  return pathname === "/inbox" || pathname?.startsWith("/inbox/") === true;
}

export function extractInboxContactId(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/inbox\/([^/]+)/.exec(pathname);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return match[1] ?? null;
  }
}

export function isEditableShortcutTarget(
  target: ShortcutTargetMeta
): boolean {
  if (target.isContentEditable) {
    return true;
  }

  switch (target.tagName) {
    case "INPUT":
    case "TEXTAREA":
    case "SELECT":
      return true;
    default:
      return false;
  }
}

export function getPreferredFocusedRowContactId(input: {
  readonly rowContactIds: readonly string[];
  readonly currentFocusedContactId: string | null;
  readonly activeContactId: string | null;
}): string | null {
  const {
    rowContactIds,
    currentFocusedContactId,
    activeContactId
  } = input;

  if (rowContactIds.length === 0) {
    return null;
  }

  if (
    currentFocusedContactId &&
    rowContactIds.includes(currentFocusedContactId)
  ) {
    return currentFocusedContactId;
  }

  if (activeContactId && rowContactIds.includes(activeContactId)) {
    return activeContactId;
  }

  return null;
}

export function getAdjacentFocusedRowContactId(input: {
  readonly rowContactIds: readonly string[];
  readonly currentFocusedContactId: string | null;
  readonly activeContactId: string | null;
  readonly direction: InboxRowDirection;
}): string | null {
  const {
    rowContactIds,
    currentFocusedContactId,
    activeContactId,
    direction
  } = input;

  if (rowContactIds.length === 0) {
    return null;
  }

  const preferredContactId = getPreferredFocusedRowContactId({
    rowContactIds,
    currentFocusedContactId,
    activeContactId
  });

  if (preferredContactId === null) {
    return direction === 1
      ? (rowContactIds[0] ?? null)
      : (rowContactIds[rowContactIds.length - 1] ?? null);
  }

  const currentIndex = rowContactIds.indexOf(preferredContactId);
  const nextIndex = Math.min(
    rowContactIds.length - 1,
    Math.max(0, currentIndex + direction)
  );

  return rowContactIds[nextIndex] ?? null;
}

