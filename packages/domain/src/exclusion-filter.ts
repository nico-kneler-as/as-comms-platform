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
  };
  readonly suppressionList: {
    isSuppressed(normalizedEmail: string, at: Date): Promise<boolean>;
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

async function resolveExclusionReason(
  repositories: ExclusionFilterRepositories,
  run: CampaignRunRecord,
  member: AudienceMember,
  at: Date,
): Promise<ExcludedMember["reason"] | null> {
  if (await repositories.suppressionList.isSuppressed(normalizeEmail(member.frozenEmail), at)) {
    return "suppressed";
  }

  if (
    member.contactId !== null &&
    await repositories.contactConsent.isOptedOut(
      member.contactId,
      { type: "all" },
      at,
    )
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
    member.contactId !== null &&
    (await repositories.contactConsent.isOptedOut(
      member.contactId,
      { type: "newsletter" },
      at,
    ))
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

      const eligible: AudienceMember[] = [];
      const excluded: ExcludedMember[] = [];

      for (const member of members) {
        const reason = await resolveExclusionReason(
          deps.repositories,
          run,
          member,
          at,
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
