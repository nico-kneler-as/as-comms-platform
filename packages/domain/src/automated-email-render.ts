import { escapeHtml } from "./broadcast-email-render.js";

const tokenPattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/gu;
const malformedTokenPattern = /\{\{(?![^}]*\}\})/u;

export interface AutomatedEmailRenderInput {
  readonly subjectTemplate: string;
  readonly bodyDoc: unknown;
  readonly values: Record<string, string>;
  readonly frame: {
    readonly projectName: string;
    readonly reasonLine: string;
  };
}

export interface AutomatedEmailRenderOutput {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export type AutomatedEmailRenderErrorCode =
  | "malformed_token"
  | "unknown_token"
  | "unsupported_node"
  | "unsupported_mark"
  | "invalid_link"
  | "missing_value";

export class AutomatedEmailRenderError extends Error {
  readonly code: AutomatedEmailRenderErrorCode;
  readonly offender: string;

  constructor(code: AutomatedEmailRenderErrorCode, offender: string) {
    super(`${code}: ${offender}`);
    this.name = "AutomatedEmailRenderError";
    this.code = code;
    this.offender = offender;
  }
}

interface TipTapNode {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
  readonly marks?: unknown;
  readonly attrs?: unknown;
}

interface RenderedNode {
  readonly html: string;
  readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNodeType(node: TipTapNode): string {
  return typeof node.type === "string" ? node.type : "(missing type)";
}

function readNodeChildren(node: TipTapNode): readonly unknown[] {
  if (node.content === undefined) {
    return [];
  }

  if (!Array.isArray(node.content)) {
    throw new AutomatedEmailRenderError("unsupported_node", readNodeType(node));
  }

  return node.content;
}

function readMergeValue(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (
    !Object.prototype.hasOwnProperty.call(values, key) ||
    value === undefined
  ) {
    throw new AutomatedEmailRenderError("missing_value", key);
  }

  return value;
}

function renderSubject(
  subjectTemplate: string,
  values: Record<string, string>,
): string {
  if (malformedTokenPattern.test(subjectTemplate)) {
    throw new AutomatedEmailRenderError("malformed_token", subjectTemplate);
  }

  return subjectTemplate.replace(tokenPattern, (_match, key: string) => {
    const value = values[key];
    if (
      !Object.prototype.hasOwnProperty.call(values, key) ||
      value === undefined
    ) {
      throw new AutomatedEmailRenderError("unknown_token", key);
    }

    return value;
  });
}

function readSafeLinkHref(mark: Record<string, unknown>): string {
  const attrs = mark.attrs;
  const href = isRecord(attrs) ? attrs.href : undefined;
  if (typeof href !== "string") {
    throw new AutomatedEmailRenderError("invalid_link", "(missing href)");
  }

  let protocol: string;
  try {
    protocol = new URL(href).protocol;
  } catch {
    throw new AutomatedEmailRenderError("invalid_link", href);
  }

  if (protocol !== "http:" && protocol !== "https:" && protocol !== "mailto:") {
    throw new AutomatedEmailRenderError("invalid_link", href);
  }

  return href;
}

function renderTextNode(node: TipTapNode): RenderedNode {
  if (typeof node.text !== "string") {
    throw new AutomatedEmailRenderError("unsupported_node", "text");
  }

  if (node.marks !== undefined && !Array.isArray(node.marks)) {
    throw new AutomatedEmailRenderError("unsupported_mark", "(invalid marks)");
  }

  let html = escapeHtml(node.text);
  let text = node.text;
  for (const rawMark of node.marks ?? []) {
    if (!isRecord(rawMark)) {
      throw new AutomatedEmailRenderError("unsupported_mark", "(missing type)");
    }

    const markType =
      typeof rawMark.type === "string" ? rawMark.type : "(missing type)";
    switch (markType) {
      case "bold":
        html = `<strong style="font-weight:700;">${html}</strong>`;
        break;
      case "italic":
        html = `<em style="font-style:italic;">${html}</em>`;
        break;
      case "link": {
        const href = readSafeLinkHref(rawMark);
        html = `<a href="${escapeHtml(href)}" style="color:#213515;text-decoration:underline;">${html}</a>`;
        text = `${text} (${href})`;
        break;
      }
      default:
        throw new AutomatedEmailRenderError("unsupported_mark", markType);
    }
  }

  return { html, text };
}

function renderInlineChildren(
  node: TipTapNode,
  values: Record<string, string>,
): RenderedNode {
  const rendered = readNodeChildren(node).map((child) =>
    renderNode(child, values),
  );
  return {
    html: rendered.map((child) => child.html).join(""),
    text: rendered.map((child) => child.text).join(""),
  };
}

function prefixListItem(
  text: string,
  prefix: string,
  indentation: string,
): string {
  const continuation = `${indentation}${" ".repeat(prefix.length)}`;
  return text
    .split("\n")
    .map((line, index) =>
      index === 0 ? `${indentation}${prefix}${line}` : `${continuation}${line}`,
    )
    .join("\n");
}

function renderList(
  node: TipTapNode,
  values: Record<string, string>,
  ordered: boolean,
  depth: number,
): RenderedNode {
  const children = readNodeChildren(node);
  const renderedItems = children.map((rawItem, index) => {
    if (!isRecord(rawItem) || readNodeType(rawItem) !== "listItem") {
      const type = isRecord(rawItem) ? readNodeType(rawItem) : "(missing type)";
      throw new AutomatedEmailRenderError("unsupported_node", type);
    }

    const itemChildren = readNodeChildren(rawItem);
    const contentChildren = itemChildren.filter(
      (child) =>
        !isRecord(child) ||
        (readNodeType(child) !== "bulletList" &&
          readNodeType(child) !== "orderedList"),
    );
    const nestedLists = itemChildren.filter(
      (child): child is TipTapNode =>
        isRecord(child) &&
        (readNodeType(child) === "bulletList" ||
          readNodeType(child) === "orderedList"),
    );
    const renderedContent = contentChildren.map((child) =>
      renderNode(child, values),
    );
    const renderedNested = nestedLists.map((child) =>
      renderList(
        child,
        values,
        readNodeType(child) === "orderedList",
        depth + 1,
      ),
    );
    const itemHtml = [
      renderedContent.map((child) => child.html).join(""),
      renderedNested.map((child) => child.html).join(""),
    ].join("");
    const itemText = renderedContent.map((child) => child.text).join("\n\n");
    const prefix = ordered ? `${String(index + 1)}. ` : "- ";
    const listItemText = prefixListItem(itemText, prefix, "  ".repeat(depth));
    const nestedText = renderedNested.map((child) => child.text).join("\n");

    return {
      html: `<li style="margin:0 0 8px;">${itemHtml}</li>`,
      text:
        nestedText.length === 0
          ? listItemText
          : `${listItemText}\n${nestedText}`,
    };
  });
  const tag = ordered ? "ol" : "ul";

  return {
    html: `<${tag} style="margin:0 0 16px;padding-left:24px;">${renderedItems.map((item) => item.html).join("")}</${tag}>`,
    text: renderedItems.map((item) => item.text).join("\n"),
  };
}

function renderNode(
  rawNode: unknown,
  values: Record<string, string>,
): RenderedNode {
  if (!isRecord(rawNode)) {
    throw new AutomatedEmailRenderError("unsupported_node", "(missing type)");
  }

  const node = rawNode as TipTapNode;
  const type = readNodeType(node);
  switch (type) {
    case "doc": {
      const children = readNodeChildren(node).map((child) =>
        renderNode(child, values),
      );
      return {
        html: children.map((child) => child.html).join(""),
        text: children.map((child) => child.text).join("\n\n"),
      };
    }
    case "paragraph": {
      const content = renderInlineChildren(node, values);
      return {
        html: `<p style="margin:0 0 16px;">${content.html}</p>`,
        text: content.text,
      };
    }
    case "blockquote": {
      const content = renderInlineChildren(node, values);
      return {
        html: `<blockquote style="margin:0 0 16px;padding:0 0 0 16px;border-left:3px solid #DDE1DA;color:#5F625E;">${content.html}</blockquote>`,
        text: content.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      };
    }
    case "text":
      return renderTextNode(node);
    case "bulletList":
      return renderList(node, values, false, 0);
    case "orderedList":
      return renderList(node, values, true, 0);
    case "listItem": {
      const content = renderInlineChildren(node, values);
      return {
        html: `<li style="margin:0 0 8px;">${content.html}</li>`,
        text: content.text,
      };
    }
    case "hardBreak":
      return { html: "<br>", text: "\n" };
    case "mergeField": {
      const attrs = node.attrs;
      const key = isRecord(attrs) ? attrs.key : undefined;
      if (typeof key !== "string") {
        throw new AutomatedEmailRenderError("missing_value", "(missing key)");
      }

      const value = readMergeValue(values, key);
      return { html: escapeHtml(value), text: value };
    }
    default:
      throw new AutomatedEmailRenderError("unsupported_node", type);
  }
}

function renderTransactionalFrame(input: {
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly frame: AutomatedEmailRenderInput["frame"];
}): Pick<AutomatedEmailRenderOutput, "html" | "text"> {
  const wordmark = `Adventure Scientists · ${input.frame.projectName}`;
  // Frame styling follows the 2026-08 brand book (Pine green #213515, Snow white
  // #FAFBF9, Charcoal #20211F, Stone gray #939393, thin line dividers). Zero
  // images and zero external resources is a deliverability invariant, not a
  // styling choice — do not add logos or webfonts here (PRD #693).
  const projectDisplay = escapeHtml(input.frame.projectName.toUpperCase());
  const html = [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background-color:#FAFBF9;">',
    '<tr><td align="center" style="padding:0 12px 24px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;background-color:#FAFBF9;">',
    '<tr><td style="height:4px;background-color:#213515;font-size:0;line-height:0;">&nbsp;</td></tr>',
    `<tr><td style="padding:28px 32px 18px;border-bottom:1px solid #DDE1DA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"><div style="font-size:13px;font-weight:600;letter-spacing:3px;color:#20211F;">ADVENTURE&nbsp;SCIENTISTS</div><div style="padding-top:4px;font-size:11px;letter-spacing:1.5px;color:#939393;">${projectDisplay}</div></td></tr>`,
    `<tr><td style="padding:26px 32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.55;color:#20211F;">${input.bodyHtml}</td></tr>`,
    "<tr><td style=\"padding:18px 32px 32px;border-top:1px solid #DDE1DA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.5;color:#939393;\">",
    `<div>Adventure Scientists</div><div>${escapeHtml(input.frame.reasonLine)}</div>`,
    "</td></tr></table></td></tr></table>",
  ].join("");

  return {
    html,
    text: `${wordmark}\n\n${input.bodyText}\n\nAdventure Scientists\n${input.frame.reasonLine}`,
  };
}

/** Renders a transactional email without performing I/O or applying value fallbacks. */
/**
 * Collects the merge-field keys a template actually references — `mergeField`
 * pills in the body document plus `{{token}}`s in the subject — in encounter
 * order, de-duplicated. The send pipeline resolves ONLY these keys, so a
 * template that never mentions a field can never be held for it.
 */
export function collectAutomatedEmailMergeKeys(
  subjectTemplate: string,
  bodyDoc: unknown,
): readonly string[] {
  const keys: string[] = [];
  const push = (key: string): void => {
    if (key.length > 0 && !keys.includes(key)) keys.push(key);
  };
  for (const match of subjectTemplate.matchAll(tokenPattern)) {
    push(match[1] ?? "");
  }
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const record = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (record.type === "mergeField") {
      const attrs = record.attrs as { key?: unknown } | undefined;
      if (typeof attrs?.key === "string") push(attrs.key);
    }
    if (Array.isArray(record.content)) record.content.forEach(walk);
  };
  walk(bodyDoc);
  return keys;
}

export function renderAutomatedEmail(
  input: AutomatedEmailRenderInput,
): AutomatedEmailRenderOutput {
  const subject = renderSubject(input.subjectTemplate, input.values);
  const body = renderNode(input.bodyDoc, input.values);
  const frame = renderTransactionalFrame({
    bodyHtml: body.html,
    bodyText: body.text,
    frame: input.frame,
  });

  return { subject, ...frame };
}
