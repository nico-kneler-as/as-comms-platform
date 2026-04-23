import { z } from "zod";

import type {
  InboxComposerAliasOption,
  InboxComposerReplyContext
} from "./view-models";

const emailSchema = z.string().email();

export type ComposerPaneState =
  | {
      readonly mode: "closed";
    }
  | {
      readonly mode: "new-draft";
    }
  | {
      readonly mode: "replying";
      readonly replyContext: InboxComposerReplyContext;
    };

export type ComposerPaneAction =
  | {
      readonly type: "open-new-draft";
    }
  | {
      readonly type: "open-reply";
      readonly replyContext: InboxComposerReplyContext;
    }
  | {
      readonly type: "close";
    };

export function reduceComposerPane(
  _state: ComposerPaneState,
  action: ComposerPaneAction
): ComposerPaneState {
  switch (action.type) {
    case "open-new-draft":
      return {
        mode: "new-draft"
      };
    case "open-reply":
      return {
        mode: "replying",
        replyContext: action.replyContext
      };
    case "close":
      return {
        mode: "closed"
      };
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function formatContactRecipientLabel(input: {
  readonly displayName: string;
  readonly primaryEmail: string | null;
}): string {
  if (input.primaryEmail === null) {
    return input.displayName;
  }

  return `${input.displayName} (${input.primaryEmail})`;
}

export function resolveTypedEmailRecipient(input: {
  readonly query: string;
  readonly results: readonly {
    readonly primaryEmail: string | null;
  }[];
}): {
  readonly kind: "email";
  readonly emailAddress: string;
} | null {
  const trimmedQuery = input.query.trim();

  if (trimmedQuery.length === 0) {
    return null;
  }

  const parsedEmail = emailSchema.safeParse(trimmedQuery);

  if (!parsedEmail.success) {
    return null;
  }

  const normalizedQuery = normalizeEmail(trimmedQuery);
  const hasExactMatch = input.results.some(
    (result) =>
      result.primaryEmail !== null &&
      normalizeEmail(result.primaryEmail) === normalizedQuery
  );

  if (hasExactMatch) {
    return null;
  }

  return {
    kind: "email",
    emailAddress: normalizedQuery
  };
}

export function resolveDefaultAlias(input: {
  readonly recipient:
    | {
        readonly kind: string;
        readonly primaryProjectName?: string | null;
      }
    | null;
  readonly aliases: readonly InboxComposerAliasOption[];
}): string | null {
  const recipient = input.recipient;

  if (recipient?.kind !== "contact" || recipient.primaryProjectName === null) {
    return null;
  }

  const primaryProjectName = recipient.primaryProjectName;

  return (
    input.aliases.find((alias) => alias.projectName === primaryProjectName)
      ?.alias ?? null
  );
}

export function isComposerSendDisabled(input: {
  readonly activeTab: "email" | "note";
  readonly recipient: { readonly kind: string } | null;
  readonly selectedAlias: string | null;
  readonly subject: string;
  readonly body: string;
  readonly isSending: boolean;
}): boolean {
  return (
    input.activeTab !== "email" ||
    input.recipient === null ||
    input.selectedAlias === null ||
    input.subject.trim().length === 0 ||
    input.body.trim().length === 0 ||
    input.isSending
  );
}
