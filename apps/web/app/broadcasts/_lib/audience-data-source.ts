"use server";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";

import {
  audienceCriteriaSchema,
  expeditionMemberStatusValues,
  normalizeExpeditionMemberStatus,
  type AudienceCriteria,
  type CampaignKind,
  type CampaignRunRecord,
  type ExpeditionMemberStatus,
  type LaunchType,
  type PostmarkSenderStatus,
} from "@as-comms/contracts";
import {
  buildBroadcastPreheaderHtml,
  buildBroadcastSignatureBlock,
  createAudienceResolver,
  createMergeRenderer,
  type AudienceMember,
} from "@as-comms/domain";

import type { UiError, UiResult, UiSuccess } from "@/src/server/ui-result";

import { requireAdmin, requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import {
  buildCampaignFooterPreview,
  deriveInitials,
  formatOrgAddress,
} from "./campaign-preview";
import { normalizeAliasEmail } from "./normalize-alias-email";

const EMPTY_AUDIENCE_CRITERIA = audienceCriteriaSchema.parse({});
const RECENT_EXPEDITION_WINDOW_DAYS = 365;
const PREVIEW_LIMIT = 50;

export interface CampaignProjectOption {
  readonly id: string;
  readonly name: string;
  readonly alias: string | null;
  readonly projectAlias: string | null;
  readonly aliasHint: string | null;
  readonly connectedToProjectId: string | null;
  readonly isSubProject: boolean;
}

export interface CampaignProjectGroup {
  readonly host: CampaignProjectOption;
  readonly connectedSubs: readonly CampaignProjectOption[];
}

export interface CampaignExpeditionOption {
  readonly id: string;
  readonly name: string;
}

export interface AudienceBuilderBootstrap {
  readonly projects: readonly CampaignProjectGroup[];
  readonly expeditions: readonly CampaignExpeditionOption[];
  readonly statuses: readonly ExpeditionMemberStatus[];
  readonly senderOptions: readonly CampaignSenderOption[];
}

export interface AudiencePreviewRow {
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  readonly project: string | null;
  readonly projectAlias: string | null;
  readonly projectAliasHint: string | null;
}

export interface AudienceCountData {
  readonly count: number;
  readonly hasAppliedFilters: boolean;
}

export type AudienceStatusCounts = Partial<
  Record<ExpeditionMemberStatus, number>
>;

export interface CampaignSenderOption {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectAliasLabel: string;
  readonly email: string;
  readonly connectedToProjectId: string | null;
  readonly status: PostmarkSenderStatus;
}

export interface AudienceVolunteerSearchRow {
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  readonly project: string | null;
  readonly projectAlias: string | null;
  readonly projectAliasHint: string | null;
}

export interface CampaignWizardDraftData {
  readonly runId: string;
  readonly launchType: LaunchType;
  readonly kind: CampaignKind;
  readonly name: string | null;
  readonly fromEmail: string | null;
  readonly replyToEmail: string | null;
  readonly subjectTemplate: string | null;
  readonly bodyHtmlTemplate: string | null;
  readonly bodyTextTemplate: string | null;
  readonly preheader: string | null;
  readonly audienceCriteria: AudienceCriteria;
  readonly audienceSize: number | null;
  readonly state: CampaignRunRecord["state"];
  readonly scheduledAt: string | null;
  readonly updatedAt: string;
  readonly operatorEmail: string;
}

export interface ComposePreviewWarningContact {
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  readonly project: string | null;
  readonly missingTokens: readonly string[];
}

export interface ComposePreviewSample {
  readonly contactId: string;
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly project: string | null;
  readonly fromEmail: string | null;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface ComposePreviewData {
  readonly audienceSize: number;
  readonly sampleIndex: number;
  readonly sampleCount: number;
  readonly sample: ComposePreviewSample | null;
  readonly warningCount: number;
  readonly affectedContacts: readonly ComposePreviewWarningContact[];
  readonly footerAddress: string | null;
}

export async function loadSelectedAliasSignatureAction(input: {
  readonly aliasEmail: string | null;
}): Promise<UiResult<string>> {
  await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const normalizedAliasEmail = normalizeAliasEmail(input.aliasEmail);
    const signature =
      normalizedAliasEmail === null
        ? ""
        : ((await runtime.settings.aliases.findByAlias(normalizedAliasEmail))
            ?.signature ?? "");
    return successResult(signature);
  } catch (error) {
    return errorResult(
      "campaign_alias_signature_load_failed",
      error instanceof Error
        ? error.message
        : "Unable to load the sender signature.",
      true,
    );
  }
}

function newRequestId(): string {
  return randomUUID();
}

function errorResult(
  code: string,
  message: string,
  retryable = false,
): UiError {
  return {
    ok: false,
    code,
    message,
    requestId: newRequestId(),
    ...(retryable ? { retryable: true } : {}),
  };
}

function successResult<T>(data: T): UiSuccess<T> {
  return {
    ok: true,
    data,
    requestId: newRequestId(),
  };
}

async function appendCampaignAudit(input: {
  readonly actorId: string;
  readonly action: string;
  readonly runId: string;
  readonly summary: string;
}) {
  const runtime = await getStage1WebRuntime();
  await runtime.repositories.auditEvidence.append({
    id: randomUUID(),
    actorType: "user",
    actorId: input.actorId,
    action: input.action,
    entityType: "campaign_run",
    entityId: input.runId,
    occurredAt: new Date().toISOString(),
    result: "recorded",
    policyCode: `stage5a.${input.action}`,
    metadataJson: {
      summary: input.summary,
    },
  });
}

function readFirstName(displayName: string): string | null {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [firstName] = trimmed.split(/\s+/u);
  return firstName?.trim().length ? firstName.trim() : null;
}

async function resolvePrimaryAliasEmail(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
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
    const project = await runtime.settings.projects.findById(projectId);
    if (project === null) {
      return null;
    }

    const primary =
      project.emails.find((email) => email.isPrimary) ?? project.emails[0];
    if (primary !== undefined) {
      const trimmed = primary.address.trim();
      return trimmed.length === 0 ? null : trimmed.toLowerCase();
    }

    if (project.connectedToProjectId !== null) {
      return resolvePrimaryAliasEmail(
        runtime,
        project.connectedToProjectId,
        cache,
      );
    }

    return null;
  })();

  cache.set(projectId, task);
  return task;
}

