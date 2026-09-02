type TipTapMark = {
  readonly type: "bold" | "italic" | "link";
  readonly attrs?: { readonly href: string };
};

type TipTapNode = {
  readonly type:
    | "doc"
    | "paragraph"
    | "text"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "hardBreak"
    | "blockquote"
    | "mergeField";
  readonly text?: string;
  readonly marks?: readonly TipTapMark[];
  readonly attrs?: { readonly key: string };
  readonly content?: readonly TipTapNode[];
};

type HtmlContainerNode = {
  readonly kind: "element" | "root";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: HtmlNode[];
};

type HtmlNode =
  | { readonly kind: "text"; readonly value: string }
  | HtmlContainerNode;

export type SalesforceMergeFieldKey =
  | "firstName"
  | "lastName"
  | "email"
  | "projectName"
  | "volunteerId"
  | "esriUsername";

export type SalesforceHtmlConversion = {
  readonly doc: TipTapNode;
  readonly flattenedHeadings: number;
  readonly droppedImages: number;
  readonly unmappedPlaceholders: readonly string[];
};

const voidTags = new Set(["br", "img", "hr", "meta", "link", "input"]);
const mergeFieldPattern = /\{!([^}]+)\}/gu;

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/giu,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized === "nbsp") return " ";
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      const numeric = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isNaN(numeric) ? match : String.fromCodePoint(numeric);
    },
  );
}

function readTagEnd(input: string, start: number): number {
  let quote: string | null = null;
  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return input.length - 1;
}

function parseAttributes(
  rawAttributes: string,
): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of rawAttributes.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined) {
      attributes[name] = decodeHtmlEntities(
        match[2] ?? match[3] ?? match[4] ?? "",
      );
    }
  }
  return attributes;
}

function parseHtml(input: string): HtmlContainerNode {
  const root: HtmlContainerNode = {
    kind: "root",
    name: "root",
    attributes: {},
    children: [],
  };
  const stack: HtmlContainerNode[] = [root];
  let cursor = 0;

  while (cursor < input.length) {
    const open = input.indexOf("<", cursor);
    if (open === -1) {
      const value = decodeHtmlEntities(input.slice(cursor));
      if (value) stack.at(-1)?.children.push({ kind: "text", value });
      break;
    }
    if (open > cursor) {
      const value = decodeHtmlEntities(input.slice(cursor, open));
      if (value) stack.at(-1)?.children.push({ kind: "text", value });
    }
    if (input.startsWith("<!--", open)) {
      const end = input.indexOf("-->", open + 4);
      cursor = end === -1 ? input.length : end + 3;
      continue;
    }
    const end = readTagEnd(input, open);
    const rawTag = input.slice(open + 1, end).trim();
    cursor = end + 1;
    if (!rawTag || rawTag.startsWith("!") || rawTag.startsWith("?")) continue;
    if (rawTag.startsWith("/")) {
      const closingName = rawTag.slice(1).trim().toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]?.name === closingName) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const tagMatch = /^([^\s/>]+)([\s\S]*)$/u.exec(rawTag);
    const name = tagMatch?.[1]?.toLowerCase();
    if (name === undefined) continue;
    const element: HtmlContainerNode = {
      kind: "element",
      name,
      attributes: parseAttributes(tagMatch?.[2] ?? ""),
      children: [],
    };
    stack.at(-1)?.children.push(element);
    if (!voidTags.has(name) && !rawTag.endsWith("/")) stack.push(element);
  }
  return root;
}

export function salesforceMergeFieldKey(
  path: string,
): SalesforceMergeFieldKey | null {
  const value = path.trim().toLowerCase();
  if (/(?:^|\.)firstname$/u.test(value)) return "firstName";
  if (/(?:^|\.)lastname$/u.test(value)) return "lastName";
  if (/(?:^|\.)email__c$/u.test(value) || /contact__r\.email$/u.test(value)) {
    return "email";
  }
  if (/expedition__r\.name$/u.test(value)) return "projectName";
  if (
    /volunteer_id_plain__c$/u.test(value) ||
    /volunteer_id__c$/u.test(value)
  ) {
    return "volunteerId";
  }
  if (/esri_username__c$/u.test(value)) return "esriUsername";
  return null;
}

