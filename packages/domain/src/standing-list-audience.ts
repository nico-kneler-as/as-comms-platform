import type { AudienceMember } from "./campaign-types.js";

export interface StandingListAudienceMember {
  readonly email: string;
  readonly newsletterSubscriberId: string | null;
  readonly firstName: string | null;
}

export function toStandingListAudienceMembers(
  members: readonly StandingListAudienceMember[],
): readonly AudienceMember[] {
  return members.map((member) => ({
    contactId: null,
    newsletterSubscriberId: member.newsletterSubscriberId,
    frozenEmail: member.email,
    frozenFirstName: member.firstName,
    frozenProjectName: null,
    frozenProjectId: null,
    frozenAliasEmail: null,
  }));
}