function hasAppliedAudienceFilters(
  criteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  },
): boolean {
  switch (readAudienceMode(criteria)) {
    case "all_approved":
    case "project_status":
    case "specific":
      return true;
  }
}

function readAudienceMode(
  criteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  },
): "project_status" | "specific" | "all_approved" {
  return criteria.initialFilter ?? "project_status";
}

function normalizeAliasHint(address: string | null | undefined): string | null {
  const trimmed = address?.trim().toLowerCase() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const [local] = trimmed.split("@");
  return local && local.length > 0 ? `${local}@` : null;
}

function deriveProjectId(
  kind: CampaignKind,
  criteria: AudienceCriteria,
): string | null {
  if (kind !== "project") {
    return null;
  }

  return criteria.projectId ?? criteria.projectIds[0] ?? null;
}

function toStoredAudienceCriteria(
  criteria: AudienceCriteria,
): Record<string, unknown> {
  return {
    projectId: criteria.projectId ?? criteria.projectIds[0] ?? null,
    projectIds: criteria.projectIds,
    statuses: criteria.statuses,
    contactIds: criteria.contactIds ?? [],
  };
}

function filterAudienceMembersBySelection<
  T extends { readonly contactId: string },
>(
  rows: readonly T[],
  criteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  },
): readonly T[] {
  if (readAudienceMode(criteria) !== "specific") {
    return rows;
  }

  if ((criteria.contactIds?.length ?? 0) === 0) {
    return [];
  }

  const selectedContactIds = new Set(criteria.contactIds ?? []);
  return rows.filter((row) => selectedContactIds.has(row.contactId));
}

function readPrimaryEmail(input: {
  readonly emails: readonly {
    readonly address: string;
    readonly isPrimary: boolean;
  }[];
}): string | null {
  return (
    input.emails.find((email) => email.isPrimary)?.address ??
    input.emails[0]?.address ??
    null
  );
}

