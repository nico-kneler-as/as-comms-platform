import {
  salesforceSubscriptionBoxValues,
  type SalesforceSubscriptionBox,
  type SubscriptionPreferenceChange,
} from "@as-comms/contracts";

/** Inputs deliberately use provider-shaped primitive values so this planner can
 * be exercised without either a database or Salesforce client. */
export type SubscriptionBackfillInput = Readonly<{
  contacts: readonly Readonly<{
    salesforceContactId: string;
    email: string;
    hasOptedOutOfEmail: boolean;
    doNotContact: boolean;
  }>[];
  memberships: readonly Readonly<{
    salesforceContactId: string;
    projectId: string;
    status: string | null;
  }>[];
  projectBoxes: readonly Readonly<{ projectId: string; box: string }>[];
  connectedProjects: readonly Readonly<{
    projectId: string;
    connectedToProjectId: string | null;
  }>[];
  existing: readonly Readonly<{
    salesforceRecordId: string;
    email: string;
    contactId: string | null;
    generalNewsletter: boolean;
    oregonShoresNewsletter: boolean;
    projectBoxes: Readonly<Record<SalesforceSubscriptionBox, boolean>>;
    unsubscribedFromAll: boolean;
    unsubscribedAt: string | null;
    emailBounced: boolean;
  }>[];
  newsletterSubscribers: readonly Readonly<{ email: string; status: string }>[];
  newsletterSuppressions: readonly Readonly<{
    email: string;
    reason: "unsubscribed" | "cleaned" | "platform_optout";
  }>[];
  suppressionList: readonly Readonly<{
    email: string;
    reason: "hard_bounce" | "soft_bounce_strike3" | "complaint" | "manual";
  }>[];
  consents: readonly Readonly<{
    salesforceContactId: string | null;
    email: string | null;
    scopeType: "project" | "newsletter" | "all";
    scopeId: string | null;
    optedOutAt: string;
  }>[];
  creationSource: string;
}>;

export type SubscriptionBackfillBefore = Readonly<{
  contactId?: string | null;
  generalNewsletter?: boolean;
  oregonShoresNewsletter?: boolean;
  projectBoxes?: Partial<Record<SalesforceSubscriptionBox, boolean>>;
  unsubscribedFromAll?: boolean;
  unsubscribedAt?: string | null;
  emailBounced?: boolean;
  creationSource?: null;
}>;

export type SubscriptionBackfillWrite = Readonly<{
  email: string;
  action: "create" | "update";
  salesforceRecordId: string | null;
  change: SubscriptionPreferenceChange;
  before: SubscriptionBackfillBefore;
  reasons: readonly string[];
}>;

export type SubscriptionBackfillSummary = Readonly<{
  recordsInScope: Readonly<{
    contact: number;
    existingOnly: number;
    newsletterOnly: number;
  }>;
  creates: number;
  updates: number;
  unchanged: number;
  fieldChanges: Readonly<{
    generalOn: number;
    generalOff: number;
    boxOn: Readonly<Record<SalesforceSubscriptionBox, number>>;
    boxOff: Readonly<Record<SalesforceSubscriptionBox, number>>;
    unsubscribedFromAll: number;
    bounced: number;
    relinks: number;
  }>;
  quarantinedContactsLeftAlone: number;
  unmatchedConsents: number;
  unknownBoxValues: number;
  sfTickedNotOnPlatform: number;
  existingLinkedNonContactEmails: number;
}>;

export type SubscriptionBackfillPlan = Readonly<{
  writes: readonly SubscriptionBackfillWrite[];
  sfTickedNotOnPlatform: readonly Readonly<{
    email: string;
    salesforceRecordId: string;
    contactId: string | null;
  }>[];
  summary: SubscriptionBackfillSummary;
}>;

type Contact = SubscriptionBackfillInput["contacts"][number];
type Existing = SubscriptionBackfillInput["existing"][number];
type Consent = SubscriptionBackfillInput["consents"][number];

const normalizeEmail = (email: string | null | undefined): string =>
  email?.trim().toLowerCase() ?? "";
const isBox = (value: string): value is SalesforceSubscriptionBox =>
  salesforceSubscriptionBoxValues.includes(value as SalesforceSubscriptionBox);
