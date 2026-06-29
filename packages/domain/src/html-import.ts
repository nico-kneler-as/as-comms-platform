const MAILCHIMP_FIRST_NAME_TAG = /\*\|\s*FNAME\s*\|\*/giu;
const MAILCHIMP_TAG = /\*\|([\s\S]*?)\|\*/gu;

const UNSUBSCRIBE_WARNING =
  "An unsubscribe/footer block was detected — remove it; the platform appends its own unsubscribe footer.";

function canonicalizeMailchimpTag(rawTag: string): string {
  const inner = rawTag.slice(2, -2).trim();
  return `*|${inner}|*`;
}

export function prepareUploadedHtml(rawHtml: string): {
  html: string;
  warnings: string[];
} {
  const html = rawHtml.replace(MAILCHIMP_FIRST_NAME_TAG, "{{firstName}}");
  const warnings: string[] = [];

  const leftoverTags = Array.from(html.matchAll(MAILCHIMP_TAG), (match) =>
    canonicalizeMailchimpTag(match[0]),
  );
  const distinctLeftoverTags = [...new Set(leftoverTags)];

  if (distinctLeftoverTags.length > 0) {
    warnings.push(
      `Unsupported Mailchimp tags left as-is and will not render: ${distinctLeftoverTags.join(", ")}`,
    );
  }

  const hasUnsubscribeText = /unsubscribe/iu.test(html);
  const hasMailchimpUnsubscribeTag = distinctLeftoverTags.some((tag) => {
    const normalized = tag.toUpperCase();
    return normalized === "*|UNSUB|*" || normalized === "*|UPDATE_PROFILE|*";
  });

  if (hasUnsubscribeText || hasMailchimpUnsubscribeTag) {
    warnings.push(UNSUBSCRIBE_WARNING);
  }

  return { html, warnings };
}
