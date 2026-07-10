import type { ContactIdentityRecord, ContactRecord } from "@as-comms/contracts";

import { tryNormalizePhoneE164 } from "./phone.js";

export type ContactInsertRecord = ContactRecord;

export interface ContactResolutionInput {
  readonly phoneE164: string;
  readonly readContacts: {
    readonly findByPrimaryPhone: (
      phoneE164: string,
    ) => Promise<ContactRecord | null>;
  };
  readonly writeContacts: {
    readonly upsert: (record: ContactInsertRecord) => Promise<ContactRecord>;
  };
  readonly clock: { readonly now: () => Date };
  readonly idGenerator: () => string;
}

export interface ContactResolutionResult {
  readonly contact: ContactRecord;
  readonly isNewlyCreated: boolean;
}

export class CanonicalContactPhoneAmbiguityError extends Error {
  readonly phoneE164: string;
  readonly candidateContactIds: readonly string[];

  constructor(input: {
    readonly phoneE164: string;
    readonly candidateContactIds: readonly string[];
  }) {
    super("Phone identity matched multiple canonical contacts.");
    this.name = "CanonicalContactPhoneAmbiguityError";
    this.phoneE164 = input.phoneE164;
    this.candidateContactIds = input.candidateContactIds;
  }
}

export interface PhoneIdentityResolutionInput {
  readonly phoneE164: string;
  readonly readContactIdentities: {
    readonly listByNormalizedValue: (input: {
      readonly kind: "phone";
      readonly normalizedValue: string;
    }) => Promise<readonly { readonly contactId: string }[]>;
  };
  readonly readContacts: {
    readonly findById: (id: string) => Promise<ContactRecord | null>;
    readonly listByIds: (ids: readonly string[]) => Promise<readonly ContactRecord[]>;
    readonly findByPrimaryPhone: (
      phoneE164: string,
    ) => Promise<ContactRecord | null>;
  };
  readonly readInboxProjection: {
    readonly findByContactId: (contactId: string) => Promise<{
      readonly lastInboundAt: string | null;
      readonly lastActivityAt: string | null;
    } | null>;
  };
  readonly readConsentRecords?: {
    readonly findLatestByPhone: (
      phoneE164: string,
    ) => Promise<{ readonly contactId: string | null } | null>;
  };
  readonly writeContacts: {
    readonly upsert: (record: ContactInsertRecord) => Promise<ContactRecord>;
  };
  readonly writeContactIdentities: {
    readonly upsert: (record: ContactIdentityRecord) => Promise<unknown>;
  };
  readonly clock: { readonly now: () => Date };
  readonly idGenerator: () => string;
}

export interface PhoneIdentityResolutionResult {
  readonly contact: ContactRecord;
  readonly isNewlyCreated: boolean;
  readonly ambiguousCandidateContactIds: readonly string[];
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (error as { readonly code?: unknown }).code === "23505";
}

export function formatUnknownPhoneDisplayName(phoneE164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phoneE164);

  if (match === null) {
    return `Unknown (${phoneE164})`;
  }

  const area = match[1] ?? "";
  const prefix = match[2] ?? "";
  const line = match[3] ?? "";
  return `Unknown (+1 ${area} ${prefix} ${line})`;
}

