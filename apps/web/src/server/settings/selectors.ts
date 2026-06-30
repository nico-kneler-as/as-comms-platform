import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";

import type {
  AiKnowledgeSource,
  IntegrationHealthCategory,
  IntegrationHealthStatus,
  OrgSenderRecord,
  PostmarkSenderStatus,
  Provider
} from "@as-comms/contracts";
import { inputHashFromSources } from "@as-comms/db";

import { getCurrentUser } from "../auth/session";
import { readWebEnv } from "../env";
import { estimateSmsCostUsd } from "@/src/lib/sms-pricing";
import { recordSensitiveReadForCurrentUserDetached } from "../security/audit";
import { getStage1WebRuntime, listAllOrgSenders } from "../stage1-runtime";

export interface ProjectRowViewModel {
  readonly projectId: string;
  readonly projectName: string;
  readonly suggestedAlias: string;
  readonly projectAlias: string | null;
  readonly postmarkSenderStatus: PostmarkSenderStatus;
  /**
   * When non-null, this project rolls up into the referenced host project's
   * inbox / dashboard / AI knowledge. The shape of the host appears in
   * `connectedToHost` on the detail view-model; rows surface the host's name
   * via that nested field, not here.
   */
  readonly connectedToProjectId: string | null;
  readonly isActive: boolean;
  readonly primaryEmail: string | null;
  readonly emailAliases: readonly string[];
  readonly additionalEmailCount: number;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: string | null;
  readonly hasCachedAiKnowledge: boolean;
  readonly memberCount: number;
  readonly activationRequirementsMet: boolean;
}

/**
 * Top-level row in the Settings → Projects list. Connected sub-projects do
 * not appear at this level; they are nested under their host's
 * `connectedSubProjects` and inherit "Connected to {host}" copy in the
 * renderer. `host` carries the host's own row exactly as it would render
 * standalone, so `connectedSubProjects` is the only sub-aware field on the
 * envelope.
 */
export interface ProjectListEntryViewModel {
  readonly host: ProjectRowViewModel;
  readonly connectedSubProjects: readonly ProjectRowViewModel[];
}

export interface ConnectedProjectSummaryViewModel {
  readonly projectId: string;
  readonly projectName: string;
}

export interface ConnectedHostSummaryViewModel {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectAlias: string | null;
  readonly aiKnowledgeUrl: string | null;
}

export interface ProjectsSettingsViewModel {
  readonly isAdmin: boolean;
  readonly active: readonly ProjectListEntryViewModel[];
  readonly inactive: readonly ProjectListEntryViewModel[];
  readonly counts: {
    readonly active: number;
    readonly inactive: number;
    readonly total: number;
  };
}

export interface ProjectSettingsDetailViewModel extends ProjectRowViewModel {
  readonly isAdmin: boolean;
  readonly aiKnowledgeSources: readonly AiKnowledgeSource[];
  readonly aiOperatingContext: string;
  readonly aiAutoSyncSchedule: "never" | "daily" | "weekly";
  readonly aiOptimizedSynthesizedAt: string | null;
  readonly aiOptimizedLastCheckedAt: string | null;
  readonly aiOptimizedInputHash: string | null;
  readonly aiKnowledgeSynthesisStale: boolean;
  readonly emails: readonly {
    readonly id: string;
    readonly address: string;
    readonly isPrimary: boolean;
    readonly signature: string;
  }[];
  readonly salesforceProjectId: string | null;
  /**
   * For host projects (alias non-null, connectedToProjectId null), the list
   * of currently-connected sub-projects. Empty for sub-projects and
   * standalone projects.
   */
  readonly connectedProjects: readonly ConnectedProjectSummaryViewModel[];
  /**
   * For connected sub-projects (connectedToProjectId non-null), the
   * inherited host's identity + alias + AI knowledge URL. Null otherwise.
   */
  readonly connectedToHost: ConnectedHostSummaryViewModel | null;
  /**
   * The list of inactive, unconnected projects available to be picked as
   * connection candidates. Provided to host detail pages so the "Add" picker
   * can render server-rendered options without an extra round-trip.
   */
  readonly availableConnectionCandidates: readonly ConnectedProjectSummaryViewModel[];
}

export interface UserRowViewModel {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: "admin" | "internal_user";
  readonly lastActiveAt: string | null;
  readonly status: "active" | "pending" | "deactivated";
}

export interface AccessSettingsViewModel {
  readonly isAdmin: boolean;
  readonly currentUserId: string | null;
  readonly admins: readonly UserRowViewModel[];
  readonly internalUsers: readonly UserRowViewModel[];
}

export interface OrgSendersSettingsViewModel {
  readonly isAdmin: boolean;
  readonly orgSenders: readonly OrgSenderRecord[];
}

export interface IntegrationHealthViewModel {
  readonly serviceName: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: IntegrationHealthCategory;
  readonly status: IntegrationHealthStatus;
  readonly lastCheckedAt: string | null;
  readonly detail: string | null;
  readonly supportsRefresh: boolean;
  readonly mailchimp:
    | {
        readonly status: "connected" | "stale" | "unconfigured";
        readonly lastSuccessfulSyncAt: string | null;
        readonly lastCampaignName: string | null;
        readonly lastCampaignSentAt: string | null;
        readonly lastBatchRecipientCount: number | null;
      }
    | null;
}

