import type {
  AutomatedEmailKind,
  AutomatedEmailRenderedPreview,
  AutomatedEmailSendStatus,
  AutomatedEmailTemplateRecord,
} from "@as-comms/contracts";

import { getCurrentUser } from "../auth/session";
import { getStage1WebRuntime } from "../stage1-runtime";

export type AutomatedEmailPublishState =
  | "never_published"
  | "edited_since_publish"
  | "published";

export interface AutomatedEmailKindSourceViewModel {
  readonly kind: AutomatedEmailKind;
  readonly sourceProjectName: string | null;
}

export interface AutomatedEmailTemplateListItemViewModel {
  readonly id: string;
  readonly kind: AutomatedEmailKind;
  readonly name: string;
  readonly isActive: boolean;
  readonly hasUnpublishedChanges: boolean;
  readonly publishState: AutomatedEmailPublishState;
  readonly lastReceivedAt: string | null;
}

export interface AutomatedEmailTemplateViewModel {
  readonly id: string;
  readonly projectId: string;
  readonly kind: AutomatedEmailKind;
  readonly name: string;
  readonly draftSubject: string;
  readonly draftDoc: unknown;
  readonly publishedSubject: string | null;
  readonly publishedDoc: unknown;
  readonly publishedAt: string | null;
  readonly isActive: boolean;
  readonly updatedAt: string;
  readonly hasUnpublishedChanges: boolean;
  readonly publishState: AutomatedEmailPublishState;
}

export interface AutomatedEmailSendCountsViewModel {
  readonly received: number;
  readonly sent: number;
  readonly duplicate: number;
  readonly held: number;
  readonly failed: number;
}

export interface AutomatedEmailProjectViewModel {
  readonly projectId: string;
  readonly projectName: string;
  readonly primaryAlias: string | null;
  readonly operatorEmail: string | null;
}

export interface AutomatedEmailListViewModel extends AutomatedEmailProjectViewModel {
  readonly templates: readonly AutomatedEmailTemplateListItemViewModel[];
  readonly kindSources: readonly AutomatedEmailKindSourceViewModel[];
}

export interface AutomatedEmailEditorViewModel extends AutomatedEmailProjectViewModel {
  readonly template: AutomatedEmailTemplateViewModel;
  readonly lastReceivedAt: string | null;
  readonly sendCounts: AutomatedEmailSendCountsViewModel;
  readonly initialSendLog: AutomatedEmailSendLogPageViewModel;
}

export interface AutomatedEmailSendLogRowViewModel {
  readonly id: string;
  readonly receivedAt: string;
  readonly expeditionMemberId: string;
  readonly memberName: string;
  readonly memberEmail: string | null;
  readonly status: AutomatedEmailSendStatus;
  readonly statusReason: string | null;
  readonly renderedPreview: AutomatedEmailRenderedPreview | null;
}

export interface AutomatedEmailSendLogPageViewModel {
  readonly items: readonly AutomatedEmailSendLogRowViewModel[];
  readonly nextCursor: string | null;
}

const lifecycleKinds = [
  "application_received",
  "application_nudge",
  "application_submitted",
  "accepted",
  "denied",
  "training_reminder",
  "training_passed",
  "trip_planning",
  "data_reminder",
  "first_record",
  "post_trip",
] as const satisfies readonly Exclude<AutomatedEmailKind, "custom">[];

function isPublished(template: AutomatedEmailTemplateRecord): boolean {
  return (
    template.publishedSubject !== null &&
    template.publishedDoc !== null &&
    template.publishedAt !== null
  );
}

function hasUnpublishedChanges(
  template: AutomatedEmailTemplateRecord,
): boolean {
  if (!isPublished(template)) {
    return true;
  }

  return (
    template.draftSubject !== template.publishedSubject ||
    JSON.stringify(template.draftDoc) !== JSON.stringify(template.publishedDoc)
  );
}

/**
 * "Never published" and "published, then edited" both leave a draft ahead of
 * what Salesforce would send, but they need different work: the first has to
 * be written and published at all, the second only re-published. Every one of
 * the 122 imported templates sits in the first state, so a single "Unpublished
 * changes" badge across the whole list carried no signal.
 */
function toPublishState(
  template: AutomatedEmailTemplateRecord,
): AutomatedEmailPublishState {
  if (!isPublished(template)) {
    return "never_published";
  }

  return hasUnpublishedChanges(template) ? "edited_since_publish" : "published";
}

function toTemplateListItem(
  template: AutomatedEmailTemplateRecord,
  lastReceivedAt: string | null,
): AutomatedEmailTemplateListItemViewModel {
  return {
    id: template.id,
    kind: template.kind,
    name: template.name,
    isActive: template.isActive,
    hasUnpublishedChanges: hasUnpublishedChanges(template),
    publishState: toPublishState(template),
    lastReceivedAt,
  };
}

