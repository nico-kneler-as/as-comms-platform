import { describe, expect, it, vi } from "vitest";

import {
  formatUnknownPhoneDisplayName,
  resolveContactByPhone,
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
});
