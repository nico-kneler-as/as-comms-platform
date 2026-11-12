import {
  salesforceSubscriptionBoxValues,
  type CapturedSubscriptionPreference,
  type SalesforceSubscriptionBox,
  type SalesforceSubscriptionReadbackMode,
} from "@as-comms/contracts";

export type MirrorRow = Readonly<{
  salesforceRecordId: string;
  email: string;
  salesforceContactId: string | null;
  generalNewsletter: boolean;
  oregonShoresNewsletter: boolean;
  projectBoxes: Readonly<Record<SalesforceSubscriptionBox, boolean>>;
  unsubscribedFromAll: boolean;
  unsubscribedAt: string | null;
  emailBounced: boolean;
  recordCreationSource: string | null;
  isDeleted: boolean;
  sfLastModifiedAt: string;
  sfLastModifiedById: string | null;
  capturedAt: string;
}>;

export type ReadbackOutcome =
  | "applied"
  | "would_apply"
  | "no_change"
  | "skipped_integration_user"
  | "skipped_form_false"
  | "skipped_platform_newer"
  | "skipped_suppressed"
  | "skipped_cleaned_address"
  | "skipped_no_projects_for_box"
  | "skipped_no_contact";

export type ConsentState = Readonly<{
  id: string;
  contactId: string;
  scopeType: "newsletter" | "project" | "all";
  scopeId: string | null;
  optedOutAt: string;
}>;
export type PlatformConsentState = Readonly<{
  consentsByContact: ReadonlyMap<string, readonly ConsentState[]>;
  newsletterSubscribersByEmail: ReadonlyMap<
    string,
    Readonly<{ status: string; lastChangedAt: string | null }>
  >;
  newsletterSuppressionsByEmail: ReadonlyMap<
    string,
    Readonly<{ reason: string; updatedAt: string }>
  >;
  suppressionEmails: ReadonlySet<string>;
  /**
   * Active "all" rows in the email opt-out ledger (PRD #768), by email, with
   * when they were recorded. Optional so older callers keep compiling.
   */
  emailOptOutAllByEmail?: ReadonlyMap<string, string>;
}>;

export type ReadbackAction =
  | Readonly<{
      kind: "insert_consent";
      contactId: string;
      scopeType: "newsletter" | "project" | "all";
      scopeId: string | null;
      optedOutAt: string;
    }>
  | Readonly<{ kind: "clear_consent"; consentIds: readonly string[] }>
  | Readonly<{ kind: "clear_email_opt_out_all"; email: string }>
  | Readonly<{ kind: "insert_suppression"; email: string }>
  | Readonly<{ kind: "delete_suppression"; email: string }>
  | Readonly<{ kind: "upsert_subscriber"; email: string; changedAt: string }>;

export type PlannedReadbackEvent = Readonly<{
  id: string;
  salesforceRecordId: string;
  email: string;
  field: "general_newsletter" | "project_box" | "unsubscribed_from_all";
  projectBox: SalesforceSubscriptionBox | null;
  fromValue: boolean | null;
  toValue: boolean;
  sfModifiedAt: string;
  sfModifiedByUsername: string | null;
  contactsMatched: number;
  outcome: ReadbackOutcome;
  actions: readonly ReadbackAction[];
}>;

const lowered = (value: string | null | undefined) =>
  value?.trim().toLowerCase() ?? "";
const newer = (value: string | null | undefined, timestamp: string) =>
  value !== null &&
  value !== undefined &&
  new Date(value).getTime() > new Date(timestamp).getTime();

function toMirror(record: CapturedSubscriptionPreference): MirrorRow {
  return {
    ...record,
    projectBoxes: {
      "PNW Forest Monitoring":
        record.projectBoxes["PNW Forest Monitoring"] === true,
      "Beech and Butternut":
        record.projectBoxes["Beech and Butternut"] === true,
      "Tracking Whitebark Pine":
        record.projectBoxes["Tracking Whitebark Pine"] === true,
      "Coral Reef Expansion":
        record.projectBoxes["Coral Reef Expansion"] === true,
      "Monitoring Killer Whales Project":
        record.projectBoxes["Monitoring Killer Whales Project"] === true,
    },
    sfLastModifiedAt: record.lastModifiedAt,
    sfLastModifiedById: record.lastModifiedById,
    capturedAt: record.lastModifiedAt,
  };
}

function outcomeForActions(
  mode: SalesforceSubscriptionReadbackMode,
  actions: readonly ReadbackAction[],
): ReadbackOutcome {
  return actions.length === 0
    ? "no_change"
    : mode === "apply"
      ? "applied"
      : "would_apply";
}

