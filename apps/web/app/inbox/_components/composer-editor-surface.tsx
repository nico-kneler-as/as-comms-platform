"use client";

import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, type KeyboardEvent } from "react";

import {
  FOCUS_RING,
  SHADOW,
  TRANSITION,
  TYPE,
} from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sanitizeComposerHtml } from "@/src/lib/html-sanitizer";

import { plaintextToComposerHtml } from "./composer-html";
import {
  ComposerToolbar,
  type ComposerToolbarCommand,
} from "./composer-toolbar";
import { AlertCircleIcon, XIcon } from "./icons";
import { formatBytes, type AttachmentDraft } from "./composer-shared";

function promptForLinkUrl(): string | null {
  const url = window.prompt("Link URL");

  if (url === null) {
    return null;
  }

  const trimmed = url.trim();
  return /^(https?:\/\/|mailto:)/iu.test(trimmed) ? trimmed : null;
}

export function ComposerField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-1.5">
      <span className={`mt-1 w-8 shrink-0 ${TYPE.label}`}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AttachmentRow({
  attachments,
  onRemove,
}: {
  readonly attachments: readonly AttachmentDraft[];
  readonly onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-slate-200 px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <span
            key={attachment.id}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700"
          >
            <span className="font-medium">{attachment.filename}</span>
            <span className="text-slate-500">
              {formatBytes(attachment.size)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${attachment.filename}`}
              className={`inline-flex size-5 items-center justify-center rounded-full text-slate-400 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-200 hover:text-slate-700`}
              onClick={() => {
                onRemove(attachment.id);
              }}
            >
              <XIcon className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export function InlineErrorBanner({
  message,
  retryable,
  onRetry,
}: {
  readonly message: string;
  readonly retryable: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <div className="mx-4 mb-3 flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
      <div className="flex items-start gap-2">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </div>
      {retryable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-rose-200 bg-white text-rose-900 hover:bg-rose-100"
          onClick={onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function RichTextComposerEditor({
  bodyPlaintext,
  errorMessage,
  topSlot,
  bottomSlot,
  onChange,
  onClearErrors,
}: {
  readonly bodyPlaintext: string;
  readonly errorMessage: string | undefined;
  readonly topSlot?: React.ReactNode;
  readonly bottomSlot?: React.ReactNode;
  readonly onChange: (value: {
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
  readonly onClearErrors: () => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        code: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
    ],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Message",
        "aria-multiline": "true",
        ...(errorMessage ? { "aria-invalid": "true" } : {}),
        class: cn(
          "min-h-48 w-full px-4 py-4 text-sm leading-6 text-slate-900 focus:outline-none [&_a]:text-sky-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc",
          errorMessage ? "bg-rose-50/40" : "",
        ),
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange({
        bodyPlaintext: instance.getText().trim(),
        bodyHtml: sanitizeComposerHtml(instance.getHTML()),
      });
      onClearErrors();
    },
  });

  const activeCommands = new Set<ComposerToolbarCommand>();
  if (editor?.isActive("bold") === true) activeCommands.add("bold");
  if (editor?.isActive("italic") === true) activeCommands.add("italic");
  if (editor?.isActive("bulletList") === true) activeCommands.add("bulletList");
  if (editor?.isActive("orderedList") === true)
    activeCommands.add("orderedList");
  if (editor?.isActive("link") === true) activeCommands.add("link");
  if (editor?.isActive("blockquote") === true) activeCommands.add("blockquote");

  const runCommand = useCallback(
    (command: ComposerToolbarCommand) => {
      if (editor === null) {
        return;
      }

      const chain = editor.chain().focus();

      switch (command) {
        case "bold":
          chain.toggleBold().run();
          break;
        case "italic":
          chain.toggleItalic().run();
          break;
        case "bulletList":
          chain.toggleBulletList().run();
          break;
        case "orderedList":
          chain.toggleOrderedList().run();
          break;
        case "link": {
          const url = promptForLinkUrl();
          if (url === null) {
            chain.unsetLink().run();
            break;
          }
          chain.setLink({ href: url }).run();
          break;
        }
        case "blockquote":
          chain.toggleBlockquote().run();
          break;
      }
    },
    [editor],
  );

  useEffect(() => {
    if (editor === null) {
      return;
    }

    const trimmedBodyPlaintext = bodyPlaintext.trim();
    const trimmedEditorText = editor.getText().trim();

    if (trimmedBodyPlaintext.length === 0 && trimmedEditorText.length > 0) {
      editor.commands.clearContent();
      return;
    }

    if (
      trimmedBodyPlaintext.length > 0 &&
      trimmedBodyPlaintext !== trimmedEditorText
    ) {
      editor.commands.setContent(plaintextToComposerHtml(bodyPlaintext), {
        emitUpdate: false,
      });
    }
  }, [bodyPlaintext, editor]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      runCommand("link");
    }
  };

  const showPlaceholder = bodyPlaintext.length === 0;

  return (
    <div className={`border border-slate-200 bg-white ${SHADOW.sm}`}>
      <ComposerToolbar activeCommands={activeCommands} onCommand={runCommand} />
      {topSlot}
      <div className="relative min-h-48" onKeyDown={handleKeyDown}>
        <EditorContent editor={editor} />
        {showPlaceholder ? (
          <span className="pointer-events-none absolute left-4 top-4 text-sm leading-6 text-slate-400">
            Write your message
          </span>
        ) : null}
      </div>
      {bottomSlot}
    </div>
  );
}
