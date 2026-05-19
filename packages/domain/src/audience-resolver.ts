import type {
  AudienceCriteria,
  CanonicalEventRecord,
  ContactMembershipRecord,
  ContactRecord,
  ProjectDimensionRecord,
} from "@as-comms/contracts";
import { normalizeExpeditionMemberStatus } from "@as-comms/contracts";

import type {
  CanonicalEventRepository,
  ContactMembershipRepository,
  ContactRepository,
  ProjectDimensionRepository,
} from "./repositories.js";
import type { SettingsProjectsRepository } from "./settings/repositories.js";
import type { AudienceMember } from "./campaign-types.js";

interface AudienceResolverRepositories {
  readonly contacts: Pick<ContactRepository, "listAll">;
  readonly contactMemberships: Pick<ContactMembershipRepository, "listByContactIds">;
  readonly canonicalEvents: Pick<CanonicalEventRepository, "listByContactIds">;
  readonly projectDimensions: Pick<ProjectDimensionRepository, "listByIds">;
  readonly settingsProjects: Pick<SettingsProjectsRepository, "findById">;
}

export interface AudienceResolver {
  resolveAudience(
    criteria: AudienceCriteria,
    at: Date,
  ): Promise<AudienceMember[]>;
  estimateCount(criteria: AudienceCriteria, at: Date): Promise<number>;
}

function readFirstName(displayName: string): string | null {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [firstName] = trimmed.split(/\s+/u);
  return firstName?.trim().length ? firstName.trim() : null;
}