const blankBoxValues = (): Record<SalesforceSubscriptionBox, number> =>
  Object.fromEntries(salesforceSubscriptionBoxValues.map((box) => [box, 0])) as Record<
    SalesforceSubscriptionBox,
    number
  >;

function earliest(values: readonly string[]): string | null {
  return values.length === 0
    ? null
    : values.reduce((left, right) =>
        new Date(left).getTime() <= new Date(right).getTime() ? left : right,
      );
}

// Salesforce returns "2026-01-01T00:00:00.000+0000" while the platform
// returns "…Z", and Salesforce keeps whole seconds only (the platform keeps
// milliseconds). Compare and write instants truncated to the second.
function toSalesforceSecond(value: string): string {
  const time = new Date(value).getTime();
  return new Date(time - (((time % 1000) + 1000) % 1000)).toISOString();
}

function sameInstant(left: string | null, right: string): boolean {
  return left !== null && toSalesforceSecond(left) === toSalesforceSecond(right);
}

function pushReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

/**
 * Plans the one-off Salesforce preference backfill. It intentionally only
 * emits changes: applying its writes to the supplied existing state and
 * planning again is a no-op.
 */
export function planSubscriptionBackfill(
  input: SubscriptionBackfillInput,
): SubscriptionBackfillPlan {
  const contactsByEmail = new Map<string, Contact>();
  const contactsById = new Map<string, Contact>();
  for (const contact of input.contacts) {
    const email = normalizeEmail(contact.email);
    if (email === "") continue;
    contactsByEmail.set(email, contact);
    contactsById.set(contact.salesforceContactId, contact);
  }

  const boxByProject = new Map<string, SalesforceSubscriptionBox>();
  let unknownBoxValues = 0;
  for (const project of input.projectBoxes) {
    if (isBox(project.box)) boxByProject.set(project.projectId, project.box);
    else unknownBoxValues += 1;
  }
  const hostByProject = new Map<string, string>(
    input.connectedProjects.flatMap((project) =>
      project.connectedToProjectId === null
        ? []
        : [[project.projectId, project.connectedToProjectId]],
    ),
  );
  const boxForProject = (projectId: string | null): SalesforceSubscriptionBox | undefined => {
    if (projectId === null) return undefined;
    return boxByProject.get(projectId) ?? boxByProject.get(hostByProject.get(projectId) ?? "");
  };

  const existingByEmail = new Map<string, Existing>();
  for (const record of input.existing) {
    const email = normalizeEmail(record.email);
    if (email !== "") existingByEmail.set(email, record);
  }
  const subscriberByEmail = new Map<string, string>();
  for (const subscriber of input.newsletterSubscribers) {
    const email = normalizeEmail(subscriber.email);
    if (email !== "") subscriberByEmail.set(email, subscriber.status);
  }
  const newsletterSuppressionByEmail = new Map<string, string>();
  for (const suppression of input.newsletterSuppressions) {
    const email = normalizeEmail(suppression.email);
    if (email !== "") newsletterSuppressionByEmail.set(email, suppression.reason);
  }
  const suppressionByEmail = new Map<string, string>();
  for (const suppression of input.suppressionList) {
    const email = normalizeEmail(suppression.email);
    if (email !== "") suppressionByEmail.set(email, suppression.reason);
  }

  const consentsByEmail = new Map<string, Consent[]>();
  let unmatchedConsents = 0;
  for (const consent of input.consents) {
    const matchingContact =
      consent.salesforceContactId === null
        ? undefined
        : contactsById.get(consent.salesforceContactId);
    const email = matchingContact === undefined
      ? normalizeEmail(consent.email)
      : normalizeEmail(matchingContact.email);
    if (email === "") {
      unmatchedConsents += 1;
      continue;
    }
    const values = consentsByEmail.get(email) ?? [];
    values.push(consent);
    consentsByEmail.set(email, values);
  }

  const membershipBoxesByContact = new Map<string, Set<SalesforceSubscriptionBox>>();
  for (const membership of input.memberships) {
    if (membership.status?.trim().toLocaleLowerCase() === "declined") continue;
    const box = boxForProject(membership.projectId);
    if (box === undefined) continue;
    const boxes = membershipBoxesByContact.get(membership.salesforceContactId) ?? new Set();
    boxes.add(box);
    membershipBoxesByContact.set(membership.salesforceContactId, boxes);
  }

  const scope = new Set<string>([...contactsByEmail.keys(), ...existingByEmail.keys()]);
  for (const [email, status] of subscriberByEmail) {
    const consents = consentsByEmail.get(email) ?? [];
    if (
      !contactsByEmail.has(email) &&
      status === "subscribed" &&
      !newsletterSuppressionByEmail.has(email) &&
      !suppressionByEmail.has(email) &&
      !consents.some((consent) => consent.scopeType === "all" || consent.scopeType === "newsletter")
    ) scope.add(email);
  }

  const fieldChanges = {
    generalOn: 0,
    generalOff: 0,
    boxOn: blankBoxValues(),
    boxOff: blankBoxValues(),
    unsubscribedFromAll: 0,
    bounced: 0,
    relinks: 0,
  };
  const recordsInScope = { contact: 0, existingOnly: 0, newsletterOnly: 0 };
  const writes: SubscriptionBackfillWrite[] = [];
  const sfTickedNotOnPlatform: { email: string; salesforceRecordId: string; contactId: string | null }[] = [];
  let unchanged = 0;
  let quarantinedContactsLeftAlone = 0;
  let existingLinkedNonContactEmails = 0;

  for (const email of [...scope].sort()) {
    const contact = contactsByEmail.get(email);
    const existing = existingByEmail.get(email);
    const subscriberStatus = subscriberByEmail.get(email);
    const newsletterSuppression = newsletterSuppressionByEmail.get(email);
    const suppression = suppressionByEmail.get(email);
    const consents = consentsByEmail.get(email) ?? [];
    const hasNewsletterConsent = consents.some((consent) => consent.scopeType === "newsletter");
    const allConsents = consents.filter((consent) => consent.scopeType === "all");
    const hasAllConsent = allConsents.length > 0;
    const contactAllOptOut = contact?.hasOptedOutOfEmail === true || contact?.doNotContact === true;
    const allBlocked = hasAllConsent || contactAllOptOut || existing?.unsubscribedFromAll === true;
    const projectBlocked = new Set<SalesforceSubscriptionBox>();
    for (const consent of consents) {
      if (consent.scopeType !== "project") continue;
      const box = boxForProject(consent.scopeId);
      if (box !== undefined) projectBlocked.add(box);
    }

    if (contact !== undefined) recordsInScope.contact += 1;
    else if (existing !== undefined) recordsInScope.existingOnly += 1;
    else recordsInScope.newsletterOnly += 1;
    if (existing !== undefined && contact === undefined && existing.contactId !== null)
      existingLinkedNonContactEmails += 1;

    const action = existing === undefined ? "create" : "update";
    const change: Record<string, unknown> = { email };
    const before: Record<string, unknown> = {};
    const reasons: string[] = [];
    if (contact !== undefined) pushReason(reasons, "contact");
    if (contact === undefined && existing === undefined) pushReason(reasons, "newsletter_subscriber");

    const set = (key: string, next: unknown, previous: unknown): void => {
      if (next === previous) return;
      change[key] = next;
      before[key] = previous;
    };
    const setBox = (box: SalesforceSubscriptionBox, next: boolean, previous: boolean): void => {
      if (next === previous) return;
      const boxes = (change.projectBoxes as Record<string, boolean> | undefined) ?? {};
      boxes[box] = next;
      change.projectBoxes = boxes;
      const oldBoxes = (before.projectBoxes as Record<string, boolean> | undefined) ?? {};
      oldBoxes[box] = previous;
      before.projectBoxes = oldBoxes;
      if (next) fieldChanges.boxOn[box] += 1;
      else fieldChanges.boxOff[box] += 1;
    };

    const oldContactId = existing?.contactId ?? null;
    const oldGeneral = existing?.generalNewsletter ?? false;
    const oldOregon = existing?.oregonShoresNewsletter ?? false;
    const oldAll = existing?.unsubscribedFromAll ?? false;
    const oldBounced = existing?.emailBounced ?? false;
    if (contact !== undefined && oldContactId !== contact.salesforceContactId) {
      set("contactId", contact.salesforceContactId, oldContactId);
      if (existing !== undefined) {
        fieldChanges.relinks += 1;
        pushReason(reasons, "relink");
      }
    }
    if (existing === undefined) {
      set("creationSource", input.creationSource, null);
    }

    if ((hasAllConsent || contactAllOptOut) && !oldAll) {
      set("unsubscribedFromAll", true, oldAll);
      fieldChanges.unsubscribedFromAll += 1;
      pushReason(reasons, hasAllConsent ? "unsubscribed_all:consent" : "unsubscribed_all:sf_email_opt_out");
    }
    const earliestAllConsent = earliest(allConsents.map((consent) => consent.optedOutAt));
    if (
      earliestAllConsent !== null &&
      !sameInstant(existing?.unsubscribedAt ?? null, earliestAllConsent)
    ) {
      set(
        "unsubscribedAt",
        toSalesforceSecond(earliestAllConsent),
        existing?.unsubscribedAt ?? null,
      );
    }

    const activeGeneralOptOut =
      newsletterSuppression === "unsubscribed" ||
      newsletterSuppression === "platform_optout" ||
      hasNewsletterConsent ||
      hasAllConsent ||
      contactAllOptOut ||
      suppression === "complaint";
    if (activeGeneralOptOut || allBlocked) {
      if (oldGeneral) {
        set("generalNewsletter", false, oldGeneral);
        fieldChanges.generalOff += 1;
      }
      if (allBlocked) pushReason(reasons, "general_off:unsubscribed_all");
      else if (newsletterSuppression === "unsubscribed") pushReason(reasons, "general_off:mailchimp_unsubscribed");
      else if (newsletterSuppression === "platform_optout") pushReason(reasons, "general_off:platform_optout");
      else if (suppression === "complaint") pushReason(reasons, "general_off:complaint");
      else if (hasNewsletterConsent) pushReason(reasons, "general_off:newsletter_consent");
      else pushReason(reasons, "general_off:sf_email_opt_out");
    } else if (subscriberStatus !== undefined && subscriberStatus !== "subscribed") {
      if (contact !== undefined && subscriberStatus === "quarantined") quarantinedContactsLeftAlone += 1;
    } else if (subscriberStatus === "subscribed" || newsletterSuppression === "cleaned") {
      if (!oldGeneral) {
        set("generalNewsletter", true, oldGeneral);
        fieldChanges.generalOn += 1;
      }
    } else if (existing?.generalNewsletter === true) {
      sfTickedNotOnPlatform.push({ email, salesforceRecordId: existing.salesforceRecordId, contactId: existing.contactId });
    }

    const bounced = suppression === "hard_bounce" || newsletterSuppression === "cleaned";
    if (bounced && !oldBounced) {
      set("emailBounced", true, oldBounced);
      fieldChanges.bounced += 1;
      pushReason(reasons, "bounced");
    }

    for (const box of salesforceSubscriptionBoxValues) {
      const oldBox = existing?.projectBoxes[box] ?? false;
      if (allBlocked || projectBlocked.has(box)) {
        if (oldBox) {
          setBox(box, false, oldBox);
          pushReason(reasons, `box_off:${box}`);
        }
      } else if (contact !== undefined && membershipBoxesByContact.get(contact.salesforceContactId)?.has(box) && !oldBox) {
        setBox(box, true, oldBox);
        pushReason(reasons, `box_on:${box}`);
      }
    }
    if (allBlocked && oldOregon) set("oregonShoresNewsletter", false, oldOregon);

    if (Object.keys(change).length > 1) {
      writes.push({
        email,
        action,
        salesforceRecordId: existing?.salesforceRecordId ?? null,
        change: change as SubscriptionPreferenceChange,
        before: before as SubscriptionBackfillBefore,
        reasons,
      });
    } else {
      unchanged += 1;
    }
  }

  return {
    writes,
    sfTickedNotOnPlatform,
    summary: {
      recordsInScope,
      creates: writes.filter((write) => write.action === "create").length,
      updates: writes.filter((write) => write.action === "update").length,
      unchanged,
      fieldChanges,
      quarantinedContactsLeftAlone,
      unmatchedConsents,
      unknownBoxValues,
      sfTickedNotOnPlatform: sfTickedNotOnPlatform.length,
      existingLinkedNonContactEmails,
    },
  };
}
