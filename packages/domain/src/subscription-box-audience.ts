import type {
  AudienceCriteria,
  CanonicalEventRecord,
  ContactRecord,
  ProjectDimensionRecord,
  SalesforceSubscriptionBox,
} from "@as-comms/contracts";

import {
  createAudienceResolver,
  matchesAudienceActivityCriteria,
  readFirstName,
  resolvePrimaryAliasEmail,
  type AudienceResolver,
  type AudienceResolverRepositories,
} from "./audience-resolver.js";
import type { AudienceMember } from "./campaign-types.js";

const subscriptionDataStaleMessage =
  "Subscription data from Salesforce hasn't refreshed in over an hour, so project emails are paused. Nothing was sent.";
const subscriptionDataMaxAgeMs = 60 * 60 * 1000;

/** The data the resolver reads from the Salesforce preference mirror. */
export interface SubscriptionBoxAudienceSource {
  /** Platform project id → host-resolved Salesforce box. */
  loadProjectBoxes(): Promise<ReadonlyMap<string, SalesforceSubscriptionBox>>;
  /** Platform contacts whose corresponding Salesforce preference has this box ticked. */
  listTickedContactIds(
    box: SalesforceSubscriptionBox,
  ): Promise<ReadonlySet<string>>;
  /** Active platform project opt-outs for any supplied platform project id. */
  listProjectOptOutContactIds(
    projectIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  /** The successful Salesforce subscription-readback heartbeat. */
  lastRefreshedAt(): Promise<Date | null>;
}

/**
 * Thrown before a box-backed audience is resolved when the Salesforce mirror
 * is unavailable or stale. This exact message is shown to operators by the
 * wizard and prevents the send freeze from writing any snapshots.
 */
export class SubscriptionDataStaleError extends Error {
  constructor() {
    super(subscriptionDataStaleMessage);
    this.name = "SubscriptionDataStaleError";
  }
}

function readMode(criteria: AudienceCriteria): string {
  return criteria.initialFilter ?? "project_status";
}

function normalizeProjectIds(projectIds: readonly string[]): string[] {
  return projectIds.filter(
    (projectId, index, values) =>
      projectId.trim().length > 0 && values.indexOf(projectId) === index,
  );
}

function criteriaForProject(
  criteria: AudienceCriteria,
  projectId: string,
): AudienceCriteria {
  return {
    ...criteria,
    projectId,
    projectIds: [projectId],
  };
}

function mapEventsByContactId(
  events: readonly CanonicalEventRecord[],
): ReadonlyMap<string, readonly CanonicalEventRecord[]> {
  const byContactId = new Map<string, CanonicalEventRecord[]>();
  for (const event of events) {
    const existing = byContactId.get(event.contactId) ?? [];
    existing.push(event);
    byContactId.set(event.contactId, existing);
  }
  return byContactId;
}

function choosePrimaryMember(
  current: AudienceMember | undefined,
  next: AudienceMember,
): AudienceMember {
  if (current === undefined) {
    return next;
  }

  // The membership resolver's primary sort starts with project id. Per-project
  // resolution has already selected the right membership within a project, so
  // this preserves the same winner when a contact matches several projects.
  const currentProjectId = current.frozenProjectId ?? "\uffff";
  const nextProjectId = next.frozenProjectId ?? "\uffff";
  return nextProjectId.localeCompare(currentProjectId) < 0 ? next : current;
}

function readContactEmail(contact: ContactRecord): string {
  return contact.primaryEmail?.trim().toLowerCase() ?? "";
}

function isSubscriptionDataFresh(
  refreshedAt: Date | null,
  at: Date,
): boolean {
  if (refreshedAt === null || Number.isNaN(refreshedAt.getTime())) {
    return false;
  }

  return at.getTime() - refreshedAt.getTime() <= subscriptionDataMaxAgeMs;
}

/** One selected project with a box: its box group and who is subscribed. */
export interface BoxAudiencePlan {
  readonly projectId: string;
  readonly box: SalesforceSubscriptionBox;
  /** Every project sharing this box (Beech + Butternut share one). */
  readonly groupedProjectIds: readonly string[];
  /** Box ticked, minus platform opt-outs on any project in the group. */
  readonly tickedContactIds: ReadonlySet<string>;
}

/**
 * The box rule in one place, shared by the audience resolver and the wizard's
 * status pill counts. Selected projects with no box are absent from the map.
 */
export async function loadSubscriptionBoxPlans(
  source: SubscriptionBoxAudienceSource,
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, BoxAudiencePlan>> {
  const selectedProjectIds = normalizeProjectIds(projectIds);
  const projectBoxes = await source.loadProjectBoxes();
  const boxBackedProjectIds = selectedProjectIds.filter((projectId) =>
    projectBoxes.has(projectId),
  );
  if (boxBackedProjectIds.length === 0) {
    return new Map();
  }

  const groupedProjectIdsByBox = new Map<SalesforceSubscriptionBox, string[]>();
  for (const [projectId, box] of projectBoxes) {
    const existing = groupedProjectIdsByBox.get(box) ?? [];
    existing.push(projectId);
    groupedProjectIdsByBox.set(box, existing);
  }

  const boxes = [
    ...new Set(
      boxBackedProjectIds.flatMap((projectId) => {
        const box = projectBoxes.get(projectId);
        return box === undefined ? [] : [box];
      }),
    ),
  ];
  const tickedByBox = new Map(
    await Promise.all(
      boxes.map(async (box) => {
        const groupedProjectIds = groupedProjectIdsByBox.get(box) ?? [];
        const [tickedContactIds, optedOutContactIds] = await Promise.all([
          source.listTickedContactIds(box),
          source.listProjectOptOutContactIds(groupedProjectIds),
        ]);
        return [
          box,
          new Set(
            [...tickedContactIds].filter(
              (contactId) => !optedOutContactIds.has(contactId),
            ),
          ),
        ] as const;
      }),
    ),
  );

  return new Map(
    boxBackedProjectIds.flatMap((projectId) => {
      const box = projectBoxes.get(projectId);
      if (box === undefined) {
        return [];
      }
      return [
        [
          projectId,
          {
            projectId,
            box,
            groupedProjectIds: groupedProjectIdsByBox.get(box) ?? [projectId],
            tickedContactIds: tickedByBox.get(box) ?? new Set<string>(),
          },
        ] as const,
      ];
    }),
  );
}

/**
 * Synthetic leads: subscribed to the box but with no Expedition Membership on
 * any project that shares it.
 */
export function listSyntheticLeadContactIds(input: {
  readonly plan: BoxAudiencePlan;
  readonly memberships: readonly { readonly contactId: string; readonly projectId: string | null }[];
}): ReadonlySet<string> {
  const groupedProjectIds = new Set(input.plan.groupedProjectIds);
  const withMembership = new Set(
    input.memberships.flatMap((membership) =>
      membership.projectId !== null && groupedProjectIds.has(membership.projectId)
        ? [membership.contactId]
        : [],
    ),
  );
  return new Set(
    [...input.plan.tickedContactIds].filter(
      (contactId) => !withMembership.has(contactId),
    ),
  );
}

async function createSyntheticLeadMembers(input: {
  readonly plans: readonly BoxAudiencePlan[];
  readonly criteria: AudienceCriteria;
  readonly at: Date;
  readonly repositories: AudienceResolverRepositories;
}): Promise<readonly AudienceMember[]> {
  if (
    !input.criteria.statuses.includes("Lead") ||
    input.criteria.expeditionIds.length > 0
  ) {
    return [];
  }

  const allTickedContactIds = [
    ...new Set(input.plans.flatMap((plan) => [...plan.tickedContactIds])),
  ];
  if (allTickedContactIds.length === 0) {
    return [];
  }

  const [contacts, memberships, events, projects] = await Promise.all([
    input.repositories.contacts.listAll(),
    input.repositories.contactMemberships.listByContactIds(allTickedContactIds),
    input.repositories.canonicalEvents.listByContactIds(allTickedContactIds),
    input.repositories.projectDimensions.listByIds(
      input.plans.map((plan) => plan.projectId),
    ),
  ]);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const eventsByContact = mapEventsByContactId(events);
  const projectsById = new Map(
    projects.map((project) => [project.projectId, project] as const),
  );
  const aliasCache = new Map<string, Promise<string | null>>();
  const syntheticMembers: AudienceMember[] = [];

  for (const plan of input.plans) {
    const project = projectsById.get(plan.projectId) ?? null;
    const syntheticLeadIds = listSyntheticLeadContactIds({ plan, memberships });

    for (const contactId of syntheticLeadIds) {
      const contact = contactsById.get(contactId);
      if (contact === undefined) {
        continue;
      }
      if (
        !matchesAudienceActivityCriteria(
          eventsByContact.get(contactId) ?? [],
          input.criteria,
          input.at,
        )
      ) {
        continue;
      }

      const frozenEmail = readContactEmail(contact);
      if (frozenEmail.length === 0) {
        continue;
      }

      syntheticMembers.push({
        contactId,
        newsletterSubscriberId: null,
        frozenEmail,
        frozenFirstName: readFirstName(contact.displayName),
        frozenProjectId: plan.projectId,
        frozenProjectName: project?.projectName ?? null,
        frozenAliasEmail: await resolvePrimaryAliasEmail(
          input.repositories,
          plan.projectId,
          aliasCache,
        ),
      });
    }
  }

  return syntheticMembers;
}

/**
 * Adds Salesforce subscription-box gating to project audiences while retaining
 * the current membership resolver for all membership-backed behavior.
 */
export function createSubscriptionBoxAudienceResolver(input: {
  readonly repositories: AudienceResolverRepositories;
  readonly source: SubscriptionBoxAudienceSource;
  readonly membershipResolver?: AudienceResolver;
  /** Wall clock for the staleness check. Never the run's send time: a run
   *  scheduled for tomorrow is frozen now, from data that is fresh now. */
  readonly now?: () => Date;
}): AudienceResolver {
  const membershipResolver =
    input.membershipResolver ?? createAudienceResolver({ repositories: input.repositories });
  const now = input.now ?? (() => new Date());

  async function resolveAudience(
    criteria: AudienceCriteria,
    at: Date,
  ): Promise<AudienceMember[]> {
    const selectedProjectIds = normalizeProjectIds(criteria.projectIds);
    if (selectedProjectIds.length === 0) {
      return [];
    }

    const plansByProject = await loadSubscriptionBoxPlans(
      input.source,
      selectedProjectIds,
    );
    if (plansByProject.size === 0) {
      return membershipResolver.resolveAudience(criteria, at);
    }

    if (!isSubscriptionDataFresh(await input.source.lastRefreshedAt(), now())) {
      throw new SubscriptionDataStaleError();
    }

    const plans = [...plansByProject.values()];
    const mode = readMode(criteria);
    const resolvedByProject = await Promise.all(
      selectedProjectIds.map(async (projectId) => {
        const projectCriteria = criteriaForProject(criteria, projectId);
        const plan = plansByProject.get(projectId);
        if (plan === undefined) {
          return membershipResolver.resolveAudience(projectCriteria, at);
        }

        if (mode === "project_subscribed") {
          return [];
        }

        const tickedContactIds = plan.tickedContactIds;
        return (await membershipResolver.resolveAudience(projectCriteria, at)).filter(
          (member) =>
            member.contactId !== null && tickedContactIds.has(member.contactId),
        );
      }),
    );

    const subscribedMembers =
      mode !== "project_subscribed"
        ? []
        : await createSubscribedMembers({
            plans,
            criteria,
            at,
            repositories: input.repositories,
          });
    const syntheticLeads =
      mode === "project_status"
        ? await createSyntheticLeadMembers({
            plans,
            criteria,
            at,
            repositories: input.repositories,
          })
        : [];

    const membersByContactId = new Map<string, AudienceMember>();
    for (const member of [
      ...resolvedByProject.flat(),
      ...subscribedMembers,
      ...syntheticLeads,
    ]) {
      if (member.contactId === null || member.frozenEmail.length === 0) {
        continue;
      }
      membersByContactId.set(
        member.contactId,
        choosePrimaryMember(membersByContactId.get(member.contactId), member),
      );
    }

    return [...membersByContactId.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([, member]) => member);
  }

  return {
    resolveAudience,
    async estimateCount(criteria, at) {
      return (await resolveAudience(criteria, at)).length;
    },
  };
}

async function createSubscribedMembers(input: {
  readonly plans: readonly BoxAudiencePlan[];
  readonly criteria: AudienceCriteria;
  readonly at: Date;
  readonly repositories: AudienceResolverRepositories;
}): Promise<readonly AudienceMember[]> {
  const contactIds = [
    ...new Set(input.plans.flatMap((plan) => [...plan.tickedContactIds])),
  ];
  if (contactIds.length === 0) {
    return [];
  }

  const [contacts, events, projects] = await Promise.all([
    input.repositories.contacts.listAll(),
    input.repositories.canonicalEvents.listByContactIds(contactIds),
    input.repositories.projectDimensions.listByIds(
      input.plans.map((plan) => plan.projectId),
    ),
  ]);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const eventsByContact = mapEventsByContactId(events);
  const projectsById = new Map<string, ProjectDimensionRecord>(
    projects.map((project) => [project.projectId, project]),
  );
  const aliasCache = new Map<string, Promise<string | null>>();
  const members: AudienceMember[] = [];

  for (const plan of input.plans) {
    const project = projectsById.get(plan.projectId) ?? null;
    for (const contactId of plan.tickedContactIds) {
      const contact = contactsById.get(contactId);
      if (contact === undefined) {
        continue;
      }
      if (
        !matchesAudienceActivityCriteria(
          eventsByContact.get(contactId) ?? [],
          input.criteria,
          input.at,
        )
      ) {
        continue;
      }
      const frozenEmail = readContactEmail(contact);
      if (frozenEmail.length === 0) {
        continue;
      }
      members.push({
        contactId,
        newsletterSubscriberId: null,
        frozenEmail,
        frozenFirstName: readFirstName(contact.displayName),
        frozenProjectId: plan.projectId,
        frozenProjectName: project?.projectName ?? null,
        frozenAliasEmail: await resolvePrimaryAliasEmail(
          input.repositories,
          plan.projectId,
          aliasCache,
        ),
      });
    }
  }

  return members;
}
