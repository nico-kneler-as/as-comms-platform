import type { CampaignRunRecord } from "@as-comms/contracts";

import type { AudienceMember, ExcludedMember } from "./campaign-types.js";

type NewsletterSuppressionReason = "unsubscribed" | "cleaned" | "platform_optout";

export interface NewsletterSuppressionRow {
  readonly email: string;
  readonly reason: NewsletterSuppressionReason;
  readonly source: string;
  readonly createdAt: Date;
}

/**
 * How a newsletter suppression bears on a Houston list send (PRD #768).
 * - newsletter_only: clearly a newsletter-only unsubscribe; a list send ignores it.
 * - bounced: the address doesn't work ("cleaned").
 * - broad: may have meant more than the newsletter, so a list send honours it.
 */
export type NewsletterSuppressionKind = "newsletter_only" | "bounced" | "broad";

/**
 * When #763 went live. From then on, an "unsubscribe from all" click also
 * leaves a Salesforce all_opt_out event (and, since PRD #768, a ledger row), so
 * a later recipient_click platform_optout is a newsletter-only unsubscribe.
 * Before it, both clicks were stored the same way. Rounded up to be safe.
 */
const ALL_CLICK_DISTINGUISHABLE_SINCE = new Date("2026-11-11T03:00:00.000Z");

export function classifyNewsletterSuppression(
  row: Pick<NewsletterSuppressionRow, "reason" | "source" | "createdAt">,
): NewsletterSuppressionKind {
  if (row.reason === "cleaned") {
    return "bounced";
  }
  // Mailchimp newsletter-list unsubscribes.
  if (row.reason === "unsubscribed") {
    return "newsletter_only";
  }
  // platform_optout: a click on our newsletter unsubscribe page is
  // newsletter-only once "all" clicks are recorded separately. Postmark
  // stream unsubscribes (provider_event) and Salesforce opt-outs stay broad.
  if (
    row.source === "recipient_click" &&
    row.createdAt.getTime() >= ALL_CLICK_DISTINGUISHABLE_SINCE.getTime()
  ) {
    return "newsletter_only";
  }
  return "broad";
}

type EmailOptOutScope =
  | { readonly type: "all" }
  | { readonly type: "list"; readonly listId: string };

interface ExclusionFilterRepositories {
  readonly campaignRuns: {
    findById(id: string): Promise<CampaignRunRecord | null>;
  };
  readonly contactConsent: {
    isOptedOut(
      contactId: string,
      scope: { readonly type: "project" | "newsletter" | "all"; readonly id?: string },
      at: Date,
    ): Promise<boolean>;
    listOptedOutEmails(
      scopeType: "all" | "newsletter",
      at: Date,
    ): Promise<ReadonlySet<string>>;
  };
  readonly suppressionList: {
    isSuppressed(normalizedEmail: string, at: Date): Promise<boolean>;
  };
  readonly newsletterSuppressions: {
    listForExclusion(): Promise<readonly NewsletterSuppressionRow[]>;
  };
  readonly salesforceEmailOptOuts: {
    listOptedOutEmails(): Promise<ReadonlySet<string>>;
    listUnsubscribedFromAllEmails(): Promise<ReadonlySet<string>>;
  };
  readonly emailOptOuts: {
    listEmails(scope: EmailOptOutScope, at: Date): Promise<ReadonlySet<string>>;
  };
}

export interface ExclusionFilter {
  applyExclusions(
    members: readonly AudienceMember[],
    runId: string,
    at: Date,
  ): Promise<{
    eligible: AudienceMember[];
    excluded: ExcludedMember[];
  }>;
}

/**
 * Which consent rules a send follows.
 * - project: project opt-outs apply.
 * - newsletter: newsletter opt-outs apply.
 * - list: a Houston list (PRD #768). Newsletter-only unsubscribes and project
 *   opt-outs do not apply; leaving this list does, and so do bounces and
 *   newsletter suppressions that may have meant more (see
 *   classifyNewsletterSuppression).
 * `honoursNewsletterSuppressions` is true for every newsletter email send and
 * for a project-less CSV email send (#734); never for SMS.
 */
