import { useRef } from "react";
import { Mail } from "lucide-react";

import {
  buildSignaturePreview,
  PROJECT_ALIAS_SIGNATURE_MAX_LENGTH,
  PROJECT_ALIAS_SIGNATURE_OPERATOR_FIRST_NAME_TOKEN,
  buildProjectEmailPreview,
  getSignatureValidationError,
  insertProjectAliasSignatureToken,
} from "./shared";

export function StepSignature({
  aliasDraft,
  primaryAliasAddress,
  signatureDraft,
  onSignatureChange
}: {
  readonly aliasDraft: string;
  readonly primaryAliasAddress: string | null;
  readonly signatureDraft: string;
  readonly onSignatureChange: (nextValue: string) => void;
}) {
  const validationError = getSignatureValidationError(signatureDraft);
  const signatureTextareaRef = useRef<HTMLTextAreaElement>(null);
  const signaturePreview = buildSignaturePreview(signatureDraft);

  function handleInsertOperatorToken() {
    const textarea = signatureTextareaRef.current;
    const { nextValue, nextCaret } = insertProjectAliasSignatureToken({
      value: signatureDraft,
      selectionStart: textarea?.selectionStart ?? signatureDraft.length,
      selectionEnd: textarea?.selectionEnd ?? signatureDraft.length,
    });

    onSignatureChange(nextValue);
    requestAnimationFrame(() => {
      const current = signatureTextareaRef.current;

      if (current !== null) {
        current.focus();
        current.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-sky-200/70 bg-sky-50/60 p-4 text-[12px] text-sky-900">
        <p>
          This signature is appended to every outbound email sent from this
          project. AI drafts will inherit it automatically.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase text-slate-500">
            Signature
          </p>
          <span
            className={
              validationError === null
                ? "text-[11px] tabular-nums text-slate-400"
                : "text-[11px] tabular-nums text-rose-600"
            }
          >
            {String(signatureDraft.length)}/{String(PROJECT_ALIAS_SIGNATURE_MAX_LENGTH)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
          <span>Insert:</span>
          <button
            type="button"
            onClick={handleInsertOperatorToken}
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-700 transition-colors hover:bg-slate-100"
          >
            {PROJECT_ALIAS_SIGNATURE_OPERATOR_FIRST_NAME_TOKEN}
          </button>
        </div>
        <textarea
          ref={signatureTextareaRef}
          value={signatureDraft}
          onChange={(event) => {
            onSignatureChange(event.target.value);
          }}
          rows={7}
          maxLength={PROJECT_ALIAS_SIGNATURE_MAX_LENGTH}
          placeholder="Warmly,\nThe Project Team\nAdventure Scientists"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-slate-800 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        {validationError !== null ? (
          <p className="mt-2 text-[11.5px] text-rose-600">{validationError}</p>
        ) : null}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase text-slate-500">
            Preview
          </p>
          <span className="text-[11px] text-slate-500">
            Resolves to each sender&apos;s first name
          </span>
        </div>
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11.5px]">
            <Mail className="size-3 text-slate-400" aria-hidden="true" />
            <span className="text-slate-500">From</span>
            <span className="font-mono text-slate-700">
              {primaryAliasAddress ?? buildProjectEmailPreview(aliasDraft)}
            </span>
          </div>
          <div className="px-4 py-3 text-[12.5px] text-slate-700">
            <p>Hi {"{firstName}"},</p>
            <p className="mt-2 italic text-slate-400">...message body preview...</p>
            <div className="mt-3 whitespace-pre-wrap border-t border-slate-100 pt-3 font-mono text-[12px] leading-relaxed text-slate-600">
              {signaturePreview.trim().length > 0 ? (
                signaturePreview
              ) : (
                <span className="not-italic text-slate-400">
                  Your signature appears here.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