type MailchimpTileStatus = NonNullable<
  IntegrationHealthViewModel["mailchimp"]
>["status"];

export interface IntegrationsSettingsViewModel {
  readonly isAdmin: boolean;
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly twilioCard: {
    readonly status: "not-configured" | "active" | "degraded";
    readonly smsEnabled: boolean;
    readonly hasActiveSender: boolean;
    readonly lastStatusCallbackAt: string | null;
    readonly outboundRateUsdPerSegment: number;
    readonly monthToDateSpendUsd: number | null;
    readonly monthToDateSegments: number | null;
    readonly monthlyCapUsd: number | null;
  };
}

export type LogStreamId = "source-evidence-quarantine";

export interface LogStreamDescriptorViewModel {
  readonly id: LogStreamId;
  readonly label: string;
  readonly description: string;
}

export interface SourceEvidenceCollisionDetailViewModel
  extends Readonly<Record<string, unknown>> {
  readonly provider: Provider;
  readonly idempotencyKey: string;
  readonly winning: {
    readonly sourceEvidenceId: string;
    readonly checksum: string;
    readonly receivedAt: string;
  };
  readonly losing: readonly {
    readonly quarantineId: string;
    readonly checksum: string;
    readonly attemptedAt: string;
  }[];
}

export interface LogEntryViewModel {
  readonly id: string;
  readonly streamId: LogStreamId;
  readonly timestamp: string;
  readonly summary: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface LogsSettingsViewModel {
  readonly streams: readonly LogStreamDescriptorViewModel[];
  readonly activeStreamId: LogStreamId;
  readonly entries: readonly LogEntryViewModel[];
  readonly nextBeforeTimestamp: string | null;
}

const INTEGRATION_ORDER = [
  "salesforce",
  "gmail",
  "mailchimp",
  "postmark",
  "notion",
  "openai"
] as const;

const INTEGRATION_META = {
  salesforce: {
    displayName: "Salesforce",
    description: "Contacts and project records",
    supportsRefresh: true
  },
  gmail: {
    displayName: "Gmail",
    description: "Inbound and outbound email",
    supportsRefresh: true
  },
  mailchimp: {
    displayName: "Mailchimp",
    description: "Transition-period campaign ingest",
    supportsRefresh: false
  },
  postmark: {
    displayName: "Postmark",
    description: "Campaign delivery and sender verification",
    supportsRefresh: false
  },
  notion: {
    displayName: "Notion",
    description: "Knowledge sync source",
    supportsRefresh: false
  },
  openai: {
    displayName: "Anthropic",
    description: "AI draft provider",
    supportsRefresh: false
  }
} as const satisfies Record<
  (typeof INTEGRATION_ORDER)[number],
  {
    readonly displayName: string;
    readonly description: string;
    readonly supportsRefresh: boolean;
  }
>;

const DEFAULT_LOG_STREAM_ID = "source-evidence-quarantine" as const;
const LOGS_PAGE_SIZE = 25;
const LOG_STREAMS: readonly LogStreamDescriptorViewModel[] = [
  {
    id: DEFAULT_LOG_STREAM_ID,
    label: "Source-evidence duplicates",
    description: "Provider replay collisions kept out of canonical history."
  }
];
const PROVIDER_LABEL: Record<Provider, string> = {
  manual: "Manual",
  gmail: "Gmail",
  salesforce: "Salesforce",
  twilio: "Twilio",
  simpletexting: "SimpleTexting",
  mailchimp: "Mailchimp",
  postmark: "Postmark"
};
const PROBE_STALENESS_THRESHOLD_MS = 30 * 60 * 1000;
const PROBE_FRESHNESS_REQUIRED_SERVICES = new Set<string>([
  "salesforce",
  "gmail",
  "postmark"
]);
// Mailchimp is in transition-period scaling (D-046 Stage 5C, target mid-June 2026
// decommission). Newsletter cadence is irregular, and multi-hour quiet periods are
// routine, so only surface "Sync stale" for likely breakage rather than expected gaps
// between campaigns. Remove this once Mailchimp is fully decommissioned.
const MAILCHIMP_HEALTHY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAILCHIMP_AUTO_HIDE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

interface MailchimpSnapshotRow {
  readonly latestActivityAt: Date | string | null;
  readonly lastCampaignName: string | null;
  readonly lastCampaignSentAt: Date | string | null;
}

interface MailchimpBatchCountRow {
  readonly canonicalEventCount: number | string;
}

function normalizeSearch(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

function normalizeSqlResultRows(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) {
    return result;
  }

  return (result as { readonly rows?: readonly unknown[] }).rows ?? [];
}

function coerceIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value !== "string") {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function readMailchimpCaptureBaseUrl(): string | null {
  const baseUrl = process.env.MAILCHIMP_CAPTURE_BASE_URL?.trim();
  return baseUrl && baseUrl.length > 0 ? baseUrl : null;
}

function getTimestampMs(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  if (typeof value !== "string") {
    return null;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function isProbeStale(
  serviceName: string,
  lastCheckedAt: Date | string | null,
  now: Date
): boolean {
  if (!PROBE_FRESHNESS_REQUIRED_SERVICES.has(serviceName)) {
    return false;
  }
  if (lastCheckedAt === null) {
    return false;
  }

  const lastCheckedAtMs = getTimestampMs(lastCheckedAt);
  if (lastCheckedAtMs === null) {
    return false;
  }

  return now.getTime() - lastCheckedAtMs > PROBE_STALENESS_THRESHOLD_MS;
}

function formatProbeAge(ageMs: number): string {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) {
    return `${String(minutes)} min ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.round(hours / 24);
  return `${String(days)} ${days === 1 ? "day" : "days"} ago`;
}

function getLatestSuccessfulMailchimpTransitionSync(
  syncStates: readonly {
    readonly scope: string;
    readonly provider: string | null;
    readonly jobType: string;
    readonly status: string;
    readonly lastSuccessfulAt: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  }[]
) {
  return syncStates
    .filter(
      (row) =>
        row.scope === "provider" &&
        row.provider === "mailchimp" &&
        row.jobType === "live_ingest" &&
        row.status === "succeeded"
    )
    .sort((left, right) => {
      const leftTimestamp =
        Date.parse(
          left.lastSuccessfulAt ?? left.windowEnd ?? left.windowStart ?? "1970-01-01T00:00:00.000Z"
        ) || 0;
      const rightTimestamp =
        Date.parse(
          right.lastSuccessfulAt ??
            right.windowEnd ??
            right.windowStart ??
            "1970-01-01T00:00:00.000Z"
        ) || 0;
      return rightTimestamp - leftTimestamp;
    })
    .at(0) ?? null;
}

async function readMailchimpSnapshot(runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>) {
  if (runtime.connection === null) {
    return {
      latestActivityAt: null,
      lastCampaignName: null,
      lastCampaignSentAt: null,
    };
  }

  const snapshotResult = await runtime.connection.db.execute(
    sql<MailchimpSnapshotRow>`
      select
        (
          select max(cel.occurred_at)
          from canonical_event_ledger cel
          inner join source_evidence_log sel
            on sel.id = cel.source_evidence_id
          where sel.provider = 'mailchimp'
        ) as "latestActivityAt",
        (
          select mcad.campaign_name
          from canonical_event_ledger cel
          inner join source_evidence_log sel
            on sel.id = cel.source_evidence_id
          left join mailchimp_campaign_activity_details mcad
            on mcad.source_evidence_id = cel.source_evidence_id
          where sel.provider = 'mailchimp'
            and cel.event_type = 'campaign.email.sent'
          order by cel.occurred_at desc, cel.created_at desc
          limit 1
        ) as "lastCampaignName",
        (
          select cel.occurred_at
          from canonical_event_ledger cel
          inner join source_evidence_log sel
            on sel.id = cel.source_evidence_id
          where sel.provider = 'mailchimp'
            and cel.event_type = 'campaign.email.sent'
          order by cel.occurred_at desc, cel.created_at desc
          limit 1
        ) as "lastCampaignSentAt"
    `
  );

  const [row] = normalizeSqlResultRows(snapshotResult) as readonly MailchimpSnapshotRow[];
  return {
    latestActivityAt: coerceIsoTimestamp(row?.latestActivityAt ?? null),
    lastCampaignName: row?.lastCampaignName ?? null,
    lastCampaignSentAt: coerceIsoTimestamp(row?.lastCampaignSentAt ?? null),
  };
}

async function readMailchimpLastBatchRecipientCount(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
  input: {
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  }
): Promise<number | null> {
  if (
    runtime.connection === null ||
    input.windowStart === null ||
    input.windowEnd === null
  ) {
    return null;
  }

  const countResult = await runtime.connection.db.execute(
    sql<MailchimpBatchCountRow>`
      select count(*)::int as "canonicalEventCount"
      from canonical_event_ledger cel
      inner join source_evidence_log sel
        on sel.id = cel.source_evidence_id
      where sel.provider = 'mailchimp'
        and cel.occurred_at > ${input.windowStart}
        and cel.occurred_at <= ${input.windowEnd}
    `
  );

  const [row] = normalizeSqlResultRows(countResult) as readonly MailchimpBatchCountRow[];
  if (row === undefined) {
    return 0;
  }

  const parsed =
    typeof row.canonicalEventCount === "number"
      ? row.canonicalEventCount
      : Number.parseInt(row.canonicalEventCount, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLogStreamId(value: string | null | undefined): LogStreamId {
  return value === DEFAULT_LOG_STREAM_ID
    ? DEFAULT_LOG_STREAM_ID
    : DEFAULT_LOG_STREAM_ID;
}

function parseBeforeTimestamp(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function buildSourceEvidenceCollisionSummary(
  detail: SourceEvidenceCollisionDetailViewModel
): string {
  const checksumCount = detail.losing.length + 1;
  return `${PROVIDER_LABEL[detail.provider]} • ${String(checksumCount)} payload versions for one idempotency key; canonical winner preserved`;
}

function hasActivationRequirements(input: {
  readonly projectAlias: string | null;
  readonly emailCount: number;
}): boolean {
  return input.emailCount >= 1 && (input.projectAlias?.trim().length ?? 0) > 0;
}

function deriveSuggestedAlias(projectName: string): string {
  const collapsedName = projectName.trim().replace(/\s+/g, " ");
  const afterColon = collapsedName.includes(":")
    ? collapsedName.slice(collapsedName.lastIndexOf(":") + 1).trim()
    : collapsedName;
  const withoutCommonPrefix = afterColon.replace(
    /^(WPEF|Searching For|Restoring)\s+/i,
    ""
  );
  const meaningfulWords = withoutCommonPrefix
    .split(" ")
    .filter((word) => word.length > 0)
    .slice(0, 3)
    .join(" ")
    .trim();
  const fallback = withoutCommonPrefix.trim().slice(0, 32);
  const candidate = meaningfulWords.length > 0 ? meaningfulWords : fallback;

  if (candidate.length === 0) {
    return collapsedName.slice(0, 32);
  }

  return candidate.slice(0, 32);
}

function toProjectRowViewModel(input: {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectAlias: string | null;
  readonly postmarkSenderStatus: PostmarkSenderStatus;
  readonly connectedToProjectId?: string | null;
  readonly isActive: boolean;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: Date | null;
  readonly hasCachedAiKnowledge: boolean;
  readonly emails: readonly {
    readonly id: string;
    readonly address: string;
    readonly isPrimary: boolean;
    readonly signature: string;
  }[];
  readonly memberCount: number;
}): ProjectRowViewModel {
  const primaryEmail =
    input.emails.find((email) => email.isPrimary)?.address ?? null;
  const additionalEmailCount = Math.max(input.emails.length - 1, 0);

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    suggestedAlias: deriveSuggestedAlias(input.projectName),
    projectAlias: input.projectAlias,
    postmarkSenderStatus: input.postmarkSenderStatus,
    connectedToProjectId: input.connectedToProjectId ?? null,
    isActive: input.isActive,
    primaryEmail,
    emailAliases: input.emails.map((email) => email.address),
    additionalEmailCount,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt?.toISOString() ?? null,
    hasCachedAiKnowledge: input.hasCachedAiKnowledge,
    memberCount: input.memberCount,
    activationRequirementsMet: hasActivationRequirements({
      projectAlias: input.projectAlias,
      emailCount: input.emails.length
    })
  };
}

async function readProjectsSettings(input: {
  readonly filter: "active" | "inactive" | "all";
  readonly search?: string | null;
}): Promise<Omit<ProjectsSettingsViewModel, "isAdmin">> {
  const runtime = await getStage1WebRuntime();
  const normalizedSearch = normalizeSearch(input.search);
  const projects = await runtime.settings.projects.listAll();

  const matchingProjects = projects.filter((project) => {
    if (normalizedSearch === null) {
      return true;
    }

    return (
      project.projectName.toLowerCase().includes(normalizedSearch) ||
      (project.projectAlias?.toLowerCase().includes(normalizedSearch) ?? false) ||
      project.emails.some((email) =>
        email.address.toLowerCase().includes(normalizedSearch)
      )
    );
  });

  const filteredProjects = matchingProjects.filter((project) => {
    if (input.filter === "all") {
      return true;
    }

    return input.filter === "active" ? project.isActive : !project.isActive;
  });

  const activeRows = filteredProjects
    .filter((project) => project.isActive)
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        left.projectName.localeCompare(right.projectName)
    )
    .map(toProjectRowViewModel);
  const inactiveRows = filteredProjects
    .filter((project) => !project.isActive)
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.projectName.localeCompare(right.projectName)
    )
    .map(toProjectRowViewModel);

  const active = nestConnectedSubProjects(activeRows);
  const inactive = nestConnectedSubProjects(inactiveRows);

  return {
    active,
    inactive,
    counts: {
      active: activeRows.length,
      inactive: inactiveRows.length,
      total: activeRows.length + inactiveRows.length
    }
  };
}

/**
 * Folds a flat row list into `{ host, connectedSubProjects }` entries.
 * Connected sub-projects are removed from the top level and nested under
 * their host. Sub-projects whose host isn't in this bucket (e.g. host is
 * inactive while sub remains active) stay as their own top-level entry —
 * data integrity should prevent this, but the fallback keeps the row
 * visible rather than silently dropping it. Sub-projects under each host
 * are sorted by project name.
 */
function nestConnectedSubProjects(
  rows: readonly ProjectRowViewModel[]
): readonly ProjectListEntryViewModel[] {
  const subsByHostId = new Map<string, ProjectRowViewModel[]>();
  const hostIds = new Set(rows.map((row) => row.projectId));

  for (const row of rows) {
    if (
      row.connectedToProjectId !== null &&
      hostIds.has(row.connectedToProjectId)
    ) {
      const existing = subsByHostId.get(row.connectedToProjectId) ?? [];
      existing.push(row);
      subsByHostId.set(row.connectedToProjectId, existing);
    }
  }

  return rows
    .filter(
      (row) =>
        row.connectedToProjectId === null ||
        !hostIds.has(row.connectedToProjectId)
    )
    .map((host) => {
      const subs = subsByHostId.get(host.projectId) ?? [];
      return {
        host,
        connectedSubProjects: subs
          .slice()
          .sort((left, right) =>
            left.projectName.localeCompare(right.projectName)
          )
      };
    });
}

async function readProjectSettingsDetail(
  projectId: string
) {
  const runtime = await getStage1WebRuntime();
  const [project, dimension] = await Promise.all([
    runtime.settings.projects.findById(projectId),
    runtime.repositories.projectDimensions.findById(projectId)
  ]);

  if (project === null) {
    return null;
  }

  const aiKnowledgeSources = dimension?.aiKnowledgeSources ?? [];
  const aiOptimizedInputHash = dimension?.aiOptimizedInputHash ?? null;

  // For host projects (no connection of their own), look up active sub-
  // projects rolling into this one, plus inactive candidates available to
  // connect. Skip both queries for connected sub-projects: those don't get
  // a picker and don't host their own connections.
  const isHost = project.connectedToProjectId === null;
  const [connectedSubs, candidates, host] = await Promise.all([
    isHost
      ? runtime.settings.projects.listConnectedProjects(projectId)
      : Promise.resolve([] as readonly Awaited<
          ReturnType<typeof runtime.settings.projects.listConnectedProjects>
        >[number][]),
    isHost
      ? runtime.settings.projects.listAvailableConnectionCandidates()
      : Promise.resolve([] as readonly Awaited<
          ReturnType<
            typeof runtime.settings.projects.listAvailableConnectionCandidates
          >
        >[number][]),
    project.connectedToProjectId === null
      ? Promise.resolve(null)
      : runtime.settings.projects.findById(project.connectedToProjectId)
  ]);

  return {
    ...toProjectRowViewModel(project),
    aiKnowledgeSources,
    aiOperatingContext: dimension?.aiOperatingContext ?? "",
    aiAutoSyncSchedule: dimension?.aiAutoSyncSchedule ?? "never",
    aiOptimizedSynthesizedAt: dimension?.aiOptimizedSynthesizedAt ?? null,
    aiOptimizedLastCheckedAt: dimension?.aiOptimizedLastCheckedAt ?? null,
    aiOptimizedInputHash,
    // Only consider synthesis "stale" when a prior synthesis exists to
    // compare against. Otherwise (never-synthesized), the project is in a
    // "needs first synthesis" state, which the Synthesis status copy already
    // conveys via "Not yet synthesized." Showing the stale banner alongside
    // that copy is contradictory — the input never matched anything yet.
    aiKnowledgeSynthesisStale:
      aiOptimizedInputHash !== null &&
      inputHashFromSources(aiKnowledgeSources) !== aiOptimizedInputHash,
    emails: project.emails,
    salesforceProjectId: project.salesforceProjectId,
    connectedProjects: connectedSubs.map((sub) => ({
      projectId: sub.projectId,
      projectName: sub.projectName
    })),
    connectedToHost:
      host === null
        ? null
        : {
            projectId: host.projectId,
            projectName: host.projectName,
            projectAlias: host.projectAlias,
            aiKnowledgeUrl: host.aiKnowledgeUrl
          },
    availableConnectionCandidates: candidates.map((candidate) => ({
      projectId: candidate.projectId,
      projectName: candidate.projectName
    }))
  };
}

function toUserViewModel(user: {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: "admin" | "operator";
  readonly emailVerified: Date | null;
  readonly deactivatedAt: Date | null;
  readonly updatedAt: Date;
}): UserRowViewModel {
  const status =
    user.deactivatedAt !== null
      ? "deactivated"
      : user.role === "admin" || user.emailVerified !== null
        ? "active"
        : "pending";

  return {
    userId: user.id,
    displayName: user.name ?? user.email,
    email: user.email,
    role: user.role === "admin" ? "admin" : "internal_user",
    lastActiveAt:
      status === "pending"
        ? null
        : (user.deactivatedAt ?? user.updatedAt).toISOString(),
    status
  };
}

function sortUsers(
  users: readonly UserRowViewModel[],
  currentUserId: string | null
): UserRowViewModel[] {
  const statusRank = {
    active: 0,
    pending: 1,
    deactivated: 2
  } as const;

  return users.slice().sort((left, right) => {
    if (left.userId === currentUserId) {
      return -1;
    }
    if (right.userId === currentUserId) {
      return 1;
    }

    const statusDelta = statusRank[left.status] - statusRank[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}

async function readAccessSettings() {
  const runtime = await getStage1WebRuntime();
  const users = await runtime.settings.users.listAll();
  const rows = users.map(toUserViewModel);
  return {
    rows
  };
}

async function readOrgSendersSettings(): Promise<
  Pick<OrgSendersSettingsViewModel, "orgSenders">
> {
  return {
    orgSenders: await listAllOrgSenders()
  };
}

async function readIntegrationHealth(): Promise<
  Pick<IntegrationsSettingsViewModel, "integrations" | "twilioCard">
> {
  const runtime = await getStage1WebRuntime();
  const env = readWebEnv();
  const now = new Date();
  const nowMs = now.getTime();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  await runtime.settings.integrationHealth.seedDefaults();
  const [rows, syncStates, mailchimpSnapshot, activeSmsSenders, latestCallback, latestDelivered, usageSnapshot] =
    await Promise.all([
      runtime.settings.integrationHealth.listAll(),
      runtime.repositories.syncState.listAll(),
      readMailchimpSnapshot(runtime),
      runtime.settings.smsSenders.listActive(),
      runtime.settings.smsMessages.findLatestByStatuses(["delivered", "failed"]),
      runtime.settings.smsMessages.findLatestByStatuses(["delivered"]),
      runtime.settings.smsSenders.getActiveUsageSnapshot({
        monthStart,
      }),
    ]);

  const integrationById = new Map(rows.map((row) => [row.id, row] as const));
  const latestMailchimpSync = getLatestSuccessfulMailchimpTransitionSync(syncStates);
  const latestMailchimpSyncAt = latestMailchimpSync?.lastSuccessfulAt ?? null;
  const mailchimpBaseUrl = readMailchimpCaptureBaseUrl();
  const latestMailchimpSyncAgeMs =
    latestMailchimpSyncAt === null
      ? null
      : nowMs - Date.parse(latestMailchimpSyncAt);
  const mailchimpActivityAgeMs =
    mailchimpSnapshot.latestActivityAt === null
      ? null
      : nowMs - Date.parse(mailchimpSnapshot.latestActivityAt);
  const hasFreshMailchimpSync =
    latestMailchimpSyncAgeMs !== null &&
    Number.isFinite(latestMailchimpSyncAgeMs) &&
    latestMailchimpSyncAgeMs <= MAILCHIMP_HEALTHY_WINDOW_MS;
  const hasMailchimpEvidence =
    latestMailchimpSyncAt !== null || mailchimpSnapshot.latestActivityAt !== null;
  const shouldHideMailchimp =
    mailchimpBaseUrl === null &&
    mailchimpSnapshot.latestActivityAt !== null &&
    mailchimpActivityAgeMs !== null &&
    Number.isFinite(mailchimpActivityAgeMs) &&
    mailchimpActivityAgeMs > MAILCHIMP_AUTO_HIDE_WINDOW_MS;
  const mailchimpBatchRecipientCount = await readMailchimpLastBatchRecipientCount(
    runtime,
    {
      windowStart: latestMailchimpSync?.windowStart ?? null,
      windowEnd: latestMailchimpSync?.windowEnd ?? null,
    }
  );
  const integrations: IntegrationHealthViewModel[] = [];

  for (const serviceName of INTEGRATION_ORDER) {
    const record = integrationById.get(serviceName);
    if (record === undefined || (serviceName === "mailchimp" && shouldHideMailchimp)) {
      continue;
    }

    const meta = INTEGRATION_META[serviceName];
    if (serviceName === "mailchimp") {
      const mailchimpStatus: MailchimpTileStatus =
        hasFreshMailchimpSync
          ? "connected"
          : mailchimpBaseUrl !== null || hasMailchimpEvidence
            ? "stale"
            : "unconfigured";

      integrations.push({
        serviceName: record.serviceName,
        displayName: meta.displayName,
        description: meta.description,
        category: record.category,
        status:
          mailchimpStatus === "connected"
            ? "healthy"
            : mailchimpStatus === "unconfigured"
              ? "not_configured"
              : "needs_attention",
        lastCheckedAt: latestMailchimpSyncAt,
        detail: null,
        supportsRefresh: meta.supportsRefresh,
        mailchimp: {
          status: mailchimpStatus,
          lastSuccessfulSyncAt: latestMailchimpSyncAt,
          lastCampaignName: mailchimpSnapshot.lastCampaignName,
          lastCampaignSentAt: mailchimpSnapshot.lastCampaignSentAt,
          lastBatchRecipientCount: mailchimpBatchRecipientCount,
        },
      });
      continue;
    }

    // TODO(anthropic-health-probe): The `openai` (Anthropic) row stays at
    // `not_configured` seed status because there is no HTTP capture-service
    // endpoint to poll — Anthropic is a direct API client. A real probe would
    // need to hit the Anthropic API directly (e.g. GET /v1/models) or check
    // the AI draft ledger for a successful call within a rolling window.
    // Until that worker probe lands, we surface `not_checked` when the API key
    // is present so the card doesn't falsely show "Not configured".
    const probeIsStale = isProbeStale(serviceName, record.lastCheckedAt, now);
    const effectiveStatus = probeIsStale
      ? "needs_attention"
      : serviceName === "openai" &&
          record.status === "not_configured" &&
          (process.env.ANTHROPIC_API_KEY?.trim().length ?? 0) > 0
        ? ("not_checked" as const)
        : record.status;
    const lastCheckedAtMs = getTimestampMs(record.lastCheckedAt);
    const detail =
      probeIsStale && lastCheckedAtMs !== null
        ? `Health probe last ran ${formatProbeAge(nowMs - lastCheckedAtMs)}`
        : record.detail;

    integrations.push({
      serviceName: record.serviceName,
      displayName: meta.displayName,
      description: meta.description,
      category: record.category,
      status: effectiveStatus,
      lastCheckedAt: record.lastCheckedAt,
      detail,
      supportsRefresh: meta.supportsRefresh,
      mailchimp: null,
    });
  }

  const hasActiveSender = activeSmsSenders.length > 0;
  const deliveredWithinLastDay =
    latestDelivered !== null &&
    nowMs - latestDelivered.updatedAt.getTime() <= 24 * 60 * 60 * 1000;
  const twilioCardStatus =
    !env.SMS_ENABLED || !hasActiveSender
      ? "not-configured"
      : deliveredWithinLastDay
        ? "active"
        : "degraded";
  const monthToDateSegments = usageSnapshot?.monthToDateSegments ?? null;
  const monthToDateSpendUsd =
    monthToDateSegments === null
      ? null
      : estimateSmsCostUsd(
          monthToDateSegments,
          env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT,
        );

  return {
    integrations,
    twilioCard: {
      status: twilioCardStatus,
      smsEnabled: env.SMS_ENABLED,
      hasActiveSender,
      lastStatusCallbackAt: latestCallback?.updatedAt.toISOString() ?? null,
      outboundRateUsdPerSegment: env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT,
      monthToDateSpendUsd,
      monthToDateSegments,
      monthlyCapUsd: usageSnapshot?.monthlyCap ?? null,
    },
  };
}

async function readLogsSettings(input: {
  readonly streamId: LogStreamId;
  readonly beforeTimestamp: Date | null;
}): Promise<Pick<LogsSettingsViewModel, "entries" | "nextBeforeTimestamp">> {
  const runtime = await getStage1WebRuntime();
  const result =
    await runtime.repositories.sourceEvidence.listIdempotencyChecksumCollisions(
      input.beforeTimestamp === null
        ? {
            limit: LOGS_PAGE_SIZE
          }
        : {
            limit: LOGS_PAGE_SIZE,
            beforeTimestamp: input.beforeTimestamp
          }
    );

  return {
    entries: result.entries.map((entry) => {
      const detail: SourceEvidenceCollisionDetailViewModel = {
        provider: entry.provider,
        idempotencyKey: entry.idempotencyKey,
        winning: {
          sourceEvidenceId: entry.winning.sourceEvidenceId,
          checksum: entry.winning.checksum,
          receivedAt: entry.winning.receivedAt.toISOString()
        },
        losing: entry.losing.map((losingEntry) => ({
          quarantineId: losingEntry.quarantineId,
          checksum: losingEntry.checksum,
          attemptedAt: losingEntry.attemptedAt.toISOString()
        }))
      };

      return {
        id: `${entry.provider}:${entry.idempotencyKey}`,
        streamId: input.streamId,
        timestamp: entry.latestReceivedAt.toISOString(),
        summary: buildSourceEvidenceCollisionSummary(detail),
        detail
      };
    }),
    nextBeforeTimestamp: result.hasMore
      ? (result.entries.at(-1)?.latestReceivedAt.toISOString() ?? null)
      : null
  };
}

function loadProjectsSettingsCacheData(input: {
  readonly filter: "active" | "inactive" | "all";
  readonly search?: string | null;
}) {
  if (process.env.NODE_ENV !== "production") {
    return readProjectsSettings(input);
  }

  return unstable_cache(
    () => readProjectsSettings(input),
    [
      `settings:projects:${input.filter}:${normalizeSearch(input.search) ?? "none"}`
    ],
    {
      tags: ["settings:projects"]
    }
  )();
}

function loadProjectSettingsDetailCacheData(projectId: string) {
  if (process.env.NODE_ENV !== "production") {
    return readProjectSettingsDetail(projectId);
  }

  return unstable_cache(
    () => readProjectSettingsDetail(projectId),
    [`settings:project:${projectId}`],
    {
      tags: ["settings:projects", `settings:projects:${projectId}`]
    }
  )();
}

function loadAccessSettingsCacheData() {
  if (process.env.NODE_ENV !== "production") {
    return readAccessSettings();
  }

  return unstable_cache(() => readAccessSettings(), ["settings:team"], {
    tags: ["settings:team"]
  })();
}

function loadOrgSendersSettingsCacheData() {
  if (process.env.NODE_ENV !== "production") {
    return readOrgSendersSettings();
  }

  return unstable_cache(
    () => readOrgSendersSettings(),
    ["settings:newsletter"],
    {
      tags: ["settings:newsletter"]
    }
  )();
}

function loadIntegrationHealthCacheData(): Promise<
  Pick<IntegrationsSettingsViewModel, "integrations" | "twilioCard">
> {
  if (process.env.NODE_ENV !== "production") {
    return readIntegrationHealth();
  }

  return unstable_cache(
    () => readIntegrationHealth(),
    ["settings:integrations"],
    {
      tags: ["settings:integrations"]
    }
  )();
}

function loadLogsSettingsCacheData(input: {
  readonly streamId: LogStreamId;
  readonly beforeTimestampIso: string | null;
}) {
  const beforeTimestamp =
    input.beforeTimestampIso === null
      ? null
      : new Date(input.beforeTimestampIso);

  if (process.env.NODE_ENV !== "production") {
    return readLogsSettings({
      streamId: input.streamId,
      beforeTimestamp
    });
  }

  return unstable_cache(
    () =>
      readLogsSettings({
        streamId: input.streamId,
        beforeTimestamp
      }),
    [`settings:logs:${input.streamId}:${input.beforeTimestampIso ?? "none"}`],
    {
      tags: ["settings:logs"]
    }
  )();
}

export async function loadProjectsSettings(input: {
  readonly filter: "active" | "inactive" | "all";
  readonly search?: string | null;
}): Promise<ProjectsSettingsViewModel> {
  const [currentUser, cachedData] = await Promise.all([
    getCurrentUser(),
    loadProjectsSettingsCacheData(input)
  ]);
  const normalizedSearch = normalizeSearch(input.search);

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.projects.read",
    entityType: "settings_page",
    entityId: "projects",
    metadataJson: {
      filter: input.filter,
      visibleProjectCount: cachedData.counts.total,
      search: normalizedSearch
    }
  });

  return {
    isAdmin: currentUser?.role === "admin",
    ...cachedData
  };
}

export async function loadProjectSettingsDetail(
  projectId: string
): Promise<ProjectSettingsDetailViewModel | null> {
  const [currentUser, cachedData] = await Promise.all([
    getCurrentUser(),
    loadProjectSettingsDetailCacheData(projectId)
  ]);

  if (cachedData === null) {
    return null;
  }

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.project.read",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      emailCount: cachedData.emails.length
    }
  });

  return {
    ...cachedData,
    isAdmin: currentUser?.role === "admin"
  };
}

export async function loadAccessSettings(): Promise<AccessSettingsViewModel> {
  const currentUser = await getCurrentUser();
  if (currentUser === null) {
    throw new Error("UNAUTHORIZED");
  }
  if (currentUser.role !== "admin") {
    throw new Error("FORBIDDEN");
  }

  const cachedData = await loadAccessSettingsCacheData();
  const currentUserId = currentUser.id;
  const admins = sortUsers(
    cachedData.rows.filter((user) => user.role === "admin"),
    currentUserId
  );
  const internalUsers = sortUsers(
    cachedData.rows.filter((user) => user.role === "internal_user"),
    currentUserId
  );

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.users.read",
    entityType: "settings_page",
    entityId: "users",
    metadataJson: {
      visibleUserCount: cachedData.rows.length
    }
  });

  return {
    isAdmin: true,
    currentUserId,
    admins,
    internalUsers
  };
}

export async function loadIntegrationHealth(): Promise<IntegrationsSettingsViewModel> {
  const [currentUser, cachedData] = await Promise.all([
    getCurrentUser(),
    loadIntegrationHealthCacheData()
  ]);

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.integrations.read",
    entityType: "settings_page",
    entityId: "integrations",
    metadataJson: {
      visibleIntegrationCount: cachedData.integrations.length
    }
  });

  return {
    isAdmin: currentUser?.role === "admin",
    integrations: cachedData.integrations,
    twilioCard: cachedData.twilioCard,
  };
}

export async function loadOrgSendersSettings(): Promise<OrgSendersSettingsViewModel> {
  const [currentUser, cachedData] = await Promise.all([
    getCurrentUser(),
    loadOrgSendersSettingsCacheData()
  ]);

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.org_senders.read",
    entityType: "settings_page",
    entityId: "newsletter",
    metadataJson: {
      visibleOrgSenderCount: cachedData.orgSenders.length
    }
  });

  return {
    isAdmin: currentUser?.role === "admin",
    orgSenders: cachedData.orgSenders
  };
}

export async function loadLogsSettings(input: {
  readonly streamId: string;
  readonly beforeTimestamp: string | null;
}): Promise<LogsSettingsViewModel> {
  const currentUser = await getCurrentUser();
  if (currentUser === null) {
    throw new Error("UNAUTHORIZED");
  }
  if (currentUser.role !== "admin") {
    throw new Error("FORBIDDEN");
  }

  const activeStreamId = normalizeLogStreamId(input.streamId);
  const beforeTimestamp = parseBeforeTimestamp(input.beforeTimestamp);
  const cachedData = await loadLogsSettingsCacheData({
    streamId: activeStreamId,
    beforeTimestampIso: beforeTimestamp?.toISOString() ?? null
  });

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.logs.read",
    entityType: "settings_page",
    entityId: "logs",
    metadataJson: {
      streamId: activeStreamId,
      visibleEntryCount: cachedData.entries.length
    }
  });

  return {
    streams: LOG_STREAMS,
    activeStreamId,
    entries: cachedData.entries,
    nextBeforeTimestamp: cachedData.nextBeforeTimestamp
  };
}
