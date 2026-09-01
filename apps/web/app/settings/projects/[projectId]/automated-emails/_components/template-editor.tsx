"use client";

import LinkExtension from "@tiptap/extension-link";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { AUTOMATED_EMAIL_MERGE_FIELDS } from "@as-comms/domain/automated-email-merge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bold,
  Check,
  ChevronLeft,
  Clock3,
  Copy,
  Eye,
  Info,
  Italic,
  Link2,
  List,
  Quote,
  RefreshCw,
  Send,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  COMPOSER_LINK_SCHEMES,
  COMPOSER_LINK_SCHEME_PREFIXES_REGEX,
  isAllowedComposerLinkHref,
} from "@/src/lib/composer-link-schemes";
import type { AutomatedEmailEditorViewModel } from "@/src/server/automated-email/selectors";
import { AUTOMATED_EMAIL_SEND_STATUS_META } from "@/src/lib/automated-email-send-presentation";

import {
  publishTemplateAction,
  renameTemplateAction,
  renderPreviewAction,
  saveDraftAction,
  sendTestAction,
  setTemplateActiveAction,
} from "../actions";
import { MergeFieldExtension, mergeFieldLabel } from "./merge-field-extension";

type EditorTab = "content" | "send-log";
type SamplePerson = "nico" | "selah";

const SAMPLE_PEOPLE: readonly {
  readonly id: SamplePerson;
  readonly name: string;
}[] = [
  { id: "nico", name: "Nico" },
  { id: "selah", name: "Selah" },
];

function promptForLinkUrl(): string | null {
  const value = window.prompt("Link URL");
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (COMPOSER_LINK_SCHEME_PREFIXES_REGEX.test(trimmed)) {
    return trimmed;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) {
    return `mailto:${trimmed}`;
  }
  if (!/\s/u.test(trimmed) && trimmed.includes(".")) {
    return `https://${trimmed}`;
  }

  window.alert(
    `"${trimmed}" doesn't look like a valid URL. Use https://, http://, mailto:, sms:, or tel:.`,
  );
  return null;
}

