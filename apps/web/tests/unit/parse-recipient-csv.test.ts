import { describe, expect, it } from "vitest";

import { parseRecipientCsv } from "../../src/lib/parse-recipient-csv";

describe("parseRecipientCsv", () => {
  it("parses valid rows with optional names", () => {
    expect(
      parseRecipientCsv(
        "email,firstName,lastName\nalpha@example.org,Alpha,One\nbravo@example.org,,Two",
      ),
    ).toEqual({
      recipients: [
        {
          email: "alpha@example.org",
          firstName: "Alpha",
          lastName: "One",
        },
        {
          email: "bravo@example.org",
          firstName: null,
          lastName: "Two",
        },
      ],
      importedCount: 2,
      invalidSkippedCount: 0,
      duplicatesRemovedCount: 0,
    });
  });

  it("skips invalid emails and empty rows", () => {
    expect(
      parseRecipientCsv(
        "email,firstName\nvalid@example.org,Valid\n,\nnot-an-email,Bad\n  \n",
      ),
    ).toEqual({
      recipients: [
        {
          email: "valid@example.org",
          firstName: "Valid",
          lastName: null,
        },
      ],
      importedCount: 1,
      invalidSkippedCount: 3,
      duplicatesRemovedCount: 0,
    });
  });

  it("deduplicates emails case-insensitively and keeps the first row", () => {
    expect(
      parseRecipientCsv(
        "email,firstName\nALPHA@example.org,Alpha\nalpha@example.org,Second\nbravo@example.org,Bravo",
      ),
    ).toEqual({
      recipients: [
        {
          email: "alpha@example.org",
          firstName: "Alpha",
          lastName: null,
        },
        {
          email: "bravo@example.org",
          firstName: "Bravo",
          lastName: null,
        },
      ],
      importedCount: 2,
      invalidSkippedCount: 0,
      duplicatesRemovedCount: 1,
    });
  });

  it("supports quoted fields with commas and escaped quotes", () => {
    expect(
      parseRecipientCsv(
        'email,firstName,lastName\n"alpha@example.org","Alpha, ""A""","One, Jr."',
      ),
    ).toEqual({
      recipients: [
        {
          email: "alpha@example.org",
          firstName: 'Alpha, "A"',
          lastName: "One, Jr.",
        },
      ],
      importedCount: 1,
      invalidSkippedCount: 0,
      duplicatesRemovedCount: 0,
    });
  });

  it("handles CRLF line endings and a leading BOM", () => {
    expect(
      parseRecipientCsv(
        "\uFEFFemail,firstName,lastName\r\nalpha@example.org, Alpha , One \r\n",
      ),
    ).toEqual({
      recipients: [
        {
          email: "alpha@example.org",
          firstName: "Alpha",
          lastName: "One",
        },
      ],
      importedCount: 1,
      invalidSkippedCount: 0,
      duplicatesRemovedCount: 0,
    });
  });

  it("throws when the email column is missing", () => {
    expect(() =>
      parseRecipientCsv("firstName,lastName\nAlpha,One"),
    ).toThrow('CSV must include an "email" column.');
  });

  it("throws when the file is empty", () => {
    expect(() => parseRecipientCsv(" \n\r\n ")).toThrow("CSV file is empty.");
  });
});
