import type { CampaignRunRecord } from "@as-comms/contracts";

import type { AudienceMember, ExcludedMember } from "./campaign-types.js";

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
    isSuppressed(normalizedEmail: string): Promise<boolean>;
  };
  readonly salesforceEmailOptOuts: {
    listOptedOutEmails(): Promise<ReadonlySet<string>>;
    listUnsubscribedFromAllEmails(): Promise<ReadonlySet<string>>;
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requiresNewsletterSuppressionCheck(run: CampaignRunRecord): boolean {
  return (
    run.launchType !== "sms" &&
    (run.kind === "newsletter" ||
      (run.projectId === null &&
        run.audienceCriteria.initialFilter === "csv_upload"))
  );
}

async function resolveExclusionReason(
  repositories: ExclusionFilterRepositories,
  run: CampaignRunRecord,
  member: AudienceMember,
  at: Date,
  salesforceOptedOutEmails: ReadonlySet<string> | null,
  allOptedOutEmails: ReadonlySet<string> | null,
  newsletterOptedOutEmails: ReadonlySet<string> | null,
): Promise<ExcludedMember["reason"] | null> {
  if (await repositories.suppressionList.isSuppressed(normalizeEmail(member.frozenEmail), at)) {
    return "suppressed";
  }

  if (
    salesforceOptedOutEmails?.has(normalizeEmail(member.frozenEmail)) === true
  ) {
    return "opted_out_salesforce";
  }

  if (
    requiresNewsletterSuppressionCheck(run) &&
    await repositories.newsletterSuppressions.isSuppressed(
      normalizeEmail(member.frozenEmail),
    )
  ) {
    return "opted_out_newsletter";
  }

  if (
    allOptedOutEmails?.has(normalizeEmail(member.frozenEmail)) === true ||
    (member.contactId !== null &&
      await repositories.contactConsent.isOptedOut(
        member.contactId,
        { type: "all" },
        at,
      ))
  ) {
    return "opted_out_all";
  }

  if (
    run.kind === "project" &&
    member.contactId !== null &&
    member.frozenProjectId !== null &&
    (await repositories.contactConsent.isOptedOut(
      member.contactId,
      { type: "project", id: member.frozenProjectId },
      at,
    ))
  ) {
    return "opted_out_project";
  }

  if (
    run.kind === "newsletter" &&
    (newsletterOptedOutEmails?.has(normalizeEmail(member.frozenEmail)) === true ||
      (member.contactId !== null &&
        await repositories.contactConsent.isOptedOut(
          member.contactId,
          { type: "newsletter" },
          at,
        )))
  ) {
    return "opted_out_newsletter";
  }

  return null;
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
      const emailExclusions = run.launchType === "sms"
        ? {
            salesforceOptedOutEmails: null,
            allOptedOutEmails: null,
            newsletterOptedOutEmails: null,
          }
        : await (async () => {
            const [
              salesforceOptedOutEmails,
              contactAllOptedOutEmails,
              salesforceAllOptedOutEmails,
              newsletterOptedOutEmails,
            ] = await Promise.all([
              deps.repositories.salesforceEmailOptOuts.listOptedOutEmails(),
              deps.repositories.contactConsent.listOptedOutEmails("all", at),
              deps.repositories.salesforceEmailOptOuts.listUnsubscribedFromAllEmails(),
              run.kind === "newsletter"
                ? deps.repositories.contactConsent.listOptedOutEmails(
                    "newsletter",
                    at,
                  )
                : Promise.resolve(null),
            ]);
            return {
              salesforceOptedOutEmails,
              allOptedOutEmails: new Set([
                ...contactAllOptedOutEmails,
                ...salesforceAllOptedOutEmails,
              ].map(normalizeEmail)),
              newsletterOptedOutEmails:
                newsletterOptedOutEmails === null
                  ? null
                  : new Set([...newsletterOptedOutEmails].map(normalizeEmail)),
            };
          })();

      const eligible: AudienceMember[] = [];
      const excluded: ExcludedMember[] = [];

      for (const member of members) {
        const reason = await resolveExclusionReason(
          deps.repositories,
          run,
          member,
          at,
          emailExclusions.salesforceOptedOutEmails,
          emailExclusions.allOptedOutEmails,
          emailExclusions.newsletterOptedOutEmails,
        );

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