export type RecipientExclusionScope =
  | {
      readonly type: "project" | "newsletter";
      readonly honoursNewsletterSuppressions: boolean;
    }
  | { readonly type: "list"; readonly listId: string };

/** What is known about one recipient. Unchecked facts are false or null. */
export interface RecipientExclusionFacts {
  readonly suppressed: boolean;
  readonly salesforceEmailOptOut: boolean;
  readonly newsletterSuppression: NewsletterSuppressionKind | null;
  readonly allOptOut: boolean;
  readonly projectOptOut: boolean;
  readonly newsletterOptOut: boolean;
  readonly listOptOut: boolean;
}

/**
 * The consent rule, in one place. The send-time filter and the Lists page
 * status (PRD #768) both call it, so they cannot disagree. The order of the
 * checks decides which reason is reported when several apply.
 */
export function decideRecipientExclusion(
  facts: RecipientExclusionFacts,
  scope: RecipientExclusionScope,
): ExcludedMember["reason"] | null {
  if (facts.suppressed) {
    return "suppressed";
  }
  if (facts.salesforceEmailOptOut) {
    return "opted_out_salesforce";
  }

  if (scope.type === "list") {
    if (facts.allOptOut) {
      return "opted_out_all";
    }
    // A bounced address stays out, and so does a newsletter suppression that
    // may have meant more than the newsletter. A newsletter-only unsubscribe
    // does not stop a list email.
    if (facts.newsletterSuppression === "bounced") {
      return "suppressed";
    }
    if (facts.newsletterSuppression === "broad") {
      return "opted_out_newsletter";
    }
    if (facts.listOptOut) {
      return "opted_out_list";
    }
    return null;
  }

  if (scope.honoursNewsletterSuppressions && facts.newsletterSuppression !== null) {
    return "opted_out_newsletter";
  }
  if (facts.allOptOut) {
    return "opted_out_all";
  }
  if (scope.type === "project" && facts.projectOptOut) {
    return "opted_out_project";
  }
  if (scope.type === "newsletter" && facts.newsletterOptOut) {
    return "opted_out_newsletter";
  }
  return null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeSet(values: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...values].map(normalizeEmail));
}

const EMPTY: ReadonlySet<string> = new Set();

function resolveScope(run: CampaignRunRecord): RecipientExclusionScope {
  const isEmail = run.launchType !== "sms";
  const listId = run.audienceListId ?? null;
  if (isEmail && listId !== null) {
    return { type: "list", listId };
  }
  if (run.kind === "newsletter") {
    return { type: "newsletter", honoursNewsletterSuppressions: isEmail };
  }
  return {
    type: "project",
    honoursNewsletterSuppressions:
      isEmail &&
      run.projectId === null &&
      run.audienceCriteria.initialFilter === "csv_upload",
  };
}

interface EmailSets {
  readonly salesforceOptedOut: ReadonlySet<string>;
  readonly allOptedOut: ReadonlySet<string>;
  readonly newsletterOptedOut: ReadonlySet<string>;
  readonly listOptedOut: ReadonlySet<string>;
  readonly newsletterSuppressionByEmail: ReadonlyMap<
    string,
    NewsletterSuppressionKind
  >;
}

const NO_EMAIL_SETS: EmailSets = {
  salesforceOptedOut: EMPTY,
  allOptedOut: EMPTY,
  newsletterOptedOut: EMPTY,
  listOptedOut: EMPTY,
  newsletterSuppressionByEmail: new Map(),
};

/**
 * Loads every email-keyed set once per call, never once per member (newsletter
 * sends have about 34,000 members). SMS uses none of them.
 */
