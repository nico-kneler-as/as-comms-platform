import type { Stage1RepositoryBundle } from "@as-comms/domain";

interface ResolveSmsDraftProjectIdDeps {
  readonly repositories: Pick<
    Stage1RepositoryBundle,
    "contactMemberships" | "projectDimensions"
  >;
  readonly aliases: {
    listAssigned(): Promise<
      readonly {
        readonly alias: string;
        readonly projectId: string | null;
      }[]
    >;
  };
  readonly timelinePresentation: {
    findLastInboundAliasForContact(contactId: string): Promise<string | null>;
  };
}

function normalizeMembershipStatus(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replaceAll("_", "-");
}

function membershipSortRank(membershipStatus: string | null): number {
  switch (normalizeMembershipStatus(membershipStatus)) {
    case "lead":
      return 0;
    case "applied":
    case "applicant":
      return 1;
    case "in-training":
    case "training":
      return 2;
    case "trip-planning":
      return 3;
    case "in-field":
    case "active":
      return 4;
    case "successful":
    case "completed":
      return 5;
    default:
      return 6;
  }
}

export async function resolveSmsDraftProjectId(
  deps: ResolveSmsDraftProjectIdDeps,
  contactId: string,
): Promise<string | null> {
  const lastInboundAlias =
    await deps.timelinePresentation.findLastInboundAliasForContact(contactId);

  if (lastInboundAlias !== null) {
    const assignedAliases = await deps.aliases.listAssigned();
    const inboundAliasProjectId =
      assignedAliases.find(
        (alias) =>
          alias.alias === lastInboundAlias && alias.projectId !== null,
      )?.projectId ?? null;

    if (inboundAliasProjectId !== null) {
      const [project] = await deps.repositories.projectDimensions.listByIds([
        inboundAliasProjectId,
      ]);

      if (project !== undefined) {
        return inboundAliasProjectId;
      }
    }
  }

  const memberships = await deps.repositories.contactMemberships.listByContactIds([
    contactId,
  ]);

  if (memberships.length === 0) {
    return null;
  }

  const membershipProjectIds = Array.from(
    new Set(
      memberships
        .map((membership) => membership.projectId)
        .filter((projectId): projectId is string => projectId !== null),
    ),
  );

  if (membershipProjectIds.length === 0) {
    return null;
  }

  const projectDimensions =
    await deps.repositories.projectDimensions.listByIds(membershipProjectIds);
  const activeProjectIds = new Set(
    projectDimensions
      .filter((project) => project.isActive === true)
      .map((project) => project.projectId),
  );
  const distinctActiveProjectIds = Array.from(
    new Set(
      memberships
        .map((membership) => membership.projectId)
        .filter(
          (projectId): projectId is string =>
            projectId !== null && activeProjectIds.has(projectId),
        ),
    ),
  );

  if (distinctActiveProjectIds.length === 1) {
    return distinctActiveProjectIds[0] ?? null;
  }

  const primaryMembership =
    [...memberships].sort((left, right) => {
      const rankDifference =
        membershipSortRank(left.status) - membershipSortRank(right.status);

      if (rankDifference !== 0) {
        return rankDifference;
      }

      if (left.projectId !== right.projectId) {
        return (left.projectId ?? "").localeCompare(right.projectId ?? "");
      }

      return left.id.localeCompare(right.id);
    })[0] ?? null;

  return primaryMembership?.projectId ?? null;
}
