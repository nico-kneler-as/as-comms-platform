import {
  intersectSmsAudience,
  type SmsAudienceCandidate,
  type SmsAudienceRecipient,
  type SmsUnreachableReason,
} from "./sms-audience-intersect.js";
import {
  renderSmsBroadcast,
} from "./sms-broadcast-render.js";
import type { ConsentStatus } from "./records.js";
import { DEFAULT_SMS_OPT_OUT_FOOTER } from "./sms-segments.js";

export interface SmsBroadcastAudienceMember {
  readonly contactId: string;
  readonly firstName: string | null;
  readonly email: string | null;
  readonly projectName: string | null;
}

export interface SmsBroadcastLatestConsent {
  readonly status: ConsentStatus;
  readonly phoneE164: string | null;
}

export interface SmsBroadcastFrozenMessage {
  readonly contactId: string;
  readonly phoneE164: string;
  readonly body: string;
  readonly segments: number;
  readonly encoding: "GSM-7" | "Unicode";
}

export type SmsBroadcastDropReason =
  | SmsUnreachableReason
  | "no_contact_match"
  | "ambiguous_match";

export interface SmsBroadcastFreezePlan {
  readonly senderId: string;
  readonly messages: readonly SmsBroadcastFrozenMessage[];
  readonly selectedContacts: number;
  readonly reachable: number;
  readonly deduplicatedByPhone: number;
  readonly frozen: number;
  readonly unreachable: Readonly<Record<SmsBroadcastDropReason, number>>;
}

export interface SmsBroadcastFreezeDeps {
  readonly resolveAudience: () => Promise<readonly SmsBroadcastAudienceMember[]>;
  readonly loadLatestConsentByContactIds: (
    contactIds: readonly string[],
  ) => Promise<ReadonlyMap<string, SmsBroadcastLatestConsent>>;
  readonly resolveActiveSmsSenderId: () => Promise<string>;
  readonly additionalUnreachable?: Partial<Record<SmsBroadcastDropReason, number>>;
  readonly optOutFooter?: string;
}

function buildEmptySmsBroadcastDropCounts(): Record<SmsBroadcastDropReason, number> {
  return {
    no_contact_match: 0,
    ambiguous_match: 0,
    no_consent: 0,
    revoked: 0,
    no_phone: 0,
  };
}

function mergeSmsBroadcastDropCounts(input: {
  readonly intersection: Readonly<Record<SmsUnreachableReason, number>>;
  readonly additional?: Partial<Record<SmsBroadcastDropReason, number>>;
}): Record<SmsBroadcastDropReason, number> {
  const counts = buildEmptySmsBroadcastDropCounts();

  for (const [reason, count] of Object.entries(input.intersection)) {
    counts[reason as SmsUnreachableReason] = count;
  }
  for (const [reason, count] of Object.entries(input.additional ?? {})) {
    counts[reason as SmsBroadcastDropReason] += count;
  }

  return counts;
}

function countSmsBroadcastDrops(
  counts: Partial<Record<SmsBroadcastDropReason, number>> | undefined,
): number {
  return Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0);
}

function dedupeAudienceMembersByContactId(
  members: readonly SmsBroadcastAudienceMember[],
): readonly SmsBroadcastAudienceMember[] {
  const seenContactIds = new Set<string>();
  const deduplicated: SmsBroadcastAudienceMember[] = [];

  for (const member of members) {
    if (seenContactIds.has(member.contactId)) {
      continue;
    }

    seenContactIds.add(member.contactId);
    deduplicated.push(member);
  }

  return deduplicated;
}

function dedupeRecipientsByPhone(
  recipients: readonly SmsAudienceRecipient[],
): readonly SmsAudienceRecipient[] {
  const seenPhones = new Set<string>();
  const deduplicated: SmsAudienceRecipient[] = [];

  for (const recipient of recipients) {
    if (seenPhones.has(recipient.phoneE164)) {
      continue;
    }

    seenPhones.add(recipient.phoneE164);
    deduplicated.push(recipient);
  }

  return deduplicated;
}

export async function planSmsBroadcastFreeze(input: {
  readonly bodyTemplate: string | null;
  readonly deps: SmsBroadcastFreezeDeps;
}): Promise<SmsBroadcastFreezePlan> {
  const bodyTemplate = input.bodyTemplate;

  if (bodyTemplate === null || bodyTemplate.trim() === "") {
    throw new Error("SMS broadcast body is empty");
  }

  const members = await input.deps.resolveAudience();
  const deduplicatedMembers = dedupeAudienceMembersByContactId(members);
  const contactIds = deduplicatedMembers.map((member) => member.contactId);
  const latestConsentByContactId =
    await input.deps.loadLatestConsentByContactIds(contactIds);
  const candidates: SmsAudienceCandidate[] = [];
  const consentStatusByContactId = new Map<string, ConsentStatus | null>();

  for (const member of deduplicatedMembers) {
    const consent = latestConsentByContactId.get(member.contactId);

    consentStatusByContactId.set(member.contactId, consent?.status ?? null);
    candidates.push({
      contactId: member.contactId,
      phoneE164: consent?.status === "opted_in" ? consent.phoneE164 : null,
      firstName: member.firstName,
      email: member.email,
      projectName: member.projectName,
    });
  }

  const intersection = intersectSmsAudience({
    candidates,
    latestConsentByContactId: consentStatusByContactId,
  });
  const unreachable = mergeSmsBroadcastDropCounts(
    input.deps.additionalUnreachable === undefined
      ? {
          intersection: intersection.unreachable,
        }
      : {
          intersection: intersection.unreachable,
          additional: input.deps.additionalUnreachable,
        },
  );
  const deduplicatedRecipients = dedupeRecipientsByPhone(intersection.reachable);
  const senderId = await input.deps.resolveActiveSmsSenderId();
  const optOutFooter =
    input.deps.optOutFooter ?? DEFAULT_SMS_OPT_OUT_FOOTER;
  const messages = deduplicatedRecipients.map((recipient) => {
    const rendered = renderSmsBroadcast({
      template: bodyTemplate,
      context: {
        firstName: recipient.firstName,
        email: recipient.email,
      },
      optOutFooter,
    });

    return {
      contactId: recipient.contactId,
      phoneE164: recipient.phoneE164,
      body: rendered.body,
      segments: rendered.metrics.segments,
      encoding: rendered.metrics.encoding,
    };
  });
  const deduplicatedByPhone =
    intersection.reachable.length - deduplicatedRecipients.length;

  return {
    senderId,
    messages,
    selectedContacts:
      deduplicatedMembers.length +
      countSmsBroadcastDrops(input.deps.additionalUnreachable),
    reachable: intersection.reachableCount,
    deduplicatedByPhone,
    frozen: messages.length,
    unreachable,
  };
}
