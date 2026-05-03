import type { ChangeEvent, Dispatch } from "react";

import type { ComposerDraftAction } from "./composer-draft-reducer";
import {
  readFileAsAttachment,
  type ComposerFieldErrors,
} from "../_components/composer-shared";

const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const TOTAL_ATTACHMENT_ERROR = "Attachments can't exceed 20 MB total.";

export function useAttachmentIntake({
  attachmentBytes,
  dispatch,
  setComposerErrors,
}: {
  readonly attachmentBytes: number;
  readonly dispatch: Dispatch<ComposerDraftAction>;
  readonly setComposerErrors: (errors: ComposerFieldErrors) => void;
}) {
  return async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files === null || files.length === 0) {
      event.currentTarget.value = "";
      return;
    }

    const selectedFiles = Array.from(files);
    event.currentTarget.value = "";
    const nextTotalBytes =
      attachmentBytes +
      selectedFiles.reduce((total, file) => total + file.size, 0);

    if (nextTotalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      const fieldErrors = [
        {
          field: "attachments",
          message: TOTAL_ATTACHMENT_ERROR,
        },
      ] as const;
      dispatch({
        type: "SET_ERRORS",
        inlineError: {
          message: TOTAL_ATTACHMENT_ERROR,
          retryable: false,
        },
        fieldErrors,
      });
      setComposerErrors(fieldErrors);
      return;
    }

    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map((file) => readFileAsAttachment(file)),
      );
      dispatch({
        type: "ADD_ATTACHMENTS",
        attachments: nextAttachments,
      });
      setComposerErrors([]);
    } catch {
      dispatch({
        type: "SET_INLINE_ERROR",
        error: {
          message: "We couldn't read one of those files. Please try again.",
          retryable: true,
        },
      });
    }
  };
}