function mapDraftRecord(
  record: CampaignRunRecord,
  operatorEmail: string,
): CampaignWizardDraftData {
  return {
    runId: record.id,
    launchType: record.launchType,
    kind: record.kind,
    name: record.name,
    fromEmail: record.fromEmail,
    replyToEmail: record.replyToEmail,
    subjectTemplate: record.subjectTemplate,
    bodyHtmlTemplate: record.bodyHtmlTemplate,
    bodyTextTemplate: record.bodyTextTemplate,
    preheader: record.preheader,
    audienceCriteria: audienceCriteriaSchema.parse(record.audienceCriteria),
    audienceSize: record.audienceSize,
    state: record.state,
    scheduledAt: record.scheduledAt,
    updatedAt: record.updatedAt,
    operatorEmail,
  };
}

async function createResolver() {
  const runtime = await getStage1WebRuntime();

  return createAudienceResolver({
    repositories: {
      contacts: runtime.repositories.contacts,
      contactMemberships: runtime.repositories.contactMemberships,
      canonicalEvents: runtime.repositories.canonicalEvents,
      projectDimensions: runtime.repositories.projectDimensions,
      settingsProjects: runtime.settings.projects,
    },
  });
}

function buildAllProjectsCriteria(
  projectIds: readonly string[],
): AudienceCriteria {
  return audienceCriteriaSchema.parse({
    projectIds,
    statuses: [],
    contactIds: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
  });
}

async function loadApprovedContactsAudience(
  at: Date,
): Promise<readonly AudienceMember[]> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    const settingsProjects = (await runtime.settings.projects.listAll()).filter(
      (project) => project.isActive,
    );
    const criteria = buildAllProjectsCriteria(
      settingsProjects.map((project) => project.projectId),
    );
    const resolver = await createResolver();
    return resolver.resolveAudience(criteria, at);
  }

  const rows = await runtime.connection.sql<
    {
      contactId: string;
      displayName: string;
      email: string;
      projectId: string | null;
      projectName: string | null;
    }[]
  >`
    with ranked_memberships as (
      select
        cm.contact_id,
        cm.project_id,
        pd.project_name,
        row_number() over (
          partition by cm.contact_id
          order by pd.project_name asc, cm.project_id asc, cm.id asc
        ) as row_number
      from contact_memberships cm
      join project_dimensions pd
        on pd.project_id = cm.project_id
      where pd.is_active = true
    ),
    primary_memberships as (
      select contact_id, project_id, project_name
      from ranked_memberships
      where row_number = 1
    )
    select
      c.id as "contactId",
      c.display_name as "displayName",
      lower(trim(c.primary_email)) as "email",
      pm.project_id as "projectId",
      pm.project_name as "projectName"
    from contacts c
    join primary_memberships pm
      on pm.contact_id = c.id
    where c.primary_email is not null
      and btrim(c.primary_email) <> ''
      and not exists (
        select 1
        from suppression_list sl
        where sl.normalized_email = lower(trim(c.primary_email))
          and sl.first_event_at <= ${at.toISOString()}::timestamptz
      )
      and not exists (
        select 1
        from contact_consent cc
        where cc.contact_id = c.id
          and cc.opted_out_at <= ${at.toISOString()}::timestamptz
          and cc.scope_type in ('all', 'newsletter')
      )
    order by
      pm.project_name asc nulls last,
      c.display_name asc,
      c.id asc
  `;

  return rows.map((row) => ({
    contactId: row.contactId,
    frozenEmail: row.email,
    frozenFirstName: readFirstName(row.displayName),
    frozenProjectName: row.projectName,
    frozenProjectId: row.projectId,
    frozenAliasEmail: null,
  }));
}

async function resolveWizardAudience(
  kind: CampaignKind,
  criteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  },
  at: Date,
): Promise<readonly AudienceMember[]> {
  const parsedCriteria = audienceCriteriaSchema.parse(criteria);
  const mode = readAudienceMode(criteria);

  if (mode === "all_approved" && kind === "newsletter") {
    return loadApprovedContactsAudience(at);
  }

  const resolver = await createResolver();
  return filterAudienceMembersBySelection(
    await resolver.resolveAudience(parsedCriteria, at),
    criteria,
  );
}