async function loadEmailSets(
  repositories: ExclusionFilterRepositories,
  run: CampaignRunRecord,
  scope: RecipientExclusionScope,
  at: Date,
): Promise<EmailSets> {
  if (run.launchType === "sms") {
    return NO_EMAIL_SETS;
  }

  const needsNewsletterSuppressions =
    scope.type === "list" || scope.honoursNewsletterSuppressions;

  const [
    salesforceOptedOut,
    contactAllOptedOut,
    salesforceAllOptedOut,
    ledgerAllOptedOut,
    newsletterOptedOut,
    listOptedOut,
    newsletterSuppressionRows,
  ] = await Promise.all([
    repositories.salesforceEmailOptOuts.listOptedOutEmails(),
    repositories.contactConsent.listOptedOutEmails("all", at),
    repositories.salesforceEmailOptOuts.listUnsubscribedFromAllEmails(),
    repositories.emailOptOuts.listEmails({ type: "all" }, at),
    scope.type === "newsletter"
      ? repositories.contactConsent.listOptedOutEmails("newsletter", at)
      : Promise.resolve(EMPTY),
    scope.type === "list"
      ? repositories.emailOptOuts.listEmails(
          { type: "list", listId: scope.listId },
          at,
        )
      : Promise.resolve(EMPTY),
    needsNewsletterSuppressions
      ? repositories.newsletterSuppressions.listForExclusion()
      : Promise.resolve([]),
  ]);

  const newsletterSuppressionByEmail = new Map<
    string,
    NewsletterSuppressionKind
  >();
  for (const row of newsletterSuppressionRows) {
    newsletterSuppressionByEmail.set(
      normalizeEmail(row.email),
      classifyNewsletterSuppression(row),
    );
  }

  return {
    salesforceOptedOut: normalizeSet(salesforceOptedOut),
    allOptedOut: new Set(
      [...contactAllOptedOut, ...salesforceAllOptedOut, ...ledgerAllOptedOut].map(
        normalizeEmail,
      ),
    ),
    newsletterOptedOut: normalizeSet(newsletterOptedOut),
    listOptedOut: normalizeSet(listOptedOut),
    newsletterSuppressionByEmail,
  };
}

/** Per-member lookups, only the ones the scope needs. */
async function gatherFacts(
  repositories: ExclusionFilterRepositories,
  scope: RecipientExclusionScope,
  sets: EmailSets,
  member: AudienceMember,
  at: Date,
): Promise<RecipientExclusionFacts> {
  const email = normalizeEmail(member.frozenEmail);
  const contactId = member.contactId;
  const projectId = member.frozenProjectId;

  const [suppressed, contactAllOptOut, projectOptOut, contactNewsletterOptOut] =
    await Promise.all([
      repositories.suppressionList.isSuppressed(email, at),
      contactId === null
        ? Promise.resolve(false)
        : repositories.contactConsent.isOptedOut(contactId, { type: "all" }, at),
      scope.type === "project" && contactId !== null && projectId !== null
        ? repositories.contactConsent.isOptedOut(
            contactId,
            { type: "project", id: projectId },
            at,
          )
        : Promise.resolve(false),
      scope.type === "newsletter" && contactId !== null
        ? repositories.contactConsent.isOptedOut(
            contactId,
            { type: "newsletter" },
            at,
          )
        : Promise.resolve(false),
    ]);

  return {
    suppressed,
    salesforceEmailOptOut: sets.salesforceOptedOut.has(email),
    newsletterSuppression: sets.newsletterSuppressionByEmail.get(email) ?? null,
    allOptOut: sets.allOptedOut.has(email) || contactAllOptOut,
    projectOptOut,
    newsletterOptOut: sets.newsletterOptedOut.has(email) || contactNewsletterOptOut,
    listOptOut: sets.listOptedOut.has(email),
  };
}

export function createExclusionFilter(deps: {
  repositories: ExclusionFilterRepositories;
}): ExclusionFilter {
  return {
    async applyExclusions(members, runId, at) {
      const run = await deps.repositories.campaignRuns.findById(runId);
      if (run === null) {
        throw new Error(`Campaign run ${runId} was not found.`);
      }

      const scope = resolveScope(run);
      const sets = await loadEmailSets(deps.repositories, run, scope, at);

      const eligible: AudienceMember[] = [];
      const excluded: ExcludedMember[] = [];

      for (const member of members) {
        const facts = await gatherFacts(
          deps.repositories,
          scope,
          sets,
          member,
          at,
        );
        const reason = decideRecipientExclusion(facts, scope);

        if (reason === null) {
          eligible.push(member);
          continue;
        }

        excluded.push({
          ...member,
          reason,
        });
      }

      return {
        eligible,
        excluded,
      };
    },
  };
}