function relativeTime(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${String(Math.floor(seconds / 3600))}h ago`;
  return `${String(Math.floor(seconds / 86400))}d ago`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function initialDoc(doc: unknown): JSONContent {
  if (
    doc !== null &&
    typeof doc === "object" &&
    !Array.isArray(doc) &&
    "type" in doc &&
    (doc as { readonly type?: unknown }).type === "doc"
  ) {
    return doc as JSONContent;
  }
  return { type: "doc", content: [] };
}

function CopyIdChip({ id }: { readonly id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => { setCopied(false); }, 1400);
    return () => { window.clearTimeout(timeout); };
  }, [copied]);

  return (
    <button
      type="button"
      title="Copy template ID"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
      className="group inline-flex h-6 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/80 pl-2 pr-1.5 font-mono text-[11px] tracking-tight text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      {id}
      {copied ? (
        <Check className="size-3 text-emerald-600" />
      ) : (
        <Copy className="size-3 opacity-60 group-hover:opacity-100" />
      )}
      <span
        className={cn(
          "overflow-hidden text-[10px] font-semibold uppercase tracking-wide text-emerald-600 transition-all",
          copied ? "w-[42px] opacity-100" : "w-0 opacity-0",
        )}
      >
        copied
      </span>
    </button>
  );
}

function SendingChip({ active }: { readonly active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        active
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-slate-200",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-slate-300",
        )}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function WebhookIndicator({
  value,
  showLabel = false,
}: {
  readonly value: string | null;
  readonly showLabel?: boolean;
}) {
  const relative = relativeTime(value);
  return (
    <span
      title={
        value === null
          ? "No webhook has ever reached this template. Normal until the Salesforce flow is wired."
          : `Last webhook received ${new Date(value).toLocaleString()}`
      }
      className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500"
    >
      <Clock3 className={cn("size-3", value === null && "opacity-50")} />
      <span
        className={cn(
          value === null
            ? "decoration-dotted underline underline-offset-2 decoration-slate-400/50 text-slate-400"
            : "text-slate-700",
        )}
      >
        {showLabel && value !== null ? "Webhook " : ""}
        {relative ?? "No webhook yet"}
      </span>
    </span>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(event) => { event.preventDefault(); }}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
        active && "bg-slate-200 text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

function MergeFieldMenu({
  onInsert,
}: {
  readonly onInsert: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[12px] text-sky-700 hover:bg-sky-50 hover:text-sky-800"
        >
          <span className="font-mono text-[11px]">{"{{ }}"}</span> Insert field
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-1">
        <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Merge fields
        </p>
        {AUTOMATED_EMAIL_MERGE_FIELDS.map((field) => (
          <button
            key={field.key}
            type="button"
            onClick={() => {
              onInsert(field.key);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
          >
            <span className="text-[12.5px] text-slate-900">{field.label}</span>
            <span className="font-mono text-[10.5px] text-slate-400">
              {field.key === "firstName"
                ? "Nico"
                : field.key === "lastName"
                  ? "Ortiz"
                  : field.key === "email"
                    ? "nico.ortiz@gmail.com"
                    : "Project name"}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function SendingStrip({
  active,
  hasPublishedCopy,
  onChange,
  disabled,
}: {
  readonly active: boolean;
  readonly hasPublishedCopy: boolean;
  readonly onChange: (active: boolean) => void;
  readonly disabled: boolean;
}) {
  const holding = active && !hasPublishedCopy;
  return (
    <div
      className={cn(
        "border-t-2 px-5 py-3.5 transition-colors",
        holding
          ? "border-rose-300 bg-rose-50/60"
          : active
            ? "border-emerald-300 bg-emerald-50/50"
            : "border-slate-200 bg-slate-50/80",
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
            holding
              ? "bg-rose-100 text-rose-700 ring-rose-200"
              : active
                ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                : "bg-white text-slate-500 ring-slate-200",
          )}
        >
          <Send className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Sending{" "}
            <span className="normal-case font-normal tracking-normal">
              — separate from publishing
            </span>
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-slate-700">
            {holding ? (
              <>
                <span className="font-medium text-rose-700">
                  Active with no published copy.
                </span>{" "}
                Incoming webhooks are being held, not sent. Publish the draft to
                release them.
              </>
            ) : active ? (
              <>
                <span className="font-medium text-emerald-800">
                  Active templates send real email when Salesforce fires.
                </span>{" "}
                Turning this off holds new webhooks as dry runs.
              </>
            ) : (
              <>
                Inactive. Webhooks still arrive and appear in the send log as
                dry runs — nothing leaves the building.
              </>
            )}
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2.5">
          <span
            className={cn(
              "text-[12.5px] font-medium",
              active ? "text-slate-900" : "text-slate-500",
            )}
          >
            {active ? "Active" : "Inactive"}
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={active}
            disabled={disabled}
            onChange={(event) => { onChange(event.target.checked); }}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-slate-400 peer-disabled:opacity-50 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
        </label>
      </div>
    </div>
  );
}

function PreviewDrawer({
  open,
  mode,
  data,
  draftSubject,
  draftDoc,
  onClose,
}: {
  readonly open: boolean;
  readonly mode: "preview" | "send-test";
  readonly data: AutomatedEmailEditorViewModel;
  readonly draftSubject: string;
  readonly draftDoc: unknown;
  readonly onClose: () => void;
}) {
  const [person, setPerson] = useState<SamplePerson>("nico");
  const [rendered, setRendered] = useState<Awaited<
    ReturnType<typeof renderPreviewAction>
  > | null>(null);
  const [testEmail, setTestEmail] = useState(data.operatorEmail ?? "");
  const [testOpen, setTestOpen] = useState(mode === "send-test");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [testPending, startTestTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setTestOpen(mode === "send-test");
    setTestMessage(null);
    setSent(false);
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRendered(null);
    void renderPreviewAction({
      projectId: data.projectId,
      templateId: data.template.id,
      draftSubject,
      draftDoc,
      samplePerson: person,
    }).then((result) => {
      if (alive) setRendered(result);
    });
    return () => {
      alive = false;
    };
  }, [data.projectId, data.template.id, draftDoc, draftSubject, open, person]);

  useEffect(() => {
    if (!sent) return undefined;
    const timeout = window.setTimeout(onClose, 1600);
    return () => { window.clearTimeout(timeout); };
  }, [onClose, sent]);

  function handleSendTest() {
    setTestMessage(null);
    startTestTransition(async () => {
      const result = await sendTestAction({
        projectId: data.projectId,
        templateId: data.template.id,
        draftSubject,
        draftDoc,
        samplePerson: person,
        recipientEmail: testEmail,
      });
      if (!result.ok) {
        setTestMessage(result.message);
        return;
      }
      setSent(true);
    });
  }

  if (!open) return null;
  const preview = rendered?.ok ? rendered.data : null;
  const renderError =
    rendered !== null && !rendered.ok ? rendered.message : null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close preview"
        className="absolute inset-0 bg-slate-950/25"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 flex h-full w-[600px] flex-col bg-white shadow-2xl ring-1 ring-slate-200">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-slate-900">
              Preview
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Rendered with sample values — nothing is sent from here.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5">
              {SAMPLE_PEOPLE.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => { setPerson(sample.id); }}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] transition-colors",
                    person === sample.id
                      ? "bg-white font-medium text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {sample.name}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-slate-500"
              onClick={onClose}
              aria-label="Close preview"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {testOpen ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-sky-50/60 px-4 py-2.5">
            <Send className="size-3.5 shrink-0 text-sky-600" />
            <span className="shrink-0 text-[11.5px] text-sky-900">
              Send a test to:
            </span>
            <Input
              value={testEmail}
              onChange={(event) => { setTestEmail(event.target.value); }}
              type="email"
              className="h-7 max-w-[260px] bg-white text-[12px]"
            />
            <Button
              type="button"
              size="sm"
              className="h-7"
              onClick={handleSendTest}
              disabled={testPending || sent}
            >
              {sent ? (
                <>
                  <Check className="size-3" /> Sent
                </>
              ) : testPending ? (
                "Sending…"
              ) : (
                "Send test"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setTestOpen(false); }}
              disabled={testPending}
              className="ml-auto h-7 px-2 text-[11px] font-normal text-slate-500"
            >
              Cancel
            </Button>
            {testMessage !== null ? (
              <p className="w-full text-[11.5px] text-rose-700">
                {testMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 overflow-auto px-5 py-4">
          {renderError !== null ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-[12.5px] text-rose-800">
              {renderError}
            </div>
          ) : preview === null ? (
            <div className="flex h-40 items-center justify-center text-[12.5px] text-slate-500">
              Rendering preview…
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 text-[11.5px]">
                <span className="text-slate-500">From</span>
                <span className="truncate font-mono text-[11px] text-slate-700">
                  {preview.fromEmail}
                </span>
                <span className="text-slate-500">To</span>
                <span className="truncate font-mono text-[11px] text-slate-700">
                  {preview.toEmail}
                </span>
                <span className="text-slate-500">Subject</span>
                <span className="truncate font-medium text-slate-900">
                  {preview.subject}
                </span>
              </div>
              <div className="h-[620px] overflow-hidden bg-[#FAFBF9]">
                <iframe
                  title="Rendered automated email"
                  srcDoc={preview.html}
                  sandbox="allow-same-origin"
                  className="origin-top-left border-0"
                  style={{ width: 600, height: 680, transform: "scale(0.93)" }}
                />
              </div>
              <div className="border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                <Info className="mr-1 inline size-3 -translate-y-px" />
                Frame, type and spacing are fixed by code — the body copy above
                is the only editable part.
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-5 py-3">
          <span className="text-[11.5px] text-slate-500">
            Showing{" "}
            {preview?.sampleFirstName ??
              SAMPLE_PEOPLE.find((sample) => sample.id === person)?.name}
            &apos;s values.
          </span>
          {!testOpen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setTestOpen(true); }}
            >
              <Send className="size-3" /> Send test
            </Button>
          ) : null}
        </footer>
      </aside>
    </div>
  );
}

function SendLogContent({
  data,
  active,
  hasPublishedCopy,
}: {
  readonly data: AutomatedEmailEditorViewModel;
  readonly active: boolean;
  readonly hasPublishedCopy: boolean;
}) {
  const statuses = ["sent", "duplicate", "held", "failed"] as const;
  const total =
    data.sendCounts.received +
    statuses.reduce((sum, status) => sum + data.sendCounts[status], 0);
  return (
    <div className="flex flex-col gap-3 pt-4">
      <section className="flex items-center gap-6 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Last sent
          </p>
          <div className="mt-1">
            <WebhookIndicator value={data.lastReceivedAt} />
          </div>
        </div>
        <Separator orientation="vertical" className="h-8 bg-slate-200" />
        <div className="flex items-center gap-5">
          {statuses.map((status) => (
            <div key={status}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {AUTOMATED_EMAIL_SEND_STATUS_META[status].label}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[15px] font-semibold tabular-nums",
                  data.sendCounts[status] > 0
                    ? "text-slate-900"
                    : "text-slate-300",
                )}
              >
                {String(data.sendCounts[status])}
              </p>
            </div>
          ))}
        </div>
        {active && !hasPublishedCopy ? (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-[11.5px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
            <AlertCircle className="size-3.5" /> Holding — no published copy
          </span>
        ) : null}
      </section>
      {data.sendCounts.received > 0 ? (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-[11.5px] text-slate-500">
          {String(data.sendCounts.received)} webhook
          {data.sendCounts.received === 1 ? " is" : "s are"} processing.
        </p>
      ) : null}
      {total === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
          <h2 className="text-[13.5px] font-medium text-slate-900">
            Nothing has come through yet
          </h2>
          <p className="mx-auto mt-1 max-w-[46ch] text-[12px] leading-relaxed text-slate-500">
            When the Salesforce flow fires at this template&apos;s ID, rows land
            here — including while the template is inactive. That&apos;s the dry
            run: you read what would have gone out, then activate.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
            <span className="text-[11.5px] text-slate-500">
              Give Ricky this ID
            </span>
            <CopyIdChip id={data.template.id} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function AutomatedEmailTemplateEditor({
  data,
}: {
  readonly data: AutomatedEmailEditorViewModel;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState(
    data.template,
  );
  const [name, setName] = useState(data.template.name);
  const [draftSubject, setDraftSubject] = useState(data.template.draftSubject);
  const [draftDoc, setDraftDoc] = useState<unknown>(() =>
    initialDoc(data.template.draftDoc),
  );
  const [tab, setTab] = useState<EditorTab>("content");
  const [active, setActive] = useState(data.template.isActive);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"preview" | "send-test" | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const lastServerUpdatedAt = useRef(data.template.updatedAt);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        code: false,
      }),
      LinkExtension.configure({
        openOnClick: false,
        protocols: [...COMPOSER_LINK_SCHEMES],
        isAllowedUri: (url, { defaultValidate }) =>
          isAllowedComposerLinkHref(url) && defaultValidate(url),
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      MergeFieldExtension,
    ],
    content: initialDoc(data.template.draftDoc),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Automated email body",
        "aria-multiline": "true",
        class:
          "min-h-[360px] w-full px-4 py-3.5 text-[13.5px] leading-relaxed text-slate-900 focus:outline-none [&_a]:text-sky-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_span.ae-pill]:mx-0.5 [&_span.ae-pill]:inline-flex [&_span.ae-pill]:select-all [&_span.ae-pill]:rounded-[5px] [&_span.ae-pill]:bg-[#f0f9ff] [&_span.ae-pill]:px-1.5 [&_span.ae-pill]:py-0.5 [&_span.ae-pill]:text-[#0369a1] [&_span.ae-pill]:shadow-[inset_0_0_0_1px_#bae6fd]",
      },
    },
    onUpdate: ({ editor: instance }) => {
      setDraftDoc(instance.getJSON());
    },
  });

  useEffect(() => {
    if (data.template.updatedAt === lastServerUpdatedAt.current) return;
    lastServerUpdatedAt.current = data.template.updatedAt;
    setTemplate(data.template);
    setName(data.template.name);
    setDraftSubject(data.template.draftSubject);
    const nextDoc = initialDoc(data.template.draftDoc);
    setDraftDoc(nextDoc);
    editor?.commands.setContent(nextDoc, { emitUpdate: false });
    setActive(data.template.isActive);
    setConflict(false);
  }, [data.template, editor]);

  const wordCount =
    editor?.getText().trim().split(/\s+/).filter(Boolean).length ?? 0;
  const hasPublishedCopy =
    template.publishedSubject !== null && template.publishedDoc !== null;
  const hasUnpublishedChanges =
    !hasPublishedCopy ||
    draftSubject !== template.publishedSubject ||
    !sameJson(draftDoc, template.publishedDoc);
  const draftChanged =
    draftSubject !== template.draftSubject ||
    !sameJson(draftDoc, template.draftDoc);

  const insertMergeField = useCallback(
    (key: string) => {
      if (editor === null) {
        return;
      }

      const chain = editor.chain();
      if (editor.isFocused) {
        chain.focus();
      } else {
        chain.focus("end");
      }
      chain.insertContent({ type: "mergeField", attrs: { key } }).run();
    },
    [editor],
  );

  function applyTemplate(next: {
    readonly id: string;
    readonly name: string;
    readonly draftSubject: string;
    readonly draftDoc: unknown;
    readonly publishedSubject: string | null;
    readonly publishedDoc: unknown;
    readonly publishedAt: string | null;
    readonly isActive: boolean;
    readonly updatedAt: string;
  }) {
    setTemplate((current) => ({
      ...current,
      ...next,
      hasUnpublishedChanges: current.hasUnpublishedChanges,
    }));
    lastServerUpdatedAt.current = next.updatedAt;
    setActive(next.isActive);
  }

  async function saveDraft(): Promise<boolean> {
    const result = await saveDraftAction({
      projectId: data.projectId,
      templateId: template.id,
      draftSubject,
      draftDoc,
      baselineUpdatedAt: template.updatedAt,
    });
    if (!result.ok) {
      setSaveMessage(result.message);
      return false;
    }
    if (result.data.outcome === "conflict") {
      setConflict(true);
      return false;
    }
    applyTemplate(result.data.template);
    setSaveMessage("Draft saved.");
    router.refresh();
    return true;
  }

  function handleSaveDraft() {
    setSaveMessage(null);
    startTransition(() => {
      void saveDraft();
    });
  }

  function handlePublish() {
    setSaveMessage(null);
    startTransition(async () => {
      if (draftChanged && !(await saveDraft())) return;
      const result = await publishTemplateAction({
        projectId: data.projectId,
        templateId: template.id,
      });
      if (!result.ok) {
        setSaveMessage(result.message);
        return;
      }
      applyTemplate(result.data);
      setSaveMessage("Published copy is live. Sending remains separate.");
      router.refresh();
    });
  }

  function handleActiveChange(nextActive: boolean) {
    const before = active;
    setActive(nextActive);
    startTransition(async () => {
      const result = await setTemplateActiveAction({
        projectId: data.projectId,
        templateId: template.id,
        isActive: nextActive,
      });
      if (!result.ok) {
        setActive(before);
        setSaveMessage(result.message);
        return;
      }
      applyTemplate(result.data);
      router.refresh();
    });
  }

  function handleNameBlur() {
    const normalized = name.trim();
    if (normalized.length === 0 || normalized === template.name) {
      setName(template.name);
      return;
    }
    startTransition(async () => {
      const result = await renameTemplateAction({
        projectId: data.projectId,
        templateId: template.id,
        name: normalized,
      });
      if (!result.ok) {
        setName(template.name);
        setSaveMessage(result.message);
        return;
      }
      applyTemplate(result.data);
      setName(result.data.name);
      router.refresh();
    });
  }

  async function copyCurrentVersion() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ subject: draftSubject, doc: draftDoc }, null, 2),
      );
      setSaveMessage("Your version was copied to the clipboard.");
    } catch {
      setSaveMessage("Could not copy this version to the clipboard.");
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-[1060px] max-w-[1220px] flex-col gap-4 px-10 py-8">
      <Link
        href={`/settings/projects/${encodeURIComponent(data.projectId)}/automated-emails`}
        className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 text-[12.5px] text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        <ChevronLeft className="size-3.5" /> Automated emails
      </Link>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-6 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Input
                value={name}
                aria-label="Template name"
                disabled={pending}
                onChange={(event) => { setName(event.target.value); }}
                onBlur={handleNameBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="h-auto min-w-0 flex-1 border-transparent bg-transparent px-1.5 py-0.5 text-[17px] font-semibold shadow-none hover:border-slate-200 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-slate-300"
              />
              {hasUnpublishedChanges ? (
                <StatusBadge
                  label="Unpublished changes"
                  variant="soft"
                  colorClasses="shrink-0 rounded bg-amber-50 text-amber-700 ring-amber-200"
                />
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-1.5">
              <CopyIdChip id={template.id} />
              <Separator orientation="vertical" className="h-3 bg-slate-200" />
              <SendingChip active={active} />
              <Separator orientation="vertical" className="h-3 bg-slate-200" />
              <WebhookIndicator value={data.lastReceivedAt} showLabel />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || !draftChanged}
              onClick={handleSaveDraft}
            >
              Save draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant={hasUnpublishedChanges ? "default" : "secondary"}
              disabled={pending || conflict}
              onClick={handlePublish}
            >
              {hasUnpublishedChanges ? "Publish" : "Published"}
            </Button>
          </div>
        </div>
        <SendingStrip
          active={active}
          hasPublishedCopy={hasPublishedCopy}
          onChange={handleActiveChange}
          disabled={pending}
        />
      </section>

      <div
        role="tablist"
        aria-label="Template editor sections"
        className="flex items-center gap-1 border-b border-slate-200"
      >
        {(["content", "send-log"] as const).map((nextTab) => {
          const current = tab === nextTab;
          const label = nextTab === "content" ? "Content" : "Send log";
          const logCount =
            data.sendCounts.received +
            data.sendCounts.sent +
            data.sendCounts.duplicate +
            data.sendCounts.held +
            data.sendCounts.failed;
          return (
            <button
              key={nextTab}
              type="button"
              role="tab"
              aria-selected={current}
              onClick={() => { setTab(nextTab); }}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
                current
                  ? "border-slate-900 font-semibold text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {label}
              {nextTab === "send-log" && logCount > 0 ? (
                <span className="rounded bg-slate-100 px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-slate-500">
                  {String(logCount)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === "send-log" ? (
        <SendLogContent
          data={data}
          active={active}
          hasPublishedCopy={hasPublishedCopy}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {conflict ? (
            <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50/70 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-rose-900">
                  This draft is out of date
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-rose-800">
                  Another operator saved a newer draft. Reload the template to
                  pull their version in — anything typed here since opening this
                  page will be lost, so copy it out first.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => { router.refresh(); }}
                  >
                    <RefreshCw className="size-3" /> Reload template
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void copyCurrentVersion();
                    }}
                  >
                    Copy my version to clipboard
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {active && !hasPublishedCopy && !conflict ? (
            <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50/70 px-4 py-2.5">
              <AlertCircle className="size-4 shrink-0 text-rose-600" />
              <p className="min-w-0 flex-1 text-[12.5px] text-rose-900">
                <span className="font-semibold">Sends are holding.</span> This
                template is active but has no published copy —{" "}
                {String(data.sendCounts.held)} webhook
                {data.sendCounts.held === 1 ? " is" : "s are"} waiting.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={handlePublish}
                disabled={pending}
              >
                Publish draft
              </Button>
            </div>
          ) : null}
          {hasUnpublishedChanges && hasPublishedCopy ? (
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-2.5">
              <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
              <p className="min-w-0 flex-1 text-[12.5px] text-amber-900">
                <span className="font-semibold">
                  This draft differs from the published copy.
                </span>{" "}
                Volunteers are still receiving the published version.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={handlePublish}
                disabled={pending}
              >
                Publish
              </Button>
            </div>
          ) : null}
          {saveMessage !== null ? (
            <p
              role="status"
              className="rounded-md bg-slate-100 px-3 py-2 text-[12px] text-slate-600"
            >
              {saveMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                From
              </span>
              <span className="font-mono text-[12px] text-slate-800">
                {data.primaryAlias ?? "No project alias"}
              </span>
            </div>
            <Separator orientation="vertical" className="h-3 bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                To
              </span>
              <span className="text-[12px] text-slate-800">
                whoever the Salesforce webhook names
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setDrawerMode("preview"); }}
              >
                <Eye className="size-3" /> Preview
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setDrawerMode("send-test"); }}
              >
                <Send className="size-3" /> Send test
              </Button>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-baseline gap-3 border-b border-slate-200 px-4 py-2.5">
              <span className="w-[52px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.1em] text-slate-500">
                Subject
              </span>
              <Input
                value={draftSubject}
                onChange={(event) => { setDraftSubject(event.target.value); }}
                placeholder="What the volunteer sees in their inbox"
                aria-label="Subject line"
                className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-[14.5px] font-semibold tracking-tight shadow-none placeholder:font-normal focus-visible:ring-0"
              />
              <span
                className={cn(
                  "shrink-0 font-mono text-[10.5px] tabular-nums",
                  draftSubject.length > 70
                    ? "text-amber-700"
                    : "text-slate-500",
                )}
              >
                {String(draftSubject.length)}/70
              </span>
            </div>
            <div className="flex items-center gap-0.5 border-b border-slate-200 bg-slate-50/80 px-2 py-1.5">
              <ToolbarButton
                label="Bold"
                active={editor?.isActive("bold") ?? false}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                <Bold className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton
                label="Italic"
                active={editor?.isActive("italic") ?? false}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              >
                <Italic className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton
                label="Link"
                active={editor?.isActive("link") ?? false}
                onClick={() => {
                  const url = promptForLinkUrl();
                  if (url === null) {
                    editor?.chain().focus().unsetLink().run();
                    return;
                  }
                  editor?.chain().focus().setLink({ href: url }).run();
                }}
              >
                <Link2 className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton
                label="Quote"
                active={editor?.isActive("blockquote") ?? false}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              >
                <Quote className="size-3.5" />
              </ToolbarButton>
              <Separator
                orientation="vertical"
                className="mx-1 h-4 bg-slate-200"
              />
              <ToolbarButton
                label="Bulleted list"
                active={editor?.isActive("bulletList") ?? false}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                <List className="size-3.5" />
              </ToolbarButton>
              <Separator
                orientation="vertical"
                className="mx-1 h-4 bg-slate-200"
              />
              <MergeFieldMenu onInsert={insertMergeField} />
              <span className="ml-auto pr-1 font-mono text-[10.5px] tabular-nums text-slate-500">
                {String(wordCount)}{" "}
                <span className="text-slate-400">
                  word{wordCount === 1 ? "" : "s"}
                </span>
              </span>
            </div>
            <EditorContent editor={editor} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-50/50 px-4 py-2 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Info className="size-3" /> Merge fields render as the
                volunteer&apos;s real values at send time.
              </span>
              <span className="ml-auto">
                {draftChanged ? "Unsaved changes" : "Saved as draft"}
              </span>
            </div>
          </section>
          <p className="sr-only">
            Merge fields:{" "}
            {AUTOMATED_EMAIL_MERGE_FIELDS.map((field) =>
              mergeFieldLabel(field.key),
            ).join(", ")}
          </p>
        </div>
      )}

      <PreviewDrawer
        open={drawerMode !== null}
        mode={drawerMode ?? "preview"}
        data={data}
        draftSubject={draftSubject}
        draftDoc={draftDoc}
        onClose={() => { setDrawerMode(null); }}
      />
    </div>
  );
}