export async function createCampaignWizardDraft(): Promise<CampaignWizardDraftData> {
  const session = await requireAdmin();
  const runtime = await getStage1WebRuntime();
  const created = await runtime.campaigns.campaignRuns.create({
    id: randomUUID(),
    kind: "project",
    launchType: "normal_email",
    projectId: null,
    name: null,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    bodyHtmlTemplate: null,
    bodyTextTemplate: null,
    preheader: null,
    audienceCriteria: toStoredAudienceCriteria(
      EMPTY_AUDIENCE_CRITERIA,
    ) as CampaignRunRecord["audienceCriteria"],
    audienceSize: null,
    createdByUserId: session.id,
    lastEditedByUserId: session.id,
  });
  await appendCampaignAudit({
    actorId: session.id,
    action: "campaign_run.created",
    runId: created.id,
    summary: "Draft created from the broadcast wizard.",
  });

  return mapDraftRecord(created, session.email);
}

export async function getCampaignWizardDraft(
  runId: string,
): Promise<CampaignWizardDraftData | null> {
  const session = await requireSession();
  const runtime = await getStage1WebRuntime();
  const run = await runtime.campaigns.campaignRuns.findById(runId);
  if (run === null) {
    return null;
  }

  return mapDraftRecord(run, session.email);
}

export async function getAudienceBuilderBootstrap(): Promise<AudienceBuilderBootstrap> {
  await requireSession();
  const runtime = await getStage1WebRuntime();
  const allConnectedProjects = (
    await runtime.settings.projects.listAll()
  ).filter(
    (project) => project.isActive || project.connectedToProjectId !== null,
  );
  const activeProjects = allConnectedProjects.filter(
    (project) => project.isActive,
  );
  const projectsById = new Map(
    allConnectedProjects.map(
      (project) => [project.projectId, project] as const,
    ),
  );

  const projectOptions = allConnectedProjects
    .map((project) => {
      const primaryEmail = readPrimaryEmail(project);
      const hostProject =
        project.connectedToProjectId === null
          ? null
          : (projectsById.get(project.connectedToProjectId) ?? null);
      const hostPrimaryEmail =
        hostProject === null ? null : readPrimaryEmail(hostProject);

      return {
        id: project.projectId,
        name: project.projectName,
        alias: project.projectAlias,
        projectAlias: project.projectAlias,
        aliasHint: normalizeAliasHint(
          project.connectedToProjectId === null
            ? primaryEmail
            : hostPrimaryEmail,
        ),
        connectedToProjectId: project.connectedToProjectId,
        isSubProject: project.connectedToProjectId !== null,
      } satisfies CampaignProjectOption;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const topLevelProjects = projectOptions.filter(
    (project) => project.connectedToProjectId === null,
  );
  const groups = topLevelProjects.map((host) => ({
    host,
    connectedSubs: projectOptions.filter(
      (project) => project.connectedToProjectId === host.id,
    ),
  }));
  const senderOptions = activeProjects
    .map((project) => {
      const email = readPrimaryEmail(project);
      if (email === null) {
        return null;
      }

      return {
        projectId: project.projectId,
        projectName: project.projectName,
        projectAliasLabel: project.projectAlias ?? project.projectName,
        email,
        connectedToProjectId: project.connectedToProjectId,
        status: project.postmarkSenderStatus,
      } satisfies CampaignSenderOption;
    })
    .filter((project): project is CampaignSenderOption => project !== null)
    .sort((left, right) => left.projectName.localeCompare(right.projectName));

  if (runtime.connection === null) {
    return {
      projects: groups,
      expeditions: [],
      statuses: expeditionMemberStatusValues,
      senderOptions,
    };
  }

  const minimumTouchedAt = new Date(
    Date.now() - RECENT_EXPEDITION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const expeditionRows = await runtime.connection.sql<
    {
      expeditionId: string;
      expeditionName: string | null;
    }[]
  >`
    select
      cm.expedition_id as "expeditionId",
      ed.expedition_name as "expeditionName"
    from contact_memberships cm
    left join expedition_dimensions ed
      on ed.expedition_id = cm.expedition_id
    where cm.expedition_id is not null
      and cm.created_at >= ${minimumTouchedAt.toISOString()}::timestamptz
    group by cm.expedition_id, ed.expedition_name
    order by max(cm.created_at) desc, cm.expedition_id asc
    limit 50
  `;

  return {
    projects: groups,
    expeditions: expeditionRows.map((row) => ({
      id: row.expeditionId,
      name: row.expeditionName ?? row.expeditionId,
    })),
    statuses: expeditionMemberStatusValues,
    senderOptions,
  };
}

async function readRequestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin !== null && origin.trim().length > 0) {
    return origin;
  }

  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

export async function resolveAudienceCountAction(input: {
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  };
}): Promise<UiResult<AudienceCountData>> {
  await requireSession();

  try {
    const criteria = audienceCriteriaSchema.parse(input.criteria);
    const audience = await resolveWizardAudience(
      input.kind,
      input.criteria,
      new Date(),
    );

    return successResult({
      count: audience.length,
      hasAppliedFilters: hasAppliedAudienceFilters({
        ...criteria,
        ...(input.criteria.initialFilter === undefined
          ? {}
          : { initialFilter: input.criteria.initialFilter }),
      }),
    });
  } catch (error) {
    return errorResult(
      "campaign_audience_count_failed",
      error instanceof Error
        ? error.message
        : "Unable to resolve the audience count.",
      true,
    );
  }
}

export async function previewAudienceAction(input: {
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  };
}): Promise<UiResult<readonly AudiencePreviewRow[]>> {
  await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const aliasCache = new Map<string, Promise<string | null>>();
    const settingsProjects = await runtime.settings.projects.listAll();
    const projectsById = new Map(
      settingsProjects.map((project) => [project.projectId, project] as const),
    );
    const audience = await resolveWizardAudience(
      input.kind,
      input.criteria,
      new Date(),
    );

    return successResult(
      await Promise.all(
        audience.slice(0, PREVIEW_LIMIT).map(async (member) => {
          const project =
            member.frozenProjectId == null
              ? null
              : (projectsById.get(member.frozenProjectId) ?? null);

          return {
            contactId: member.contactId,
            name: member.frozenFirstName ?? member.frozenEmail,
            email: member.frozenEmail,
            project: member.frozenProjectName,
            projectAlias: project?.projectAlias ?? null,
            projectAliasHint: normalizeAliasHint(
              await resolvePrimaryAliasEmail(
                runtime,
                member.frozenProjectId ?? null,
                aliasCache,
              ),
            ),
          };
        }),
      ),
    );
  } catch (error) {
    return errorResult(
      "campaign_audience_preview_failed",
      error instanceof Error
        ? error.message
        : "Unable to preview the audience.",
      true,
    );
  }
}

