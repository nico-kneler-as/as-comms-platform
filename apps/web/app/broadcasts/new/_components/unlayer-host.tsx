"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import EmailEditor, { type EditorRef, type EmailEditorProps } from "react-email-editor";

import { Button } from "@/components/ui/button";

import {
  BRAND_DEFAULT_STARTER,
  UNLAYER_OPTIONS,
} from "./unlayer-options";

const AUTOSAVE_DEBOUNCE_MS = 1500;
const LOAD_TIMEOUT_MS = 10_000;
const SOFT_SIZE_LIMIT_BYTES = 500_000;
const HARD_SIZE_LIMIT_BYTES = 2_000_000;
const SOFT_WARNING_RESET_BYTES = 100_000;
const FOOTER_HINT_COPY =
  "Don't add an unsubscribe footer — Adventure Scientists adds one automatically when this is sent.";

interface UnlayerSaveOutput {
  readonly bodyDesignJson: unknown;
  readonly bodyHtml: string;
  readonly bodyPlaintext: string;
}

export interface UnlayerHostProps {
  readonly savedDesign: unknown;
  readonly onSave: (output: UnlayerSaveOutput) => void;
  readonly onReadyChange: (ready: boolean) => void;
}

export interface UnlayerHostHandle {
  flushExport: () => Promise<boolean>;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRows(design: unknown): Record<string, unknown>[] {
  if (!isRecord(design)) {
    return [];
  }

  const body = design.body;
  if (!isRecord(body) || !Array.isArray(body.rows)) {
    return [];
  }

  return body.rows.filter(isRecord);
}

function readFooterPresent(design: unknown): boolean {
  return readRows(design).some((row) => {
    const columns = Array.isArray(row.columns) ? row.columns : [];
    return columns.some((column) => {
      if (!isRecord(column) || !Array.isArray(column.contents)) {
        return false;
      }

      return column.contents.some((content) => {
        return (
          isRecord(content) &&
          (content.id === "footer-html-1" || content.type === "html")
        );
      });
    });
  });
}

function readFooterLocked(design: unknown): boolean {
  return readRows(design).some((row) => {
    if (row.id !== "row-3" || row.locked !== true) {
      return false;
    }

    const columns = Array.isArray(row.columns) ? row.columns : [];
    return columns.some((column) => {
      if (!isRecord(column) || !Array.isArray(column.contents)) {
        return false;
      }

      return column.contents.some((content) => {
        if (!isRecord(content) || content.id !== "footer-html-1") {
          return false;
        }

        return (
          isRecord(content.values) &&
          content.values.locked === true
        );
      });
    });
  });
}

function ensureFooterRow(design: unknown): unknown {
  const base =
    savedDesignLooksUsable(design) ? cloneValue(design) : cloneValue(BRAND_DEFAULT_STARTER);

  if (readFooterPresent(base)) {
    return base;
  }

  if (!isRecord(base) || !isRecord(base.body) || !Array.isArray(base.body.rows)) {
    return cloneValue(BRAND_DEFAULT_STARTER);
  }

  const existingRows = readRows(base);
  base.body.rows = [
    ...existingRows,
    cloneValue(BRAND_DEFAULT_STARTER.body.rows[2]),
  ];
  return base;
}

function savedDesignLooksUsable(design: unknown): design is Record<string, unknown> {
  return readRows(design).length > 0;
}

function stripFooterRow(design: unknown): unknown {
  if (!savedDesignLooksUsable(design)) {
    return cloneValue(BRAND_DEFAULT_STARTER);
  }

  const nextDesign = cloneValue(design);
  if (!isRecord(nextDesign) || !isRecord(nextDesign.body) || !Array.isArray(nextDesign.body.rows)) {
    return cloneValue(BRAND_DEFAULT_STARTER);
  }

  nextDesign.body.rows = nextDesign.body.rows.filter((row) => {
    if (!isRecord(row)) {
      return true;
    }

    const columns = Array.isArray(row.columns) ? row.columns : [];
    return !columns.some((column) => {
      if (!isRecord(column) || !Array.isArray(column.contents)) {
        return false;
      }

      return column.contents.some(
        (content) => isRecord(content) && content.id === "footer-html-1",
      );
    });
  });
  return nextDesign;
}

function countBlocks(design: unknown): number {
  return readRows(design).reduce((total, row) => {
    const columns = Array.isArray(row.columns) ? row.columns.filter(isRecord) : [];
    return (
      total +
      columns.reduce((columnTotal, column) => {
        if (!Array.isArray(column.contents)) {
          return columnTotal;
        }

        return columnTotal + column.contents.filter(isRecord).length;
      }, 0)
    );
  }, 0);
}

function readSizeBytes(design: unknown): number {
  const serializedDesign = JSON.stringify(design);
  return new TextEncoder().encode(serializedDesign).length;
}

function exportEditor(
  editor: NonNullable<EditorRef["editor"]>,
): Promise<UnlayerSaveOutput> {
  return new Promise((resolve) => {
    editor.exportHtml((data) => {
      editor.exportPlainText((plainText) => {
        resolve({
          bodyDesignJson: data.design as unknown,
          bodyHtml: data.html,
          bodyPlaintext: plainText.text,
        });
      });
    });
  });
}

function EditorLoadingSkeleton() {
  return (
    <div
      className="h-[720px] w-full rounded-md border border-slate-200 bg-slate-50"
      aria-busy="true"
    >
      <span className="sr-only" aria-live="polite">
        Loading the email editor
      </span>
      <div className="grid h-full grid-cols-[64px_minmax(0,1fr)_240px] gap-4 px-4 py-4">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={`tool-skeleton-${String(index)}`}
              className="h-8 w-10 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
        <div className="flex items-center justify-center">
          <div className="flex w-full max-w-[600px] flex-col gap-4">
            <span className="h-16 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none" />
            <span className="h-32 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none" />
            <span className="h-8 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              key={`property-skeleton-${String(index)}`}
              className="h-6 w-32 rounded bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export const UnlayerHost = forwardRef<UnlayerHostHandle, UnlayerHostProps>(
  function UnlayerHost({ savedDesign, onSave, onReadyChange }, ref) {
    const emailEditorRef = useRef<EditorRef>(null);
    const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initializedRef = useRef(false);
    const footerFallbackRef = useRef(false);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    );
    const [liveMessage, setLiveMessage] = useState<string | null>(
      "Loading the email editor",
    );
    const [blockCount, setBlockCount] = useState(0);
    const [designBytes, setDesignBytes] = useState(0);
    const [dismissedSoftWarningAt, setDismissedSoftWarningAt] = useState<
      number | null
    >(null);
    const [footerHintActive, setFooterHintActive] = useState(false);

    const hardSizeError = designBytes >= HARD_SIZE_LIMIT_BYTES;
    const softSizeWarning =
      designBytes >= SOFT_SIZE_LIMIT_BYTES &&
      designBytes < HARD_SIZE_LIMIT_BYTES &&
      (dismissedSoftWarningAt === null ||
        designBytes >= dismissedSoftWarningAt + SOFT_WARNING_RESET_BYTES);
    const canContinue = status === "ready" && !hardSizeError;

    const publishExport = useCallback(
      async (forceFooterValidation = false): Promise<boolean> => {
        const editor = emailEditorRef.current?.editor;
        if (editor === null || editor === undefined) {
          return false;
        }

        const output = await exportEditor(editor);
        const design =
          footerFallbackRef.current || forceFooterValidation
            ? output.bodyDesignJson
            : ensureFooterRow(output.bodyDesignJson);

        if (!footerFallbackRef.current && forceFooterValidation) {
          const footerLocked = readFooterLocked(design);
          if (!footerLocked) {
            footerFallbackRef.current = true;
            setFooterHintActive(true);
            const fallbackDesign = stripFooterRow(savedDesign ?? BRAND_DEFAULT_STARTER);
            editor.loadDesign(fallbackDesign as never);
            return await new Promise<boolean>((resolve) => {
              window.setTimeout(() => {
                void (async () => {
                const fallbackOutput = await exportEditor(editor);
                setBlockCount(countBlocks(fallbackOutput.bodyDesignJson));
                setDesignBytes(readSizeBytes(fallbackOutput.bodyDesignJson));
                onSave(fallbackOutput);
                resolve(true);
                })();
              }, 0);
            });
          }
        }

        setBlockCount(countBlocks(design));
        setDesignBytes(readSizeBytes(design));
        onSave({
          bodyDesignJson: design,
          bodyHtml: output.bodyHtml,
          bodyPlaintext: output.bodyPlaintext,
        });
        return true;
      },
      [onSave, savedDesign],
    );

    const scheduleAutosave = useCallback(() => {
      if (exportTimeoutRef.current !== null) {
        clearTimeout(exportTimeoutRef.current);
      }

      exportTimeoutRef.current = setTimeout(() => {
        void publishExport();
      }, AUTOSAVE_DEBOUNCE_MS);
    }, [publishExport]);

    const failLoad = useCallback((message: string) => {
      setStatus("error");
      setLiveMessage(message);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        flushExport: () => publishExport(),
      }),
      [publishExport],
    );

    useEffect(() => {
      onReadyChange(canContinue);
    }, [canContinue, onReadyChange]);

    useEffect(() => {
      loadTimeoutRef.current = setTimeout(() => {
        failLoad("The email editor failed to load. Reload the page to try again.");
      }, LOAD_TIMEOUT_MS);

      const handleWindowError = (event: ErrorEvent) => {
        if (
          event.filename.includes("unlayer") ||
          event.message.toLowerCase().includes("unlayer")
        ) {
          failLoad(
            "The email editor failed to load. Reload the page to try again.",
          );
        }
      };

      window.addEventListener("error", handleWindowError);
      return () => {
        window.removeEventListener("error", handleWindowError);
        if (loadTimeoutRef.current !== null) {
          clearTimeout(loadTimeoutRef.current);
        }
        if (exportTimeoutRef.current !== null) {
          clearTimeout(exportTimeoutRef.current);
        }
      };
    }, [failLoad]);

    const handleLoad = useCallback((editor: NonNullable<EditorRef["editor"]>) => {
      editor.addEventListener("design:updated", () => {
        scheduleAutosave();
      });
    }, [scheduleAutosave]);

    const handleReady = useCallback(
      (editor: NonNullable<EditorRef["editor"]>) => {
        if (initializedRef.current) {
          return;
        }

        initializedRef.current = true;
        if (loadTimeoutRef.current !== null) {
          clearTimeout(loadTimeoutRef.current);
        }

        try {
          const designToLoad =
            footerFallbackRef.current
              ? stripFooterRow(savedDesign ?? BRAND_DEFAULT_STARTER)
              : ensureFooterRow(savedDesign ?? BRAND_DEFAULT_STARTER);

          editor.loadDesign(designToLoad as never);
          window.setTimeout(() => {
            void (async () => {
              const loaded = await publishExport(true);
              if (!loaded) {
                failLoad(
                  "The email editor failed to load. Reload the page to try again.",
                );
                return;
              }

              setStatus("ready");
              setLiveMessage(null);
            })();
          }, 0);
        } catch {
          failLoad(
            "The email editor failed to load. Reload the page to try again.",
          );
        }
      },
      [failLoad, publishExport, savedDesign],
    );

    return (
      <div className="border-t border-slate-200">
        {softSizeWarning ? (
          <div
            className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50/60 px-4 py-2.5"
            role="status"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-amber-900">
              This design is getting large. Consider linking images instead of
              embedding.
            </p>
            <button
              type="button"
              aria-label="Dismiss warning"
              onClick={() => {
                setDismissedSoftWarningAt(designBytes);
              }}
            >
              <X
                className="size-3.5 text-amber-700/70"
                aria-hidden="true"
              />
            </button>
          </div>
        ) : null}

        {hardSizeError ? (
          <div
            className="flex items-start gap-2.5 border-b border-rose-200 bg-rose-50/70 px-4 py-2.5"
            role="alert"
          >
            <AlertOctagon
              className="mt-0.5 size-4 shrink-0 text-rose-700"
              aria-hidden="true"
            />
            <p className="text-[12.5px] leading-relaxed text-rose-900">
              This design is too large to save. Reduce image sizes or remove
              blocks.
            </p>
          </div>
        ) : null}

        {footerHintActive ? (
          <div className="flex items-start gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <Info
              className="mt-0.5 size-4 shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <p className="text-[12.5px] leading-relaxed text-slate-700">
              {FOOTER_HINT_COPY}
            </p>
          </div>
        ) : null}

        {status === "error" ? (
          <div
            className="flex h-[720px] w-full flex-col items-center justify-center rounded-md border border-amber-200 bg-amber-50/40 px-6"
            role="status"
            aria-live="polite"
          >
            <AlertTriangle
              className="size-6 text-amber-700"
              aria-hidden="true"
            />
            <p className="mt-3 text-[13.5px] font-semibold text-amber-900">
              The editor couldn&apos;t load.
            </p>
            <p className="mt-1 max-w-[420px] text-center text-[12.5px] text-amber-800/90">
              Reload the page and try again — your draft is saved.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => {
                window.location.reload();
              }}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reload
            </Button>
            <span className="sr-only" aria-live="polite">
              {liveMessage}
            </span>
          </div>
        ) : (
          <div className="relative">
            <EmailEditor
              ref={emailEditorRef}
              minHeight={720}
              options={
                UNLAYER_OPTIONS as unknown as NonNullable<EmailEditorProps["options"]>
              }
              onLoad={handleLoad}
              onReady={handleReady}
            />
            {status === "loading" ? (
              <div className="absolute inset-0">
                <EditorLoadingSkeleton />
              </div>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Info className="size-3" aria-hidden="true" />
            The AS unsubscribe footer is added automatically. You don&apos;t
            need to add one.
          </span>
          <span className="ml-auto font-mono text-[10.5px] tabular-nums text-slate-500">
            {blockCount.toLocaleString()}{" "}
            <span className="text-slate-400">
              block{blockCount === 1 ? "" : "s"}
            </span>
          </span>
        </div>
      </div>
    );
  },
);
