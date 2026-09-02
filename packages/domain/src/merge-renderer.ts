import type {
  AudienceMember,
  MergeContext,
  MergeToken,
  MissingTokensByContact,
} from "./campaign-types.js";

const tokenPattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/gu;
const malformedTokenPattern = /\{\{(?![^}]*\}\})/u;
const supportedTokens = new Set<MergeToken>([
  "firstName",
  "projectName",
  "aliasEmail",
  "viewInBrowser",
]);

export interface MergeRenderer {
  render(
    template: { subject: string; bodyHtml: string; bodyText: string },
    context: MergeContext,
  ): { subject: string; html: string; text: string };
  validateTokens(
    template: { subject: string; bodyHtml: string },
    audience: readonly AudienceMember[],
  ): MissingTokensByContact;
}

function readTokenValue(
  context: MergeContext,
  token: string,
): string | null {
  switch (token) {
    case "firstName":
      return context.firstName;
    case "projectName":
      return context.projectName;
    case "aliasEmail":
      return context.aliasEmail;
    case "viewInBrowser":
      return context.viewInBrowserUrl;
    default:
      return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTemplate(
  template: string,
  context: MergeContext,
  formatter: (value: string) => string,
): string {
  return template.replace(tokenPattern, (_match, rawToken: string) => {
    const value = readTokenValue(context, rawToken);
    return value === null ? "" : formatter(value);
  });
}

function collectReferencedTokens(template: string): string[] {
  const tokens = new Set<string>();
  for (const match of template.matchAll(tokenPattern)) {
    const token = match[1];
    if (token !== undefined) {
      tokens.add(token);
    }
  }

  if (malformedTokenPattern.test(template)) {
    tokens.add("__malformed__");
  }

  return [...tokens];
}

function toMergeContext(member: AudienceMember): MergeContext {
  return {
    firstName: member.frozenFirstName,
    projectName: member.frozenProjectName,
    aliasEmail: member.frozenAliasEmail,
    viewInBrowserUrl: null,
  };
}

function readAudienceRecipientKey(member: AudienceMember): string {
  return member.contactId ?? member.newsletterSubscriberId ?? member.frozenEmail;
}

export function createMergeRenderer(): MergeRenderer {
  return {
    render(template, context) {
      return {
        subject: renderTemplate(template.subject, context, (value) => value),
        html: renderTemplate(template.bodyHtml, context, escapeHtml),
        text: renderTemplate(template.bodyText, context, (value) => value),
      };
    },

    validateTokens(template, audience) {
      const referencedTokens = new Set<string>([
        ...collectReferencedTokens(template.subject),
        ...collectReferencedTokens(template.bodyHtml),
      ]);
      const missingByContact: Record<string, string[]> = {};

      for (const member of audience) {
        const context = toMergeContext(member);
        const missingTokens: string[] = [];

        for (const token of referencedTokens) {
          if (token === "__malformed__") {
            missingTokens.push(token);
            continue;
          }

          if (!supportedTokens.has(token as MergeToken)) {
            continue;
          }

          if (token === "viewInBrowser") {
            continue;
          }

          if (readTokenValue(context, token) === null) {
            missingTokens.push(token);
          }
        }

        if (missingTokens.length > 0) {
          missingByContact[readAudienceRecipientKey(member)] = missingTokens;
        }
      }

      return missingByContact;
    },
  };
}
