export function escapeComposerHtmlSegment(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function plaintextToComposerHtml(value: string): string {
  return value
    .split(/\n\s*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => {
      const html = paragraph
        .split("\n")
        .map((segment) => escapeComposerHtmlSegment(segment))
        .join("<br>");

      return `<p>${html}</p>`;
    })
    .join("");
}
