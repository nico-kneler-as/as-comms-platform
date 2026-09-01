import {
  AUTOMATED_EMAIL_MERGE_FIELDS,
  type AutomatedEmailMergeFieldKey,
} from "@as-comms/domain/automated-email-merge";
import { Node } from "@tiptap/react";

const labelsByKey = new Map<AutomatedEmailMergeFieldKey, string>(
  AUTOMATED_EMAIL_MERGE_FIELDS.map(
    (field) => [field.key as AutomatedEmailMergeFieldKey, field.label] as const,
  ),
);

export function mergeFieldLabel(key: string): string {
  return labelsByKey.get(key as AutomatedEmailMergeFieldKey) ?? key;
}

/**
 * Atomic inline tokens preserve the renderer's canonical JSON shape:
 * `{ type: "mergeField", attrs: { key } }`.
 *
 * `@tiptap/react` re-exports its compatible Node factory, so this stays within
 * the existing declared TipTap dependency set.
 */
export const MergeFieldExtension = Node.create({
  name: "mergeField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-merge-field"),
        renderHTML: (attributes: { readonly key?: unknown }) =>
          typeof attributes.key === "string"
            ? { "data-merge-field": attributes.key }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-merge-field]" }];
  },
  renderHTML({ node }) {
    const key = typeof node.attrs.key === "string" ? node.attrs.key : "";
    return [
      "span",
      {
        class: "ae-pill",
        contenteditable: "false",
        "data-merge-field": key,
      },
      mergeFieldLabel(key),
    ];
  },
});