function sameMarks(
  left: readonly TipTapMark[] | undefined,
  right: readonly TipTapMark[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function appendText(
  target: TipTapNode[],
  value: string,
  marks: readonly TipTapMark[],
): void {
  const collapsed = value.replace(/\s+/gu, " ");
  if (!collapsed) return;
  const previous = target.at(-1);
  if (previous?.type === "text" && sameMarks(previous.marks, marks)) {
    target[target.length - 1] = {
      type: "text",
      text: `${previous.text ?? ""}${collapsed}`,
      ...(marks.length > 0 ? { marks } : {}),
    };
    return;
  }
  target.push({
    type: "text",
    text: collapsed,
    ...(marks.length > 0 ? { marks } : {}),
  });
}

function addTextWithMergeFields(
  target: TipTapNode[],
  value: string,
  marks: readonly TipTapMark[],
  unmapped: Set<string>,
): void {
  let cursor = 0;
  for (const match of value.matchAll(mergeFieldPattern)) {
    const path = match[1]?.trim() ?? "";
    const index = match.index ?? 0;
    appendText(target, value.slice(cursor, index), marks);
    const key = salesforceMergeFieldKey(path);
    if (key === null) {
      unmapped.add(path);
      appendText(target, `[SF: ${path}]`, marks);
    } else {
      target.push({ type: "mergeField", attrs: { key } });
    }
    cursor = index + match[0].length;
  }
  appendText(target, value.slice(cursor), marks);
}

function safeLink(href: string | undefined): string | null {
  if (href === undefined) return null;
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:"
      ? href
      : null;
  } catch {
    return null;
  }
}

type ConversionState = {
  readonly unmapped: Set<string>;
  flattenedHeadings: number;
  droppedImages: number;
};

function convertInline(
  node: HtmlNode,
  state: ConversionState,
  marks: readonly TipTapMark[] = [],
): TipTapNode[] {
  if (node.kind === "text") {
    const result: TipTapNode[] = [];
    addTextWithMergeFields(result, node.value, marks, state.unmapped);
    return result;
  }
  if (node.name === "img") {
    state.droppedImages += 1;
    return [];
  }
  if (node.name === "br") return [{ type: "hardBreak" }];
  let nextMarks = marks;
  if (node.name === "strong" || node.name === "b") {
    nextMarks = [...marks, { type: "bold" }];
  } else if (node.name === "em" || node.name === "i") {
    nextMarks = [...marks, { type: "italic" }];
  } else if (node.name === "a") {
    const href = safeLink(node.attributes.href);
    if (href !== null)
      nextMarks = [...marks, { type: "link", attrs: { href } }];
  }
  return node.children.flatMap((child) =>
    convertInline(child, state, nextMarks),
  );
}

function hasMeaningfulContent(content: readonly TipTapNode[]): boolean {
  return content.some(
    (node) =>
      node.type === "mergeField" ||
      node.type === "hardBreak" ||
      (node.type === "text" && (node.text?.trim().length ?? 0) > 0),
  );
}

function makeParagraph(content: readonly TipTapNode[]): TipTapNode | null {
  return hasMeaningfulContent(content) ? { type: "paragraph", content } : null;
}

function boldenText(content: readonly TipTapNode[]): readonly TipTapNode[] {
  return content.map((node) =>
    node.type === "text"
      ? { ...node, marks: [...(node.marks ?? []), { type: "bold" }] }
      : node,
  );
}

function convertListItem(
  node: HtmlContainerNode,
  state: ConversionState,
): TipTapNode {
  const content = convertBlocks(node.children, state);
  return { type: "listItem", content };
}

function convertList(
  node: HtmlContainerNode,
  state: ConversionState,
): TipTapNode {
  const content = node.children
    .filter(
      (child): child is HtmlContainerNode =>
        child.kind === "element" && child.name === "li",
    )
    .map((child) => convertListItem(child, state));
  return {
    type: node.name === "ol" ? "orderedList" : "bulletList",
    content,
  };
}

function convertBlocks(
  children: readonly HtmlNode[],
  state: ConversionState,
): TipTapNode[] {
  const result: TipTapNode[] = [];
  let inlineBuffer: TipTapNode[] = [];
  const flushInline = (): void => {
    const paragraph = makeParagraph(inlineBuffer);
    if (paragraph !== null) result.push(paragraph);
    inlineBuffer = [];
  };

  for (const child of children) {
    if (
      child.kind === "element" &&
      (child.name === "p" || /^h[1-3]$/u.test(child.name))
    ) {
      flushInline();
      const content = convertInline(child, state);
      const paragraph = makeParagraph(
        /^h[1-3]$/u.test(child.name) ? boldenText(content) : content,
      );
      if (paragraph !== null) result.push(paragraph);
      if (/^h[1-3]$/u.test(child.name)) state.flattenedHeadings += 1;
      continue;
    }
    if (
      child.kind === "element" &&
      (child.name === "ul" || child.name === "ol")
    ) {
      flushInline();
      result.push(convertList(child, state));
      continue;
    }
    if (child.kind === "element" && child.name === "blockquote") {
      flushInline();
      const content = convertInline(child, state);
      if (hasMeaningfulContent(content))
        result.push({ type: "blockquote", content });
      continue;
    }
    if (child.kind === "element" && child.name === "div") {
      flushInline();
      result.push(...convertBlocks(child.children, state));
      continue;
    }
    inlineBuffer.push(...convertInline(child, state));
  }
  flushInline();
  return result;
}

/** Converts Salesforce HTML into only nodes accepted by renderAutomatedEmail. */
export function convertSalesforceHtmlToTipTap(
  html: string,
): SalesforceHtmlConversion {
  const state: ConversionState = {
    unmapped: new Set(),
    flattenedHeadings: 0,
    droppedImages: 0,
  };
  const root = parseHtml(html);
  return {
    doc: { type: "doc", content: convertBlocks(root.children, state) },
    flattenedHeadings: state.flattenedHeadings,
    droppedImages: state.droppedImages,
    unmappedPlaceholders: [...state.unmapped].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export function convertSalesforceSubject(subject: string): {
  readonly subject: string;
  readonly unmappedPlaceholders: readonly string[];
} {
  const unmapped = new Set<string>();
  const converted = decodeHtmlEntities(subject).replace(
    mergeFieldPattern,
    (_match, rawPath: string) => {
      const path = rawPath.trim();
      const key = salesforceMergeFieldKey(path);
      if (key !== null) return `{{${key}}}`;
      unmapped.add(path);
      return `[SF: ${path}]`;
    },
  );
  return {
    subject: converted.replace(/\s+/gu, " ").trim(),
    unmappedPlaceholders: [...unmapped].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}