export async function loadComposePreviewAction(input: {
  readonly kind: CampaignKind;
  readonly criteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  };
  readonly fromEmail: string | null;
  readonly subjectTemplate: string;
  readonly preheader: string;
  readonly bodyHtmlTemplate: string;
  readonly bodyTextTemplate: string;
  readonly sampleIndex: number;
}): Promise<UiResult<ComposePreviewData>> {
  await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const mergeRenderer = createMergeRenderer();
    const audience = await resolveWizardAudience(
      input.kind,
      input.criteria,
      new Date(),
    );
    const orgSettings = await runtime.campaigns.orgSettings.read();
    const footerAddress = formatOrgAddress(orgSettings);

    if (audience.length === 0) {
      return successResult({
        audienceSize: 0,
        sampleIndex: 0,
        sampleCount: 0,
        sample: null,
        warningCount: 0,
        affectedContacts: [],
        footerAddress,
      });
    }

    const missingByContact = mergeRenderer.validateTokens(
      {
        subject: input.subjectTemplate,
        bodyHtml: input.bodyHtmlTemplate,
      },
      audience,
    );
    const normalizedSampleIndex =
      ((input.sampleIndex % audience.length) + audience.length) %
      audience.length;
    const sample = audience[normalizedSampleIndex] ?? audience[0];
    const origin = await readRequestOrigin();
    const projectId =
      input.criteria.projectId ?? input.criteria.projectIds[0] ?? null;
    const projectAlias =
      projectId === null
        ? null
        : ((await runtime.settings.projects.findById(projectId))
            ?.projectAlias ?? null);
    const footer = buildCampaignFooterPreview({
      kind: input.kind,
      projectName: sample?.frozenProjectName ?? null,
      projectAlias,
      footerAddress,
      origin,
    });
    const normalizedSenderAlias = normalizeAliasEmail(input.fromEmail);
    const signature =
      normalizedSenderAlias === null
        ? null
        : ((await runtime.settings.aliases.findByAlias(normalizedSenderAlias))
            ?.signature ?? null);
    const signatureBlock = buildBroadcastSignatureBlock(signature);
    const preheaderHtml = buildBroadcastPreheaderHtml(input.preheader);
    const rendered = mergeRenderer.render(
      {
        subject: input.subjectTemplate,
        bodyHtml: `${preheaderHtml}${input.bodyHtmlTemplate}${signatureBlock.html}${footer.html}`,
        bodyText: [input.bodyTextTemplate, signatureBlock.text, footer.text]
          .filter((part) => part.trim().length > 0)
          .join("\n\n"),
      },
      {
        firstName: sample?.frozenFirstName ?? null,
        projectName: sample?.frozenProjectName ?? null,
        aliasEmail: sample?.frozenAliasEmail ?? null,
      },
    );

    return successResult({
      audienceSize: audience.length,
      sampleIndex: normalizedSampleIndex,
      sampleCount: audience.length,
      sample:
        sample === undefined
          ? null
          : {
              contactId: sample.contactId,
              name: sample.frozenFirstName ?? sample.frozenEmail,
              initials: deriveInitials(
                sample.frozenFirstName,
                sample.frozenEmail,
              ),
              email: sample.frozenEmail,
              project: sample.frozenProjectName,
              fromEmail: input.fromEmail ?? sample.frozenAliasEmail,
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.text,
            },
      warningCount: Object.keys(missingByContact).length,
      affectedContacts: audience
        .filter((member) => missingByContact[member.contactId] !== undefined)
        .map((member) => ({
          contactId: member.contactId,
          name: member.frozenFirstName ?? member.frozenEmail,
          email: member.frozenEmail,
          project: member.frozenProjectName,
          missingTokens: missingByContact[member.contactId] ?? [],
        })),
      footerAddress,
    });
  } catch (error) {
    return errorResult(
      "campaign_preview_failed",
      error instanceof Error
        ? error.message
        : "Unable to render the broadcast preview.",
      true,
    );
  }
}