export async function resolveContactByPhone(
  input: ContactResolutionInput,
): Promise<ContactResolutionResult> {
  const normalizedPhoneE164 = tryNormalizePhoneE164(input.phoneE164);
  const phoneE164 = normalizedPhoneE164 ?? input.phoneE164;
  const existing = await input.readContacts.findByPrimaryPhone(phoneE164);

  if (existing !== null) {
    return {
      contact: existing,
      isNewlyCreated: false,
    };
  }

  const nowIso = input.clock.now().toISOString();

  try {
    const created = await input.writeContacts.upsert({
      id: input.idGenerator(),
      salesforceContactId: null,
      displayName: formatUnknownPhoneDisplayName(phoneE164),
      primaryEmail: null,
      primaryPhone: phoneE164,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return {
      contact: created,
      isNewlyCreated: true,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const raced = await input.readContacts.findByPrimaryPhone(phoneE164);

    if (raced === null) {
      throw error;
    }

    return {
      contact: raced,
      isNewlyCreated: false,
    };
  }
}

function compareNullableIsoDesc(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right.localeCompare(left);
}

async function resolveConsentAnchoredContact(
  input: Pick<PhoneIdentityResolutionInput, "readConsentRecords" | "readContacts">,
  phoneE164: string,
): Promise<ContactRecord | null> {
  const latestConsent =
    await input.readConsentRecords?.findLatestByPhone(phoneE164);
  const contactId = latestConsent?.contactId ?? null;

  if (contactId === null) {
    return null;
  }

  return input.readContacts.findById(contactId);
}

export async function resolveContactByPhoneFromIdentities(
  input: PhoneIdentityResolutionInput,
): Promise<PhoneIdentityResolutionResult> {
  const normalizedPhoneE164 = tryNormalizePhoneE164(input.phoneE164);
  const phoneE164 = normalizedPhoneE164 ?? input.phoneE164;
  const matchingIdentities =
    await input.readContactIdentities.listByNormalizedValue({
      kind: "phone",
      normalizedValue: phoneE164,
    });
  const candidateContactIds = Array.from(
    new Set(matchingIdentities.map((identity) => identity.contactId)),
  ).sort((left, right) => left.localeCompare(right));

  if (candidateContactIds.length === 0) {
    const nowIso = input.clock.now().toISOString();

    const consentAnchored = await resolveConsentAnchoredContact(
      input,
      phoneE164,
    );

    if (consentAnchored !== null) {
      await input.writeContactIdentities.upsert({
        id: input.idGenerator(),
        contactId: consentAnchored.id,
        kind: "phone",
        normalizedValue: phoneE164,
        isPrimary:
          consentAnchored.primaryPhone === null ||
          consentAnchored.primaryPhone === "",
        source: "system",
        verifiedAt: null,
      });

      let contact = consentAnchored;

      if (contact.primaryPhone === null || contact.primaryPhone === "") {
        contact = await input.writeContacts.upsert({
          ...contact,
          primaryPhone: phoneE164,
          updatedAt: nowIso,
        });
      }

      return {
        contact,
        isNewlyCreated: false,
        ambiguousCandidateContactIds: [],
      };
    }

    const contactId = input.idGenerator();

    try {
      const created = await input.writeContacts.upsert({
        id: contactId,
        salesforceContactId: null,
        displayName: formatUnknownPhoneDisplayName(phoneE164),
        primaryEmail: null,
        primaryPhone: phoneE164,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await input.writeContactIdentities.upsert({
        id: input.idGenerator(),
        contactId: created.id,
        kind: "phone",
        normalizedValue: phoneE164,
        isPrimary: true,
        source: "manual",
        verifiedAt: null,
      });

      return {
        contact: created,
        isNewlyCreated: true,
        ambiguousCandidateContactIds: [],
      };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const raced = await input.readContacts.findByPrimaryPhone(phoneE164);

      if (raced === null) {
        throw error;
      }

      return {
        contact: raced,
        isNewlyCreated: false,
        ambiguousCandidateContactIds: [],
      };
    }
  }

  if (candidateContactIds.length === 1) {
    const [candidateContactId] = candidateContactIds;
    const existing =
      candidateContactId === undefined
        ? null
        : await input.readContacts.findById(candidateContactId);

    if (existing === null) {
      throw new Error("Phone identity matched a missing contact.");
    }

    return {
      contact: existing,
      isNewlyCreated: false,
      ambiguousCandidateContactIds: [],
    };
  }

  const contacts = await input.readContacts.listByIds(candidateContactIds);
  const projections = await Promise.all(
    contacts.map(async (contact) => ({
      contact,
      projection: await input.readInboxProjection.findByContactId(contact.id),
    })),
  );

  const [winner] = projections.sort((left, right) => {
    const inboundComparison = compareNullableIsoDesc(
      left.projection?.lastInboundAt ?? null,
      right.projection?.lastInboundAt ?? null,
    );

    if (inboundComparison !== 0) {
      return inboundComparison;
    }

    const activityComparison = compareNullableIsoDesc(
      left.projection?.lastActivityAt ?? null,
      right.projection?.lastActivityAt ?? null,
    );

    if (activityComparison !== 0) {
      return activityComparison;
    }

    return left.contact.id.localeCompare(right.contact.id);
  });

  if (winner === undefined) {
    throw new Error("Phone identity candidates did not resolve to contacts.");
  }

  return {
    contact: winner.contact,
    isNewlyCreated: false,
    ambiguousCandidateContactIds: candidateContactIds,
  };
}
