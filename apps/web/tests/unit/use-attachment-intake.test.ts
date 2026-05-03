import { describe, expect, it, vi } from "vitest";
import type { ChangeEvent } from "react";

import { useAttachmentIntake } from "../../app/inbox/_hooks/use-attachment-intake";

function makeEvent(files: readonly { readonly size: number }[]) {
  return {
    currentTarget: {
      files: {
        length: files.length,
        item: (index: number) => files[index] ?? null,
        [Symbol.iterator]: function* () {
          yield* files;
        },
      },
      value: "selected",
    },
  } as unknown as ChangeEvent<HTMLInputElement>;
}

describe("useAttachmentIntake", () => {
  it("enforces the 20 MB attachment cap", async () => {
    const dispatch = vi.fn();
    const setComposerErrors = vi.fn();
    const handleFilesSelected = useAttachmentIntake({
      attachmentBytes: 20 * 1024 * 1024,
      dispatch,
      setComposerErrors,
    });
    const event = makeEvent([{ size: 1 }]);

    await handleFilesSelected(event);

    expect(event.currentTarget.value).toBe("");
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_ERRORS",
      inlineError: {
        message: "Attachments can't exceed 20 MB total.",
        retryable: false,
      },
      fieldErrors: [
        {
          field: "attachments",
          message: "Attachments can't exceed 20 MB total.",
        },
      ],
    });
    expect(setComposerErrors).toHaveBeenCalledWith([
      {
        field: "attachments",
        message: "Attachments can't exceed 20 MB total.",
      },
    ]);
  });

  it("treats an empty picker change as cancel", async () => {
    const dispatch = vi.fn();
    const handleFilesSelected = useAttachmentIntake({
      attachmentBytes: 0,
      dispatch,
      setComposerErrors: vi.fn(),
    });
    const event = makeEvent([]);

    await handleFilesSelected(event);

    expect(event.currentTarget.value).toBe("");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
