import { describe, expect, it } from "vitest";

import {
  extractInboxContactId,
  getAdjacentFocusedRowContactId,
  getPreferredFocusedRowContactId,
  isEditableShortcutTarget,
  isInboxKeyboardPath
} from "../../app/inbox/_components/inbox-keyboard-helpers";

describe("inbox keyboard helpers", () => {
  it("matches only inbox paths for shortcut handling", () => {
    expect(isInboxKeyboardPath("/inbox")).toBe(true);
    expect(isInboxKeyboardPath("/inbox/contact%3Aone")).toBe(true);
    expect(isInboxKeyboardPath("/settings")).toBe(false);
    expect(isInboxKeyboardPath(null)).toBe(false);
  });

  it("extracts decoded contact ids from inbox detail paths", () => {
    expect(extractInboxContactId("/inbox/contact%3Aone")).toBe(
      "contact:one"
    );
    expect(extractInboxContactId("/inbox")).toBeNull();
    expect(extractInboxContactId("/settings/users")).toBeNull();
  });

  it("treats form fields and contenteditable targets as editable", () => {
    expect(
      isEditableShortcutTarget({
        tagName: "INPUT",
        isContentEditable: false
      })
    ).toBe(true);
    expect(
      isEditableShortcutTarget({
        tagName: "TEXTAREA",
        isContentEditable: false
      })
    ).toBe(true);
    expect(
      isEditableShortcutTarget({
        tagName: "DIV",
        isContentEditable: true
      })
    ).toBe(true);
    expect(
      isEditableShortcutTarget({
        tagName: "BUTTON",
        isContentEditable: false
      })
    ).toBe(false);
  });

  it("prefers the currently focused row, then the active route row", () => {
    expect(
      getPreferredFocusedRowContactId({
        rowContactIds: ["a", "b", "c"],
        currentFocusedContactId: "b",
        activeContactId: "c"
      })
    ).toBe("b");
    expect(
      getPreferredFocusedRowContactId({
        rowContactIds: ["a", "b", "c"],
        currentFocusedContactId: null,
        activeContactId: "c"
      })
    ).toBe("c");
    expect(
      getPreferredFocusedRowContactId({
        rowContactIds: ["a", "b", "c"],
        currentFocusedContactId: "missing",
        activeContactId: "missing"
      })
    ).toBeNull();
  });

  it("moves row focus forward and backward with clamped edges", () => {
    const rowContactIds = ["a", "b", "c"] as const;

    expect(
      getAdjacentFocusedRowContactId({
        rowContactIds,
        currentFocusedContactId: "b",
        activeContactId: null,
        direction: 1
      })
    ).toBe("c");
    expect(
      getAdjacentFocusedRowContactId({
        rowContactIds,
        currentFocusedContactId: "b",
        activeContactId: null,
        direction: -1
      })
    ).toBe("a");
    expect(
      getAdjacentFocusedRowContactId({
        rowContactIds,
        currentFocusedContactId: "c",
        activeContactId: null,
        direction: 1
      })
    ).toBe("c");
    expect(
      getAdjacentFocusedRowContactId({
        rowContactIds,
        currentFocusedContactId: null,
        activeContactId: "b",
        direction: -1
      })
    ).toBe("a");
  });

  it("falls back to the first or last row when nothing is focused yet", () => {
    const rowContactIds = ["a", "b", "c"] as const;

    expect(
      getAdjacentFocusedRowContactId({
        rowContactIds,
        currentFocusedContactId: null,
        activeContactId: null,
        direction: 1
      })
    ).toBe("a");
    expect(
      getAdjacentFocusedRowContactId({
        rowContactIds,
        currentFocusedContactId: null,
        activeContactId: null,
        direction: -1
      })
    ).toBe("c");
  });
});