export async function searchProjectVolunteersAction(input: {
  readonly aliasProjectIds: readonly string[];
  readonly query: string;
}): Promise<UiResult<readonly AudienceVolunteerSearchRow[]>> {
  await requireSession();

  const aliasProjectIds = input.aliasProjectIds
    .map((projectId) => projectId.trim())
    .filter((projectId, index, values) => {
      return projectId.length > 0 && values.indexOf(projectId) === index;
    });
  const query = input.query.trim();
  if (aliasProjectIds.length === 0 || query.length < 2) {
    return successResult([]);
  }

  try {
    const runtime = await getStage1WebRuntime();
    const aliasCache = new Map<string, Promise<string | null>>();
    const settingsProjects = await runtime.settings.projects.listAll();
    const projectsById = new Map(
      settingsProjects.map((project) => [project.projectId, project] as const),
    );
    const contacts = await runtime.repositories.contacts.searchByQuery({
      query,
      limit: 25,
      projectIds: aliasProjectIds,
    });
    if (contacts.length === 0) {
      return successResult([]);
    }

    const memberships =
      await runtime.repositories.contactMemberships.listByContactIds(
        contacts.map((contact) => contact.id),
      );
    const membershipsByContact = new Map<
      string,
      (typeof memberships)[number][]
    >(contacts.map((contact) => [contact.id, []]));
    for (const membership of memberships) {
      if (membership.projectId === null) {
        continue;
      }

      const existing = membershipsByContact.get(membership.contactId) ?? [];
      existing.push(membership);
      membershipsByContact.set(membership.contactId, existing);
    }

    return successResult(
      await Promise.all(
        contacts
          .filter(
            (contact) =>
              (membershipsByContact.get(contact.id)?.length ?? 0) > 0 &&
              (contact.primaryEmail?.trim().length ?? 0) > 0,
          )
          .map(async (contact) => {
            const primaryMembership = [
              ...(membershipsByContact.get(contact.id) ?? []),
            ]
              .sort((left, right) =>
                (
                  projectsById.get(left.projectId ?? "")?.projectName ??
                  left.projectId ??
                  ""
                ).localeCompare(
                  projectsById.get(right.projectId ?? "")?.projectName ??
                    right.projectId ??
                    "",
                ),
              )
              .at(0);
            const project =
              primaryMembership?.projectId == null
                ? null
                : (projectsById.get(primaryMembership.projectId) ?? null);

            return {
              contactId: contact.id,
              name:
                contact.displayName.trim().length > 0
                  ? contact.displayName
                  : (contact.primaryEmail ?? contact.id),
              email: contact.primaryEmail ?? "",
              project: project?.projectName ?? null,
              projectAlias: project?.projectAlias ?? null,
              projectAliasHint: normalizeAliasHint(
                await resolvePrimaryAliasEmail(
                  runtime,
                  primaryMembership?.projectId ?? null,
                  aliasCache,
                ),
              ),
            } satisfies AudienceVolunteerSearchRow;
          }),
      ),
    );
  } catch (error) {
    return errorResult(
      "campaign_volunteer_search_failed",
      error instanceof Error
        ? error.message
        : "Unable to search volunteers for the selected projects.",
      true,
    );
  }
}

