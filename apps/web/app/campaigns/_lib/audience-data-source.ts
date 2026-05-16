"use server";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";

import {
  audienceCriteriaSchema,
  expeditionMemberStatusValues,
  type AudienceCriteria,
  type CampaignKind,
  type CampaignRunRecord,
  type ExpeditionMemberStatus,
  type LaunchType,
} from "@as-comms/contracts";
import { createAudienceResolver, createMergeRenderer } from "@as-comms/domain";

import type { UiError, UiResult, UiSuccess } from "@/src/server/ui-result";

import { requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import {
  buildCampaignFooterPreview,
  deriveInitials,
  formatOrgAddress,
} from "./campaign-preview";

const EMPTY_AUDIENCE_CRITERIA = audienceCriteriaSchema.parse({});
const RECENT_EXPEDITION_WINDOW_DAYS = 365;
const PREVIEW_LIMIT = 50;

export interface CampaignProjectOption {
  readonly id: string;
  readonly name: string;
  readonly alias: string | null;
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
}

export interface AudienceCountData {
  readonly count: number;
  readonly hasAppliedFilters: boolean;
}

export interface CampaignSenderOption {
  readonly projectId: string;
  readonly projectName: string;
  readonly email: string;
  readonly connectedToProjectId: string | null;
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

function hasAppliedAudienceFilters(criteria: AudienceCriteria): boolean {
  return (
    criteria.projectIds.length > 0 ||
    criteria.statuses.length > 0 ||
    criteria.expeditionIds.length > 0 ||
    criteria.lastActivityWindow !== "all_time" ||
    criteria.hasReplied !== "either" ||
    criteria.hasClicked !== "either"
  );
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

  return criteria.projectIds.length === 1 ? criteria.projectIds[0] ?? null : null;
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

export async function createCampaignWizardDraft(): Promise<CampaignWizardDraftData> {
  const session = await requireSession();
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
    audienceCriteria: EMPTY_AUDIENCE_CRITERIA,
    audienceSize: null,
    createdByUserId: session.id,
    lastEditedByUserId: session.id,
  });
  await appendCampaignAudit({
    actorId: session.id,
    action: "campaign_run.created",
    runId: created.id,
    summary: "Draft created from the campaign wizard.",
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
  const settingsProjects = (await runtime.settings.projects.listAll()).filter(
    (project) => project.isActive,
  );
  const projectsById = new Map(
    settingsProjects.map((project) => [project.projectId, project] as const),
  );

  const projectOptions = settingsProjects
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
        aliasHint: normalizeAliasHint(
          project.connectedToProjectId === null ? primaryEmail : hostPrimaryEmail,
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
  const senderOptions = settingsProjects
    .filter((project) => project.postmarkSenderStatus === "verified")
    .map((project) => {
      const email = readPrimaryEmail(project);
      if (email === null) {
        return null;
      }

      return {
        projectId: project.projectId,
        projectName: project.projectName,
        email,
        connectedToProjectId: project.connectedToProjectId,
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
  const expeditionRows = await runtime.connection.sql<{
    expeditionId: string;
    expeditionName: string | null;
  }[]>`
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
  readonly criteria: AudienceCriteria;
}): Promise<UiResult<AudienceCountData>> {
  await requireSession();

  try {
    const criteria = audienceCriteriaSchema.parse(input.criteria);
    const resolver = await createResolver();
    const count = await resolver.estimateCount(criteria, new Date());

    return successResult({
      count,
      hasAppliedFilters: hasAppliedAudienceFilters(criteria),
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
  readonly criteria: AudienceCriteria;
}): Promise<UiResult<readonly AudiencePreviewRow[]>> {
  await requireSession();

  try {
    const criteria = audienceCriteriaSchema.parse(input.criteria);
    const resolver = await createResolver();
    const audience = await resolver.resolveAudience(criteria, new Date());

    return successResult(
      audience.slice(0, PREVIEW_LIMIT).map((member) => ({
        contactId: member.contactId,
        name: member.frozenFirstName ?? member.frozenEmail,
        email: member.frozenEmail,
        project: member.frozenProjectName,
      })),
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
  readonly criteria: AudienceCriteria;
  readonly fromEmail: string | null;
  readonly subjectTemplate: string;
  readonly bodyHtmlTemplate: string;
  readonly bodyTextTemplate: string;
  readonly sampleIndex: number;
}): Promise<UiResult<ComposePreviewData>> {
  await requireSession();

  try {
    const criteria = audienceCriteriaSchema.parse(input.criteria);
    const resolver = await createResolver();
    const runtime = await getStage1WebRuntime();
    const mergeRenderer = createMergeRenderer();
    const audience = await resolver.resolveAudience(criteria, new Date());
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
      ((input.sampleIndex % audience.length) + audience.length) % audience.length;
    const sample = audience[normalizedSampleIndex] ?? audience[0];
    const origin = await readRequestOrigin();
    const footer = buildCampaignFooterPreview({
      kind: input.kind,
      projectName: sample?.frozenProjectName ?? null,
      footerAddress,
      origin,
    });
    const rendered = mergeRenderer.render(
      {
        subject: input.subjectTemplate,
        bodyHtml: `${input.bodyHtmlTemplate}${footer.html}`,
        bodyText: [input.bodyTextTemplate, footer.text].filter(Boolean).join("\n\n"),
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
        : "Unable to render the campaign preview.",
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
  readonly audienceCriteria: AudienceCriteria;
  readonly audienceSize: number | null;
}): Promise<UiResult<CampaignWizardDraftData>> {
  const session = await requireSession();

  try {
    const runtime = await getStage1WebRuntime();
    const audienceCriteria = audienceCriteriaSchema.parse(input.audienceCriteria);
    const updated = await runtime.campaigns.campaignRuns.updateDraft(input.runId, {
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
      audienceCriteria,
      audienceSize: input.audienceSize,
      lastEditedByUserId: session.id,
    });

    return successResult(mapDraftRecord(updated, session.email));
  } catch (error) {
    return errorResult(
      "campaign_draft_save_failed",
      error instanceof Error ? error.message : "Unable to save the campaign draft.",
      true,
    );
  }
}