export function planSubscriptionReadback(input: {
  readonly mode: SalesforceSubscriptionReadbackMode;
  readonly baseline: boolean;
  readonly records: readonly CapturedSubscriptionPreference[];
  readonly mirror: ReadonlyMap<string, MirrorRow>;
  readonly integrationUsername: string;
  readonly formsUsernames: readonly string[];
  readonly contactsByRecordId: ReadonlyMap<string, readonly string[]>;
  readonly projectsByBox: ReadonlyMap<string, readonly string[]>;
  readonly platformState: PlatformConsentState;
}): { mirrorUpserts: MirrorRow[]; events: PlannedReadbackEvent[] } {
  const mirrorUpserts = input.records.map(toMirror);
  const events: PlannedReadbackEvent[] = [];
  const forms = new Set(input.formsUsernames.map(lowered));
  const integration = lowered(input.integrationUsername);
  for (const record of input.records) {
    if (record.isDeleted || input.baseline) continue;
    const old = input.mirror.get(record.salesforceRecordId);
    const transitions: {
      field: PlannedReadbackEvent["field"];
      projectBox: SalesforceSubscriptionBox | null;
      fromValue: boolean | null;
      toValue: boolean;
    }[] = [];
    if (old === undefined) {
      if (record.generalNewsletter)
        transitions.push({
          field: "general_newsletter",
          projectBox: null,
          fromValue: null,
          toValue: true,
        });
      for (const box of salesforceSubscriptionBoxValues)
        if (record.projectBoxes[box] === true)
          transitions.push({
            field: "project_box",
            projectBox: box,
            fromValue: null,
            toValue: true,
          });
      if (record.unsubscribedFromAll)
        transitions.push({
          field: "unsubscribed_from_all",
          projectBox: null,
          fromValue: null,
          toValue: true,
        });
    } else {
      if (old.generalNewsletter !== record.generalNewsletter)
        transitions.push({
          field: "general_newsletter",
          projectBox: null,
          fromValue: old.generalNewsletter,
          toValue: record.generalNewsletter,
        });
      for (const box of salesforceSubscriptionBoxValues)
        if (old.projectBoxes[box] !== (record.projectBoxes[box] === true))
          transitions.push({
            field: "project_box",
            projectBox: box,
            fromValue: old.projectBoxes[box],
            toValue: record.projectBoxes[box] === true,
          });
      if (old.unsubscribedFromAll !== record.unsubscribedFromAll)
        transitions.push({
          field: "unsubscribed_from_all",
          projectBox: null,
          fromValue: old.unsubscribedFromAll,
          toValue: record.unsubscribedFromAll,
        });
    }
    for (const transition of transitions) {
      const contacts =
        input.contactsByRecordId.get(record.salesforceRecordId) ?? [];
      const base = {
        id: crypto.randomUUID(),
        salesforceRecordId: record.salesforceRecordId,
        email: record.email,
        ...transition,
        sfModifiedAt: record.lastModifiedAt,
        sfModifiedByUsername: record.lastModifiedByUsername,
        contactsMatched: contacts.length,
      };
      const username = lowered(record.lastModifiedByUsername);
      if (username !== "" && username === integration) {
        events.push({
          ...base,
          outcome: "skipped_integration_user",
          actions: [],
        });
        continue;
      }
      if (!transition.toValue && forms.has(username)) {
        events.push({ ...base, outcome: "skipped_form_false", actions: [] });
        continue;
      }
      const T = record.lastModifiedAt;
      const suppression = input.platformState.newsletterSuppressionsByEmail.get(
        record.email,
      );
      const subscriber = input.platformState.newsletterSubscribersByEmail.get(
        record.email,
      );
      let outcome: ReadbackOutcome;
      let actions: readonly ReadbackAction[] = [];
      if (transition.field === "general_newsletter") {
        if (!transition.toValue) {
          if (
            subscriber?.status === "subscribed" &&
            newer(subscriber.lastChangedAt, T)
          )
            outcome = "skipped_platform_newer";
          else {
            const existing = new Set(
              contacts
                .flatMap(
                  (contactId) =>
                    input.platformState.consentsByContact.get(contactId) ?? [],
                )
                .filter((row) => row.scopeType === "newsletter")
                .map((row) => row.contactId),
            );
            actions = [
              ...contacts
                .filter((contactId) => !existing.has(contactId))
                .map((contactId) => ({
                  kind: "insert_consent" as const,
                  contactId,
                  scopeType: "newsletter" as const,
                  scopeId: null,
                  optedOutAt: T,
                })),
              ...(suppression === undefined
                ? [{ kind: "insert_suppression" as const, email: record.email }]
                : []),
            ];
            outcome = outcomeForActions(input.mode, actions);
          }
        } else if (input.platformState.suppressionEmails.has(record.email))
          outcome = "skipped_suppressed";
        else if (suppression?.reason === "cleaned")
          outcome = "skipped_cleaned_address";
        else {
          const consentRows = contacts
            .flatMap(
              (id) => input.platformState.consentsByContact.get(id) ?? [],
            )
            .filter((row) => row.scopeType === "newsletter");
          if (
            consentRows.some((row) => newer(row.optedOutAt, T)) ||
            newer(suppression?.updatedAt, T)
          )
            outcome = "skipped_platform_newer";
          else {
            actions = [
              ...(consentRows.length === 0
                ? []
                : [
                    {
                      kind: "clear_consent" as const,
                      consentIds: consentRows.map((row) => row.id),
                    },
                  ]),
              ...(suppression?.reason === "platform_optout" ||
              suppression?.reason === "unsubscribed"
                ? [{ kind: "delete_suppression" as const, email: record.email }]
                : []),
              // Someone already subscribed needs no subscriber write; with
              // nothing to clear either, the outcome is no_change.
              ...(subscriber?.status === "subscribed"
                ? []
                : [
                    {
                      kind: "upsert_subscriber" as const,
                      email: record.email,
                      changedAt: T,
                    },
                  ]),
            ];
            outcome = outcomeForActions(input.mode, actions);
          }
        }
      } else if (transition.field === "project_box") {
        const projects =
          input.projectsByBox.get(transition.projectBox ?? "") ?? [];
        if (projects.length === 0) outcome = "skipped_no_projects_for_box";
        else if (contacts.length === 0) outcome = "skipped_no_contact";
        else {
          const rows = contacts
            .flatMap(
              (contactId) =>
                input.platformState.consentsByContact.get(contactId) ?? [],
            )
            .filter(
              (row) =>
                row.scopeType === "project" &&
                projects.includes(row.scopeId ?? ""),
            );
          if (!transition.toValue) {
            const existing = new Set(
              rows.map((row) => `${row.contactId}\u0000${row.scopeId ?? ""}`),
            );
            actions = contacts.flatMap((contactId) =>
              projects
                .filter(
                  (scopeId) => !existing.has(`${contactId}\u0000${scopeId}`),
                )
                .map((scopeId) => ({
                  kind: "insert_consent" as const,
                  contactId,
                  scopeType: "project" as const,
                  scopeId,
                  optedOutAt: T,
                })),
            );
            outcome = outcomeForActions(input.mode, actions);
          } else if (rows.length === 0) outcome = "no_change";
          else if (rows.every((row) => newer(row.optedOutAt, T)))
            outcome = "skipped_platform_newer";
          else {
            actions = [
              {
                kind: "clear_consent",
                consentIds: rows
                  .filter((row) => !newer(row.optedOutAt, T))
                  .map((row) => row.id),
              },
            ];
            outcome = outcomeForActions(input.mode, actions);
          }
        }
      } else if (transition.toValue) {
        const existing = new Set(
          contacts
            .flatMap(
              (contactId) =>
                input.platformState.consentsByContact.get(contactId) ?? [],
            )
            .filter((row) => row.scopeType === "all")
            .map((row) => row.contactId),
        );
        actions = [
          ...contacts
            .filter((contactId) => !existing.has(contactId))
            .map((contactId) => ({
              kind: "insert_consent" as const,
              contactId,
              scopeType: "all" as const,
              scopeId: null,
              optedOutAt: T,
            })),
          ...(suppression === undefined
            ? [{ kind: "insert_suppression" as const, email: record.email }]
            : []),
        ];
        outcome = outcomeForActions(input.mode, actions);
      } else {
        // Salesforce re-subscribed this person: clear the contacts' "all"
        // consent and the email ledger's "all" row, unless the platform
        // opt-out is newer than the Salesforce change.
        const ledgerOptedOutAt =
          input.platformState.emailOptOutAllByEmail?.get(record.email);
        const ledgerActions: ReadbackAction[] =
          ledgerOptedOutAt !== undefined && !newer(ledgerOptedOutAt, T)
            ? [{ kind: "clear_email_opt_out_all", email: record.email }]
            : [];
        const rows = contacts
          .flatMap((id) => input.platformState.consentsByContact.get(id) ?? [])
          .filter((row) => row.scopeType === "all");
        const clearable = rows.filter((row) => !newer(row.optedOutAt, T));
        actions = [
          ...(clearable.length > 0
            ? [
                {
                  kind: "clear_consent" as const,
                  consentIds: clearable.map((row) => row.id),
                },
              ]
            : []),
          ...ledgerActions,
        ];
        if (actions.length > 0) outcome = outcomeForActions(input.mode, actions);
        else if (rows.length > 0 || ledgerOptedOutAt !== undefined)
          outcome = "skipped_platform_newer";
        else if (contacts.length === 0) outcome = "skipped_no_contact";
        else outcome = "no_change";
      }
      events.push({ ...base, outcome, actions });
    }
  }
  return { mirrorUpserts, events };
}