export async function loadMemberStatusCountsForProjects(
  projectIds: readonly string[],
): Promise<UiResult<AudienceStatusCounts>> {
  await requireSession();

  const normalizedProjectIds = projectIds
    .map((projectId) => projectId.trim())
    .filter((projectId, index, values) => {
      return projectId.length > 0 && values.indexOf(projectId) === index;
    });

  if (normalizedProjectIds.length === 0) {
    return successResult({});
  }

  try {
    const runtime = await getStage1WebRuntime();
    const contacts = await runtime.repositories.contacts.listAll();
    if (contacts.length === 0) {
      return successResult({});
    }

    const selectedProjectIds = new Set(normalizedProjectIds);
    const memberships =
      await runtime.repositories.contactMemberships.listByContactIds(
        contacts.map((contact) => contact.id),
      );
    const counts = new Map<ExpeditionMemberStatus, Set<string>>();

    for (const membership of memberships) {
      if (
        membership.projectId === null ||
        !selectedProjectIds.has(membership.projectId)
      ) {
        continue;
      }

      const normalizedStatus = normalizeExpeditionMemberStatus(
        membership.status,
      );
      if (normalizedStatus === null) {
        continue;
      }

      const existing = counts.get(normalizedStatus) ?? new Set<string>();
      existing.add(membership.contactId);
      counts.set(normalizedStatus, existing);
    }

    return successResult(
      Object.fromEntries(
        [...counts.entries()].map(([status, contactIds]) => [
          status,
          contactIds.size,
        ]),
      ) as AudienceStatusCounts,
    );
  } catch (error) {
    return errorResult(
      "campaign_member_status_counts_failed",
      error instanceof Error
        ? error.message
        : "Unable to load member statuses for the selected projects.",
      true,
    );
  }
}

export async function saveCampaignWizardDraftAction(input: {
  readonly runId: string;
  readonly launchType: LaunchType;
  readonly kind: CampaignKind;
  readonly name: string | null;
  readonly fromEmail: string | null;
  readonly replyToEmail: string | null;
  readonly subjectTemplate: string | null;
  readonly bodyHtmlTemplate: string | null;
  readonly bodyTextTemplate: string | null;
  readonly preheader: string | null;
  readonly audienceCriteria: AudienceCriteria & {
    readonly initialFilter?: "project_status" | "specific" | "all_approved";
  };
  readonly audienceSize: number | null;
}): Promise<UiResult<CampaignWizardDraftData>> {
  const session = await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const audienceCriteria = audienceCriteriaSchema.parse(
      input.audienceCriteria,
    );
    const updated = await runtime.campaigns.campaignRuns.updateDraft(
      input.runId,
      {
        launchType: input.launchType,
        kind: input.kind,
        projectId: deriveProjectId(input.kind, audienceCriteria),
        name: input.name,
        fromEmail: input.fromEmail,
        replyToEmail: input.replyToEmail,
        subjectTemplate: input.subjectTemplate,
        bodyHtmlTemplate: input.bodyHtmlTemplate,
        bodyTextTemplate: input.bodyTextTemplate,
        preheader: input.preheader,
        audienceCriteria: toStoredAudienceCriteria(
          audienceCriteria,
        ) as CampaignRunRecord["audienceCriteria"],
        audienceSize: input.audienceSize,
        lastEditedByUserId: session.id,
      },
    );

    return successResult(mapDraftRecord(updated, session.email));
  } catch (error) {
    return errorResult(
      "campaign_draft_save_failed",
      error instanceof Error
        ? error.message
        : "Unable to save the broadcast draft.",
      true,
    );
  }
}