function normalizeAliasEmail(address: string | null | undefined): string | null {
  const trimmed = address?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

function buildWindowStart(
  window: AudienceCriteria["lastActivityWindow"],
  at: Date,
): Date | null {
  switch (window) {
    case "all_time":
      return null;
    case "last_year":
      return new Date(at.getTime() - 365 * 24 * 60 * 60 * 1000);
    case "last_90_days":
      return new Date(at.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "last_30_days":
      return new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

function passesActivityWindow(
  events: readonly CanonicalEventRecord[],
  windowStart: Date | null,
): boolean {
  if (windowStart === null) {
    return true;
  }

  return events.some((event) => event.occurredAt >= windowStart.toISOString());
}

function passesHasReplied(
  events: readonly CanonicalEventRecord[],
  hasReplied: AudienceCriteria["hasReplied"],
): boolean {
  if (hasReplied === "either") {
    return true;
  }

  const replied = events.some(
    (event) => event.eventType === "communication.email.inbound",
  );
  return hasReplied === "yes" ? replied : !replied;
}

function passesHasClicked(
  events: readonly CanonicalEventRecord[],
  hasClicked: AudienceCriteria["hasClicked"],
): boolean {
  if (hasClicked === "either") {
    return true;
  }

  const clicked = events.some(
    (event) => event.eventType === "campaign.email.clicked",
  );
  return hasClicked === "yes" ? clicked : !clicked;
}

function sortMemberships(
  left: ContactMembershipRecord,
  right: ContactMembershipRecord,
): number {
  const leftProjectId = left.projectId ?? "\uffff";
  const rightProjectId = right.projectId ?? "\uffff";
  if (leftProjectId !== rightProjectId) {
    return leftProjectId.localeCompare(rightProjectId);
  }

  const leftExpeditionId = left.expeditionId ?? "\uffff";
  const rightExpeditionId = right.expeditionId ?? "\uffff";
  if (leftExpeditionId !== rightExpeditionId) {
    return leftExpeditionId.localeCompare(rightExpeditionId);
  }

  return left.id.localeCompare(right.id);
}

async function resolvePrimaryAliasEmail(
  repositories: AudienceResolverRepositories,
  projectId: string | null,
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  if (projectId === null) {
    return null;
  }

  const cached = cache.get(projectId);
  if (cached !== undefined) {
    return cached;
  }

  const task = (async () => {
    const project = await repositories.settingsProjects.findById(projectId);
    if (project === null) {
      return null;
    }

    const primary =
      project.emails.find((email) => email.isPrimary) ?? project.emails[0];
    if (primary !== undefined) {
      return normalizeAliasEmail(primary.address);
    }

    if (project.connectedToProjectId !== null) {
      return resolvePrimaryAliasEmail(
        repositories,
        project.connectedToProjectId,
        cache,
      );
    }

    return null;
  })();

  cache.set(projectId, task);
  return task;
}

function filterMemberships(
  memberships: readonly ContactMembershipRecord[],
  criteria: AudienceCriteria,
): ContactMembershipRecord[] {
  const projectIds = new Set(criteria.projectIds);
  const statuses = new Set(criteria.statuses);
  const expeditionIds = new Set(criteria.expeditionIds);

  return memberships.filter((membership) => {
    if (membership.projectId === null || !projectIds.has(membership.projectId)) {
      return false;
    }

    const normalizedStatus = normalizeExpeditionMemberStatus(membership.status);
    if (statuses.size > 0 && (normalizedStatus === null || !statuses.has(normalizedStatus))) {
      return false;
    }

    if (
      expeditionIds.size > 0 &&
      !expeditionIds.has(membership.expeditionId ?? "")
    ) {
      return false;
    }

    return true;
  });
}

async function resolveAudienceMembers(
  repositories: AudienceResolverRepositories,
  criteria: AudienceCriteria,
  at: Date,
): Promise<AudienceMember[]> {
  if (criteria.projectIds.length === 0) {
    return [];
  }

  const contacts = await repositories.contacts.listAll();
  if (contacts.length === 0) {
    return [];
  }

  const contactIds = contacts.map((contact) => contact.id);
  const memberships = filterMemberships(
    await repositories.contactMemberships.listByContactIds(contactIds),
    criteria,
  );

  if (memberships.length === 0) {
    return [];
  }

  const membershipsByContact = new Map<string, ContactMembershipRecord[]>();
  for (const membership of memberships) {
    const existing = membershipsByContact.get(membership.contactId) ?? [];
    existing.push(membership);
    membershipsByContact.set(membership.contactId, existing);
  }

  const candidateIds = [...membershipsByContact.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  const contactsById = new Map<string, ContactRecord>(
    contacts.map((contact) => [contact.id, contact]),
  );
  const events = await repositories.canonicalEvents.listByContactIds(candidateIds);
  const eventsByContact = new Map<string, CanonicalEventRecord[]>();
  for (const event of events) {
    const existing = eventsByContact.get(event.contactId) ?? [];
    existing.push(event);
    eventsByContact.set(event.contactId, existing);
  }

  const matchedProjectIds = [
    ...new Set(
      memberships
        .map((membership) => membership.projectId)
        .filter((projectId): projectId is string => projectId !== null),
    ),
  ];
  const projects = await repositories.projectDimensions.listByIds(matchedProjectIds);
  const projectsById = new Map<string, ProjectDimensionRecord>(
    projects.map((project) => [project.projectId, project]),
  );
  const aliasCache = new Map<string, Promise<string | null>>();
  const windowStart = buildWindowStart(criteria.lastActivityWindow, at);
  const audience: AudienceMember[] = [];

  for (const contactId of candidateIds) {
    const contact = contactsById.get(contactId);
    if (contact === undefined) {
      continue;
    }

    const contactEvents = eventsByContact.get(contactId) ?? [];
    if (!passesActivityWindow(contactEvents, windowStart)) {
      continue;
    }
    if (!passesHasReplied(contactEvents, criteria.hasReplied)) {
      continue;
    }
    if (!passesHasClicked(contactEvents, criteria.hasClicked)) {
      continue;
    }

    const primaryMembership = [...(membershipsByContact.get(contactId) ?? [])]
      .sort(sortMemberships)
      .at(0);
    if (primaryMembership === undefined) {
      continue;
    }

    const project =
      primaryMembership.projectId === null
        ? null
        : (projectsById.get(primaryMembership.projectId) ?? null);

    audience.push({
      contactId,
      frozenEmail: contact.primaryEmail?.trim().toLowerCase() ?? "",
      frozenFirstName: readFirstName(contact.displayName),
      frozenProjectName: project?.projectName ?? null,
      frozenProjectId: primaryMembership.projectId,
      frozenAliasEmail: await resolvePrimaryAliasEmail(
        repositories,
        primaryMembership.projectId,
        aliasCache,
      ),
    });
  }

  return audience.filter((member) => member.frozenEmail.length > 0);
}

export function createAudienceResolver(deps: {
  repositories: AudienceResolverRepositories;
}): AudienceResolver {
  return {
    async resolveAudience(criteria, at) {
      return resolveAudienceMembers(deps.repositories, criteria, at);
    },

    async estimateCount(criteria, at) {
      const members = await resolveAudienceMembers(deps.repositories, criteria, at);
      return members.length;
    },
  };
}