function toTemplateViewModel(
  template: AutomatedEmailTemplateRecord,
): AutomatedEmailTemplateViewModel {
  return {
    id: template.id,
    projectId: template.projectId,
    kind: template.kind,
    name: template.name,
    draftSubject: template.draftSubject,
    draftDoc: template.draftDoc ?? { type: "doc", content: [] },
    publishedSubject: template.publishedSubject ?? null,
    publishedDoc: template.publishedDoc ?? null,
    publishedAt: template.publishedAt ?? null,
    isActive: template.isActive,
    updatedAt: template.updatedAt,
    hasUnpublishedChanges: hasUnpublishedChanges(template),
    publishState: toPublishState(template),
  };
}

function toSendCounts(
  counts: Readonly<Record<AutomatedEmailSendStatus, number>>,
): AutomatedEmailSendCountsViewModel {
  return {
    received: counts.received,
    sent: counts.sent,
    duplicate: counts.duplicate,
    held: counts.held,
    failed: counts.failed,
  };
}

export async function loadAutomatedEmailSendLogPage(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}): Promise<AutomatedEmailSendLogPageViewModel | null> {
  const runtime = await getStage1WebRuntime();
  const template = await runtime.automatedEmails.getTemplateById(
    input.templateId,
  );
  if (template?.projectId !== input.projectId) {
    return null;
  }

  const sends = await runtime.automatedEmails.listSendsByTemplate({
    templateId: template.id,
    limit: input.limit ?? 25,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
  const contactIds = sends.items.flatMap((send) =>
    send.contactId === null ? [] : [send.contactId],
  );
  const contacts = await runtime.repositories.contacts.listByIds(contactIds);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));

  return {
    items: sends.items.map((send) => {
      const contact =
        send.contactId === null
          ? null
          : (contactById.get(send.contactId) ?? null);
      return {
        id: send.id,
        receivedAt: send.receivedAt,
        expeditionMemberId: send.expeditionMemberId,
        memberName: contact?.displayName ?? send.expeditionMemberId,
        memberEmail: contact?.primaryEmail ?? null,
        status: send.status,
        statusReason: send.statusReason,
        renderedPreview: send.renderedPreview,
      };
    }),
    nextCursor: sends.nextCursor,
  };
}

async function loadProject(
  projectId: string,
): Promise<AutomatedEmailProjectViewModel | null> {
  const [runtime, currentUser] = await Promise.all([
    getStage1WebRuntime(),
    getCurrentUser(),
  ]);
  const project = await runtime.settings.projects.findById(projectId);
  if (project === null) {
    return null;
  }

  return {
    projectId: project.projectId,
    projectName: project.projectName,
    primaryAlias:
      project.emails.find((email) => email.isPrimary)?.address ??
      project.emails[0]?.address ??
      null,
    operatorEmail: currentUser?.email ?? null,
  };
}

export async function loadAutomatedEmailKindSources(
  projectId: string,
): Promise<readonly AutomatedEmailKindSourceViewModel[]> {
  const runtime = await getStage1WebRuntime();

  return Promise.all(
    lifecycleKinds.map(async (kind) => {
      const template = await runtime.automatedEmails.findLatestPublishedByKind(
        kind,
        { excludeProjectId: projectId },
      );
      if (template === null) {
        return { kind, sourceProjectName: null };
      }

      const sourceProject = await runtime.settings.projects.findById(
        template.projectId,
      );
      return {
        kind,
        sourceProjectName: sourceProject?.projectName ?? null,
      };
    }),
  );
}

export async function loadAutomatedEmailList(
  projectId: string,
): Promise<AutomatedEmailListViewModel | null> {
  const [project, runtime] = await Promise.all([
    loadProject(projectId),
    getStage1WebRuntime(),
  ]);
  if (project === null) {
    return null;
  }

  const templates =
    await runtime.automatedEmails.listTemplatesByProject(projectId);
  const lastReceivedAtByTemplateId =
    await runtime.automatedEmails.getLastReceivedAtByTemplateIds(
      templates.map((template) => template.id),
    );
  const latestByKind = await loadAutomatedEmailKindSources(projectId);

  return {
    ...project,
    templates: templates.map((template) =>
      toTemplateListItem(
        template,
        lastReceivedAtByTemplateId.get(template.id) ?? null,
      ),
    ),
    kindSources: latestByKind,
  };
}

export async function loadAutomatedEmailEditor(
  projectId: string,
  templateId: string,
): Promise<AutomatedEmailEditorViewModel | null> {
  const [project, runtime] = await Promise.all([
    loadProject(projectId),
    getStage1WebRuntime(),
  ]);
  if (project === null) {
    return null;
  }

  const template = await runtime.automatedEmails.getTemplateById(templateId);
  if (template?.projectId !== projectId) {
    return null;
  }

  const [lastReceivedAtByTemplateId, sendCounts, initialSendLog] =
    await Promise.all([
      runtime.automatedEmails.getLastReceivedAtByTemplateIds([template.id]),
      runtime.automatedEmails.getSendStatusCountsByTemplateId(template.id),
      loadAutomatedEmailSendLogPage({ projectId, templateId: template.id }),
    ]);

  return {
    ...project,
    template: toTemplateViewModel(template),
    lastReceivedAt: lastReceivedAtByTemplateId.get(template.id) ?? null,
    sendCounts: toSendCounts(sendCounts),
    initialSendLog: initialSendLog ?? { items: [], nextCursor: null },
  };
}
