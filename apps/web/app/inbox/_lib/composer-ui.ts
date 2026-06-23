import { z } from "zod";

import type {
  InboxComposerAliasOption,
  InboxComposerForwardContext,
  InboxComposerReplyContext,
  InboxSmsSenderOption,
} from "./view-models";

const emailSchema = z.string().email();

export type ComposerPaneState =
  | {
      readonly mode: "closed";
    }
  | {
      readonly mode: "new-draft";
      readonly initialTab?: "email";
    }
  | {
      readonly mode: "replying";
      readonly replyContext: InboxComposerReplyContext;
      readonly initialTab?: "email" | "sms" | "note";
    }
  | {
      readonly mode: "forwarding";
      readonly forwardContext: InboxComposerForwardContext;
      readonly initialTab?: "email";
    };

export type ComposerSendKind = "send" | "send-and-save";

export type ComposerPaneAction =
  | {
      readonly type: "open-new-draft";
    }
  | {
      readonly type: "open-reply";
      readonly replyContext: InboxComposerReplyContext;
      readonly initialTab?: "email" | "sms" | "note";
    }
  | {
      readonly type: "open-forward";
      readonly forwardContext: InboxComposerForwardContext;
      readonly initialTab?: "email";
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
        mode: "new-draft",
        initialTab: "email",
      };
    case "open-reply":
      return {
        mode: "replying",
        replyContext: action.replyContext,
        initialTab:
          action.initialTab ??
          resolveReplyInitialTab({
            replyContext: action.replyContext,
          }),
      };
    case "open-forward":
      return {
        mode: "forwarding",
        forwardContext: action.forwardContext,
        initialTab: action.initialTab ?? "email",
      };
    case "close":
      return {
        mode: "closed"
      };
  }
}

export function resolveReplyInitialTab(input: {
  readonly replyContext: InboxComposerReplyContext;
}): "email" | "sms" {
  return input.replyContext.defaultChannel === "sms" ? "sms" : "email";
}

export function resolveDefaultSmsSenderId(input: {
  readonly smsSenders: readonly InboxSmsSenderOption[];
}): string | null {
  return input.smsSenders[0]?.id ?? null;
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
  // When exactly one alias is available, always auto-select it —
  // the operator can't send from anywhere else.
  if (input.aliases.length === 1) {
    return input.aliases[0]?.alias ?? null;
  }

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

export function resolveProjectAliasOverride(input: {
  readonly projectIds: readonly (string | null | undefined)[];
  readonly aliases: readonly InboxComposerAliasOption[];
}): string | null {
  const projectIds = input.projectIds.filter(
    (projectId): projectId is string =>
      typeof projectId === "string" && projectId.length > 0,
  );

  if (projectIds.length === 0) {
    return null;
  }

  return (
    input.aliases.find((alias) => projectIds.includes(alias.projectId))?.alias ??
    null
  );
}

export function isComposerSendDisabled(input: {
  readonly activeTab: "email" | "sms" | "note";
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

export function resolveComposerSendActionFlags(input: {
  readonly sendKind: ComposerSendKind;
}): {
  readonly saveAsKnowledge: boolean;
} {
  return {
    saveAsKnowledge: input.sendKind === "send-and-save",
  };
}

export function resolveSendAndSaveForAiAvailability(input: {
  readonly selectedAlias: string | null;
  readonly aliases: readonly InboxComposerAliasOption[];
}): {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
} {
  if (input.selectedAlias === null) {
    return {
      enabled: false,
      disabledReason: null,
    };
  }

  const selectedAliasRecord =
    input.aliases.find((alias) => alias.alias === input.selectedAlias) ?? null;

  if (selectedAliasRecord === null) {
    return {
      enabled: false,
      disabledReason: "AI is not configured for this project.",
    };
  }

  const hasAiReadyAlias = input.aliases.some(
    (alias) =>
      alias.projectId === selectedAliasRecord.projectId && alias.isAiReady,
  );

  return {
    enabled: hasAiReadyAlias,
    disabledReason: hasAiReadyAlias
      ? null
      : "AI is not configured for this project.",
  };
}

export function resolveSmsSendAndSaveForAiAvailability(input: {
  readonly selectedAlias: string | null;
  readonly aliases: readonly InboxComposerAliasOption[];
  readonly smsRecipientKind: "contact" | "phone" | null;
}): {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
} {
  if (input.smsRecipientKind === "phone") {
    return {
      enabled: false,
      disabledReason:
        "Project knowledge capture requires a known contact with project context.",
    };
  }

  return resolveSendAndSaveForAiAvailability({
    selectedAlias: input.selectedAlias,
    aliases: input.aliases,
  });
}
