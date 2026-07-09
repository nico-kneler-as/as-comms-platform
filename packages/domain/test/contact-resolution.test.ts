import { describe, expect, it, vi } from "vitest";

import {
  formatUnknownPhoneDisplayName,
  resolveContactByPhone,
  resolveContactByPhoneFromIdentities,
  type ContactInsertRecord,
} from "../src/contact-resolution.js";

describe("contact resolution", () => {
  it("formats unknown phone display names", () => {
    expect(formatUnknownPhoneDisplayName("+14065550142")).toBe(
      "Unknown (+1 406 555 0142)",
    );
    expect(formatUnknownPhoneDisplayName("+442071838750")).toBe(
      "Unknown (+442071838750)",
    );
  });

  it("returns an existing contact when the phone already exists", async () => {
    const existing: ContactInsertRecord = {
      id: "contact-existing",
      salesforceContactId: null,
      displayName: "Existing Contact",
      primaryEmail: null,
      primaryPhone: "+14065550142",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const upsert = vi.fn();

    const result = await resolveContactByPhone({
      phoneE164: "+14065550142",
      readContacts: {
        findByPrimaryPhone: vi.fn().mockResolvedValue(existing),
      },
      writeContacts: {
        upsert,
      },
      clock: {
        now: () => new Date("2026-05-03T12:30:00.000Z"),
      },
      idGenerator: () => "unused",
    });

    expect(result).toEqual({
      contact: existing,
      isNewlyCreated: false,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("normalizes loose lookup input before checking for an existing contact", async () => {
    const existing: ContactInsertRecord = {
      id: "contact-existing",
      salesforceContactId: null,
      displayName: "Existing Contact",
      primaryEmail: null,
      primaryPhone: "+17743680124",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const findByPrimaryPhone = vi.fn().mockResolvedValue(existing);

    const result = await resolveContactByPhone({
      phoneE164: "(774) 368-0124",
      readContacts: {
        findByPrimaryPhone,
      },
      writeContacts: {
        upsert: vi.fn(),
      },
      clock: {
        now: () => new Date("2026-05-03T12:30:00.000Z"),
      },
      idGenerator: () => "unused",
    });

    expect(findByPrimaryPhone).toHaveBeenCalledWith("+17743680124");
    expect(result.contact.id).toBe(existing.id);
  });

  it("creates a new phone-only contact when none exists", async () => {
    const upsert = vi
      .fn<(_: ContactInsertRecord) => Promise<ContactInsertRecord>>()
      .mockImplementation((record) => Promise.resolve(record));

    const result = await resolveContactByPhone({
      phoneE164: "+14065550142",
      readContacts: {
        findByPrimaryPhone: vi.fn().mockResolvedValue(null),
      },
      writeContacts: {
        upsert,
      },
      clock: {
        now: () => new Date("2026-05-03T12:30:00.000Z"),
      },
      idGenerator: () => "contact-new",
    });

    expect(upsert).toHaveBeenCalledWith({
      id: "contact-new",
      salesforceContactId: null,
      displayName: "Unknown (+1 406 555 0142)",
      primaryEmail: null,
      primaryPhone: "+14065550142",
      createdAt: "2026-05-03T12:30:00.000Z",
      updatedAt: "2026-05-03T12:30:00.000Z",
    });
    expect(result).toEqual({
      contact: {
        id: "contact-new",
        salesforceContactId: null,
        displayName: "Unknown (+1 406 555 0142)",
        primaryEmail: null,
        primaryPhone: "+14065550142",
        createdAt: "2026-05-03T12:30:00.000Z",
        updatedAt: "2026-05-03T12:30:00.000Z",
      },
      isNewlyCreated: true,
    });
  });

  it("re-queries the contact on a unique race", async () => {
    const raced: ContactInsertRecord = {
      id: "contact-raced",
      salesforceContactId: null,
      displayName: "Unknown (+1 406 555 0142)",
      primaryEmail: null,
      primaryPhone: "+14065550142",
      createdAt: "2026-05-03T12:30:00.000Z",
      updatedAt: "2026-05-03T12:30:00.000Z",
    };
    const findByPrimaryPhone = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    const uniqueViolation = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });

    const result = await resolveContactByPhone({
      phoneE164: "+14065550142",
      readContacts: {
        findByPrimaryPhone,
      },
      writeContacts: {
        upsert: vi.fn().mockRejectedValue(uniqueViolation),
      },
      clock: {
        now: () => new Date("2026-05-03T12:30:00.000Z"),
      },
      idGenerator: () => "contact-new",
    });

    expect(findByPrimaryPhone).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      contact: raced,
      isNewlyCreated: false,
    });
  });

  it("anchors multi-contact phone identity matches to the most recent inbound projection", async () => {
    const older: ContactInsertRecord = {
      id: "contact-a",
      salesforceContactId: null,
      displayName: "Contact A",
      primaryEmail: null,
      primaryPhone: "+14065550142",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const newer: ContactInsertRecord = {
      id: "contact-b",
      salesforceContactId: null,
      displayName: "Contact B",
      primaryEmail: null,
      primaryPhone: "+14065550142",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };

    const result = await resolveContactByPhoneFromIdentities({
      phoneE164: "+14065550142",
      readContactIdentities: {
        listByNormalizedValue: vi.fn().mockResolvedValue([
          { contactId: "contact-a" },
          { contactId: "contact-b" },
          { contactId: "contact-a" },
        ]),
      },
      readContacts: {
        findById: vi.fn(),
        listByIds: vi.fn().mockResolvedValue([older, newer]),
        findByPrimaryPhone: vi.fn(),
      },
      readInboxProjection: {
        findByContactId: vi
          .fn()
          .mockImplementation((contactId: string) =>
            Promise.resolve(
              contactId === "contact-b"
                ? {
                    lastInboundAt: "2026-05-04T08:00:00.000Z",
                    lastActivityAt: "2026-05-04T08:00:00.000Z",
                  }
                : {
                    lastInboundAt: "2026-05-03T08:00:00.000Z",
                    lastActivityAt: "2026-05-03T08:00:00.000Z",
                  },
            ),
          ),
      },
      writeContacts: {
        upsert: vi.fn(),
      },
      writeContactIdentities: {
        upsert: vi.fn(),
      },
      clock: {
        now: () => new Date("2026-05-05T12:30:00.000Z"),
      },
      idGenerator: () => "unused",
    });

    expect(result).toEqual({
      contact: newer,
      isNewlyCreated: false,
      ambiguousCandidateContactIds: ["contact-a", "contact-b"],
    });
  });

  it("falls back to alphabetical contact id for multi-contact phone identity matches without activity", async () => {
    const contactA: ContactInsertRecord = {
      id: "contact-a",
      salesforceContactId: null,
      displayName: "Contact A",
      primaryEmail: null,
      primaryPhone: "+14065550142",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const contactB: ContactInsertRecord = {
      id: "contact-b",
      salesforceContactId: null,
      displayName: "Contact B",
      primaryEmail: null,
      primaryPhone: "+14065550142",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };

    const result = await resolveContactByPhoneFromIdentities({
      phoneE164: "+14065550142",
      readContactIdentities: {
        listByNormalizedValue: vi.fn().mockResolvedValue([
          { contactId: "contact-b" },
          { contactId: "contact-a" },
        ]),
      },
      readContacts: {
        findById: vi.fn(),
        listByIds: vi.fn().mockResolvedValue([contactB, contactA]),
        findByPrimaryPhone: vi.fn(),
      },
      readInboxProjection: {
        findByContactId: vi.fn().mockResolvedValue(null),
      },
      writeContacts: {
        upsert: vi.fn(),
      },
      writeContactIdentities: {
        upsert: vi.fn(),
      },
      clock: {
        now: () => new Date("2026-05-05T12:30:00.000Z"),
      },
      idGenerator: () => "unused",
    });

    expect(result).toEqual({
      contact: contactA,
      isNewlyCreated: false,
      ambiguousCandidateContactIds: ["contact-a", "contact-b"],
    });
  });

  it("normalizes loose phone identity input before querying identities", async () => {
    const existing: ContactInsertRecord = {
      id: "contact-e164",
      salesforceContactId: null,
      displayName: "Contact E164",
      primaryEmail: null,
      primaryPhone: "+19163001877",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const listByNormalizedValue = vi.fn().mockResolvedValue([
      { contactId: existing.id },
    ]);

    const result = await resolveContactByPhoneFromIdentities({
      phoneE164: "9163001877",
      readContactIdentities: {
        listByNormalizedValue,
      },
      readContacts: {
        findById: vi.fn().mockResolvedValue(existing),
        listByIds: vi.fn(),
        findByPrimaryPhone: vi.fn(),
      },
      readInboxProjection: {
        findByContactId: vi.fn(),
      },
      writeContacts: {
        upsert: vi.fn(),
      },
      writeContactIdentities: {
        upsert: vi.fn(),
      },
      clock: {
        now: () => new Date("2026-05-05T12:30:00.000Z"),
      },
      idGenerator: () => "unused",
    });

    expect(listByNormalizedValue).toHaveBeenCalledWith({
      kind: "phone",
      normalizedValue: "+19163001877",
    });
    expect(result.contact.id).toBe(existing.id);
  });

  it("resolves to the consent-anchored contact instead of creating a placeholder", async () => {
    const consentAnchored: ContactInsertRecord = {
      id: "contact:salesforce:003TESTCONSENT",
      salesforceContactId: "003TESTCONSENT",
      displayName: "Jeanette Locher",
      primaryEmail: "jeanette@example.org",
      primaryPhone: null,
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const contactUpsert = vi
      .fn<(_: ContactInsertRecord) => Promise<ContactInsertRecord>>()
      .mockImplementation((record) => Promise.resolve(record));
    const identityUpsert = vi.fn().mockResolvedValue(undefined);

    const result = await resolveContactByPhoneFromIdentities({
      phoneE164: "+12695892009",
      readContactIdentities: {
        listByNormalizedValue: vi.fn().mockResolvedValue([]),
      },
      readContacts: {
        findById: vi.fn().mockResolvedValue(consentAnchored),
        listByIds: vi.fn(),
        findByPrimaryPhone: vi.fn().mockResolvedValue(null),
      },
      readInboxProjection: {
        findByContactId: vi.fn(),
      },
      readConsentRecords: {
        findLatestByPhone: vi
          .fn()
          .mockResolvedValue({ contactId: consentAnchored.id }),
      },
      writeContacts: {
        upsert: contactUpsert,
      },
      writeContactIdentities: {
        upsert: identityUpsert,
      },
      clock: {
        now: () => new Date("2026-07-09T18:00:00.000Z"),
      },
      idGenerator: () => "identity-new",
    });

    expect(result.isNewlyCreated).toBe(false);
    expect(result.contact.id).toBe(consentAnchored.id);
    expect(result.contact.primaryPhone).toBe("+12695892009");
    expect(identityUpsert).toHaveBeenCalledWith({
      id: "identity-new",
      contactId: consentAnchored.id,
      kind: "phone",
      normalizedValue: "+12695892009",
      isPrimary: true,
      source: "system",
      verifiedAt: null,
    });
    expect(contactUpsert).toHaveBeenCalledWith({
      ...consentAnchored,
      primaryPhone: "+12695892009",
      updatedAt: "2026-07-09T18:00:00.000Z",
    });
  });

  it("keeps an existing primary phone when attaching a consent-anchored identity", async () => {
    const consentAnchored: ContactInsertRecord = {
      id: "contact:salesforce:003TESTCONSENT",
      salesforceContactId: "003TESTCONSENT",
      displayName: "Jeanette Locher",
      primaryEmail: null,
      primaryPhone: "+14065550111",
      createdAt: "2026-05-03T12:00:00.000Z",
      updatedAt: "2026-05-03T12:00:00.000Z",
    };
    const contactUpsert = vi.fn();
    const identityUpsert = vi.fn().mockResolvedValue(undefined);

    const result = await resolveContactByPhoneFromIdentities({
      phoneE164: "+12695892009",
      readContactIdentities: {
        listByNormalizedValue: vi.fn().mockResolvedValue([]),
      },
      readContacts: {
        findById: vi.fn().mockResolvedValue(consentAnchored),
        listByIds: vi.fn(),
        findByPrimaryPhone: vi.fn().mockResolvedValue(null),
      },
      readInboxProjection: {
        findByContactId: vi.fn(),
      },
      readConsentRecords: {
        findLatestByPhone: vi
          .fn()
          .mockResolvedValue({ contactId: consentAnchored.id }),
      },
      writeContacts: {
        upsert: contactUpsert,
      },
      writeContactIdentities: {
        upsert: identityUpsert,
      },
      clock: {
        now: () => new Date("2026-07-09T18:00:00.000Z"),
      },
      idGenerator: () => "identity-new",
    });

    expect(result.contact).toEqual(consentAnchored);
    expect(contactUpsert).not.toHaveBeenCalled();
    expect(identityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ isPrimary: false }),
    );
  });

  it("creates a placeholder when the latest consent record has no contact", async () => {
    const contactUpsert = vi
      .fn<(_: ContactInsertRecord) => Promise<ContactInsertRecord>>()
      .mockImplementation((record) => Promise.resolve(record));

    const result = await resolveContactByPhoneFromIdentities({
      phoneE164: "+12695892009",
      readContactIdentities: {
        listByNormalizedValue: vi.fn().mockResolvedValue([]),
      },
      readContacts: {
        findById: vi.fn(),
        listByIds: vi.fn(),
        findByPrimaryPhone: vi.fn().mockResolvedValue(null),
      },
      readInboxProjection: {
        findByContactId: vi.fn(),
      },
      readConsentRecords: {
        findLatestByPhone: vi.fn().mockResolvedValue({ contactId: null }),
      },
      writeContacts: {
        upsert: contactUpsert,
      },
      writeContactIdentities: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      clock: {
        now: () => new Date("2026-07-09T18:00:00.000Z"),
      },
      idGenerator: () => "contact-new",
    });

    expect(result.isNewlyCreated).toBe(true);
    expect(result.contact.displayName).toBe("Unknown (+1 269 589 2009)");
  });

  it("creates a placeholder when the consent-anchored contact no longer exists", async () => {
    const contactUpsert = vi
      .fn<(_: ContactInsertRecord) => Promise<ContactInsertRecord>>()
      .mockImplementation((record) => Promise.resolve(record));

    const result = await resolveContactByPhoneFromIdentities({
      phoneE164: "+12695892009",
      readContactIdentities: {
        listByNormalizedValue: vi.fn().mockResolvedValue([]),
      },
      readContacts: {
        findById: vi.fn().mockResolvedValue(null),
        listByIds: vi.fn(),
        findByPrimaryPhone: vi.fn().mockResolvedValue(null),
      },
      readInboxProjection: {
        findByContactId: vi.fn(),
      },
      readConsentRecords: {
        findLatestByPhone: vi
          .fn()
          .mockResolvedValue({ contactId: "contact-gone" }),
      },
      writeContacts: {
        upsert: contactUpsert,
      },
      writeContactIdentities: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      clock: {
        now: () => new Date("2026-07-09T18:00:00.000Z"),
      },
      idGenerator: () => "contact-new",
    });

    expect(result.isNewlyCreated).toBe(true);
    expect(result.contact.displayName).toBe("Unknown (+1 269 589 2009)");
  });
});
