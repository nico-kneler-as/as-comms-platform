import { describe, expect, it } from "vitest";

import {
  buildGmailMessageRecord,
  importGmailMboxRecords,
  mapGmailRecord,
} from "../src/index.js";

const mboxText = `From MAILER-DAEMON Fri Jan 03 00:00:00 2026
Date: Fri, 03 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: Historical volunteer reply
Message-ID: <gmail-mbox-1@example.org>

Hello from an exported mailbox.
`;

describe("Stage 1 Gmail .mbox import", () => {
  it("parses .mbox messages into the Gmail provider-close record shape", async () => {
    const records = await importGmailMboxRecords({
      mboxText,
      mboxPath: "/tmp/project-antarctica.mbox",
      capturedMailbox: "project-antarctica@example.org",
      liveAccount: "volunteers@adventurescientists.org",
      projectInboxAliases: ["project-antarctica@example.org"],
      receivedAt: "2026-01-03T00:05:00.000Z",
    });

    expect(records).toEqual([
      expect.objectContaining({
        recordType: "message",
        direction: "inbound",
        subject: "Historical volunteer reply",
        snippetClean: "Hello from an exported mailbox.",
        bodyTextPreview: "Hello from an exported mailbox.",
        capturedMailbox: "project-antarctica@example.org",
        projectInboxAlias: "project-antarctica@example.org",
        normalizedParticipantEmails: ["volunteer@example.org"],
        crossProviderCollapseKey: "rfc822:<gmail-mbox-1@example.org>",
      }),
    ]);
  });

  it("converges with live Gmail API records through the same downstream mapper contract", async () => {
    const historicalRecord = (
      await importGmailMboxRecords({
        mboxText,
        mboxPath: "/tmp/project-antarctica.mbox",
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:05:00.000Z",
      })
    )[0];

    expect(historicalRecord).toBeDefined();
    if (historicalRecord === undefined) {
      throw new Error(
        "Expected a historical Gmail record from the .mbox import.",
      );
    }

    const liveRecord = buildGmailMessageRecord({
      recordId: "gmail-live-1",
      threadId: "thread-live-1",
      snippet: "Hello from an exported mailbox.",
      internalDate: "2026-01-03T00:00:00.000Z",
      headers: {
        Date: "Fri, 03 Jan 2026 00:00:00 +0000",
        From: "Volunteer <volunteer@example.org>",
        To: "Project Antarctica <project-antarctica@example.org>",
        "Message-ID": "<gmail-mbox-1@example.org>",
      },
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-live-1",
      checksum: "checksum-live-1",
      capturedMailbox: "volunteers@adventurescientists.org",
      receivedAt: "2026-01-03T00:05:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "project-antarctica@example.org",
      ],
      projectInboxAliases: ["project-antarctica@example.org"],
    });

    const historicalResult = mapGmailRecord(historicalRecord);
    const liveResult = mapGmailRecord(liveRecord);

    expect(historicalResult.outcome).toBe("command");
    expect(liveResult.outcome).toBe("command");
    if (
      historicalResult.outcome === "command" &&
      liveResult.outcome === "command"
    ) {
      expect(historicalResult.command.kind).toBe("canonical_event");
      expect(liveResult.command.kind).toBe("canonical_event");

      if (
        historicalResult.command.kind === "canonical_event" &&
        liveResult.command.kind === "canonical_event"
      ) {
        expect(historicalResult.command.input.canonicalEvent.eventType).toBe(
          "communication.email.inbound",
        );
        expect(liveResult.command.input.canonicalEvent.eventType).toBe(
          historicalResult.command.input.canonicalEvent.eventType,
        );
        expect(liveResult.command.input.canonicalEvent.idempotencyKey).toBe(
          historicalResult.command.input.canonicalEvent.idempotencyKey,
        );
        expect(liveResult.command.input.identity.normalizedEmails).toEqual(
          historicalResult.command.input.identity.normalizedEmails,
        );
      }
    }
  });

  it("imports blank-subject mbox messages without throwing and normalizes subject to null", async () => {
    const records = await importGmailMboxRecords({
      mboxText: `From MAILER-DAEMON Fri Jan 03 00:00:00 2026
Date: Fri, 03 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Message-ID: <gmail-mbox-blank-subject@example.org>

Hello from an exported mailbox.
`,
      mboxPath: "/tmp/project-antarctica-blank-subject.mbox",
      capturedMailbox: "project-antarctica@example.org",
      liveAccount: "volunteers@adventurescientists.org",
      projectInboxAliases: ["project-antarctica@example.org"],
      receivedAt: "2026-01-03T00:05:00.000Z",
    });

    expect(records).toEqual([
      expect.objectContaining({
        recordType: "message",
        subject: null,
      }),
    ]);
  });

  it("keeps From, To, and Cc headers for display while excluding Adventure Scientists recipients from contact matching", () => {
    const record = buildGmailMessageRecord({
      recordId: "gmail-third-party-1",
      threadId: "thread-third-party-1",
      snippet: "Looping in Samantha on this thread.",
      internalDate: "2026-04-22T00:00:00.000Z",
      headers: {
        Date: "Wed, 22 Apr 2026 00:00:00 +0000",
        From: "PNW Project <pnwbio@adventurescientists.org>",
        To: "Shaina Dotson <shaina.dotson@gmail.com>",
        Cc: [
          "Ricky Jones <ricky@adventurescientists.org>",
          "Samantha Doe <samantha@adventurescientists.org>",
          "Outside Partner <partner@example.org>",
        ].join(", "),
        Subject: "Re: Update on Hex 43191",
        "Message-ID": "<gmail-third-party-1@example.org>",
      },
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-third-party-1",
      checksum: "checksum-third-party-1",
      capturedMailbox: "volunteers@adventurescientists.org",
      receivedAt: "2026-04-22T00:01:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ],
      projectInboxAliases: ["pnwbio@adventurescientists.org"],
    });

    expect(record).toMatchObject({
      recordType: "message",
      fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
      toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
      ccHeader: [
        "Ricky Jones <ricky@adventurescientists.org>",
        "Samantha Doe <samantha@adventurescientists.org>",
        "Outside Partner <partner@example.org>",
      ].join(", "),
      normalizedParticipantEmails: ["shaina.dotson@gmail.com"],
    });
  });

  it("uses the external sender as identity evidence for inbound mail with external cc recipients", () => {
    const record = buildGmailMessageRecord({
      recordId: "gmail-inbound-with-external-cc-1",
      threadId: "thread-inbound-with-external-cc-1",
      snippet: "Chris is writing from Kirsten's email account.",
      internalDate: "2026-05-07T02:53:27.000Z",
      headers: {
        Date: "Wed, 6 May 2026 19:53:27 -0700",
        From: "Kirsten Wert <kirsten.wert@gmail.com>",
        To: "PNW Forest Biodiversity <pnwbio@adventurescientists.org>",
        Cc: "Christopher McCafferty <christopher.e.mccafferty@gmail.com>",
        Subject: "Re: Hex 11142 (Date Pending)",
        "Message-ID": "<gmail-inbound-with-external-cc-1@example.org>",
      },
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-inbound-with-external-cc-1",
      checksum: "checksum-inbound-with-external-cc-1",
      capturedMailbox: "volunteers@adventurescientists.org",
      receivedAt: "2026-05-07T02:54:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ],
      projectInboxAliases: ["pnwbio@adventurescientists.org"],
    });

    expect(record).toMatchObject({
      recordType: "message",
      direction: "inbound",
      normalizedParticipantEmails: ["kirsten.wert@gmail.com"],
    });
  });

  it("treats team-originated messages copied to a project inbox as inbound attention", () => {
    const copiedRecord = buildGmailMessageRecord({
      recordId: "gmail-team-copy-1",
      threadId: "thread-team-copy-1",
      snippet: "Scotty looped the project inbox into the volunteer thread.",
      internalDate: "2026-04-22T00:00:00.000Z",
      headers: {
        Date: "Wed, 22 Apr 2026 00:00:00 +0000",
        From: "Scotty <scotty@adventurescientists.org>",
        To: "Shaina Dotson <shaina.dotson@gmail.com>",
        Cc: "PNW Biodiversity <pnwbio@adventurescientists.org>",
        Subject: "Re: Update on Hex 43191",
        "Message-ID": "<gmail-team-copy-1@example.org>",
      },
      payloadRef:
        "gmail://pnwbio@adventurescientists.org/messages/gmail-team-copy-1",
      checksum: "checksum-team-copy-1",
      capturedMailbox: "pnwbio@adventurescientists.org",
      receivedAt: "2026-04-22T00:01:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ],
      projectInboxAliases: ["pnwbio@adventurescientists.org"],
    });
    const platformSentRecord = buildGmailMessageRecord({
      recordId: "gmail-platform-sent-1",
      threadId: "thread-platform-sent-1",
      snippet: "The platform sent from the project inbox.",
      internalDate: "2026-04-22T00:02:00.000Z",
      headers: {
        Date: "Wed, 22 Apr 2026 00:02:00 +0000",
        From: "PNW Biodiversity <pnwbio@adventurescientists.org>",
        To: "Shaina Dotson <shaina.dotson@gmail.com>",
        Subject: "Re: Update on Hex 43191",
        "Message-ID": "<gmail-platform-sent-1@example.org>",
      },
      payloadRef:
        "gmail://pnwbio@adventurescientists.org/messages/gmail-platform-sent-1",
      checksum: "checksum-platform-sent-1",
      capturedMailbox: "pnwbio@adventurescientists.org",
      receivedAt: "2026-04-22T00:03:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ],
      projectInboxAliases: ["pnwbio@adventurescientists.org"],
    });
    const hiddenMailboxCopyRecord = buildGmailMessageRecord({
      recordId: "gmail-hidden-mailbox-copy-1",
      threadId: "thread-hidden-mailbox-copy-1",
      snippet: "Scotty emailed the volunteer and the monitored mailbox received a copy.",
      internalDate: "2026-04-22T00:04:00.000Z",
      headers: {
        Date: "Wed, 22 Apr 2026 00:04:00 +0000",
        From: "Scotty <scotty@adventurescientists.org>",
        To: "Shaina Dotson <shaina.dotson@gmail.com>",
        Subject: "Re: Update on Hex 43191",
        "Message-ID": "<gmail-hidden-mailbox-copy-1@example.org>",
      },
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-hidden-mailbox-copy-1",
      checksum: "checksum-hidden-mailbox-copy-1",
      capturedMailbox: "volunteers@adventurescientists.org",
      receivedAt: "2026-04-22T00:05:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ],
      projectInboxAliases: ["pnwbio@adventurescientists.org"],
    });

    expect(copiedRecord).toMatchObject({
      recordType: "message",
      direction: "inbound",
      fromHeader: "Scotty <scotty@adventurescientists.org>",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    expect(platformSentRecord).toMatchObject({
      recordType: "message",
      direction: "outbound",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    expect(hiddenMailboxCopyRecord).toMatchObject({
      recordType: "message",
      direction: "inbound",
      normalizedParticipantEmails: ["shaina.dotson@gmail.com"],
    });
  });

  it("keeps staff-originated monitored-mailbox messages inbox-visible without external participants", () => {
    const adminRecord = buildGmailMessageRecord({
      recordId: "gmail-admin-notice-1",
      threadId: "thread-admin-notice-1",
      snippet: "Kirsten claimed Hex 11142.",
      internalDate: "2026-05-07T02:26:39.000Z",
      headers: {
        Date: "Thu, 7 May 2026 02:26:39 +0000",
        From: "Admin <admin@adventurescientists.org>",
        To: "PNW Biodiversity <pnwbio@adventurescientists.org>",
        Subject: "Hex Claimed - Required Further Coordination",
        "Message-ID": "<gmail-admin-notice-1@example.org>",
      },
      payloadRef:
        "gmail://volunteers@adventurescientists.org/messages/gmail-admin-notice-1",
      checksum: "checksum-admin-notice-1",
      capturedMailbox: "volunteers@adventurescientists.org",
      receivedAt: "2026-05-07T02:27:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ],
      projectInboxAliases: ["pnwbio@adventurescientists.org"],
    });

    expect(adminRecord).toMatchObject({
      recordType: "message",
      direction: "inbound",
      projectInboxAlias: "pnwbio@adventurescientists.org",
      normalizedParticipantEmails: ["admin@adventurescientists.org"],
    });

    const mapped = mapGmailRecord(adminRecord);

    expect(mapped.outcome).toBe("command");
    if (mapped.outcome === "command") {
      expect(mapped.command.kind).toBe("canonical_event");
      if (mapped.command.kind === "canonical_event") {
        expect(mapped.command.input.canonicalEvent.eventType).toBe(
          "communication.email.inbound",
        );
        expect(mapped.command.input.identity.normalizedEmails).toEqual([
          "admin@adventurescientists.org",
        ]);
      }
    }
  });

  it("does not turn platform-originated internal mail into unread inbox work", () => {
    const platformInternalRecord = buildGmailMessageRecord({
      recordId: "gmail-platform-internal-1",
      threadId: "thread-platform-internal-1",
      snippet: "Internal copy from the shared mailbox.",
      internalDate: "2026-05-07T02:30:00.000Z",
      headers: {
        Date: "Thu, 7 May 2026 02:30:00 +0000",
        From: "PNW Biodiversity <pnwbio@adventurescientists.org>",
        To: "Admin <admin@adventurescientists.org>",
        Subject: "Internal copy",
        "Message-ID": "<gmail-platform-internal-1@example.org>",
      },
      payloadRef:
        "gmail://pnwbio@adventurescientists.org/messages/gmail-platform-internal-1",
      checksum: "checksum-platform-internal-1",
      capturedMailbox: "pnwbio@adventurescientists.org",
      receivedAt: "2026-05-07T02:31:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ],
      projectInboxAliases: ["pnwbio@adventurescientists.org"],
    });

    expect(platformInternalRecord).toEqual({
      recordType: "internal_only_message",
      recordId: "gmail-platform-internal-1",
    });
  });

  it("decodes RFC 2047 subjects during mbox import", async () => {
    const cases = [
      {
        name: "quoted-printable",
        subjectHeader: "=?utf-8?Q?Re:_Training_=3D_=E2=9C=85?=",
        expectedSubject: "Re: Training = ✅",
      },
      {
        name: "base64",
        subjectHeader: "=?utf-8?B?UmU6IEludml0YXRpb24=?=",
        expectedSubject: "Re: Invitation",
      },
      {
        name: "chained-words",
        subjectHeader: "=?utf-8?Q?Hi?= =?utf-8?Q?_world?=",
        expectedSubject: "Hi world",
      },
      {
        name: "mixed-charsets",
        subjectHeader:
          "=?iso-8859-1?Q?Ol=E1?= =?windows-1252?Q?_price_=80100?=",
        expectedSubject: "Olá price €100",
      },
      {
        name: "unknown-charset-fallback",
        subjectHeader: "=?x-unknown?Q?Re:_caf=C3=A9?=",
        expectedSubject: "Re: café",
      },
    ] as const;

    for (const testCase of cases) {
      const records = await importGmailMboxRecords({
        mboxText: `From MAILER-DAEMON Fri Jan 03 00:00:00 2026
Date: Fri, 03 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: ${testCase.subjectHeader}
Message-ID: <gmail-mbox-${testCase.name}@example.org>

`,
        mboxPath: `/tmp/project-antarctica-${testCase.name}.mbox`,
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:05:00.000Z",
      });

      expect(records).toEqual([
        expect.objectContaining({
          recordType: "message",
          subject: testCase.expectedSubject,
          snippet: testCase.expectedSubject,
          snippetClean: testCase.expectedSubject,
        }),
      ]);
    }
  });

  it("uses Message-ID to keep mbox record ids stable across captured mailbox changes", async () => {
    const firstRecord = (
      await importGmailMboxRecords({
        mboxText,
        mboxPath: "/tmp/project-antarctica-a.mbox",
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:05:00.000Z",
      })
    )[0];
    const secondRecord = (
      await importGmailMboxRecords({
        mboxText,
        mboxPath: "/tmp/project-antarctica-b.mbox",
        capturedMailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:06:00.000Z",
      })
    )[0];

    expect(firstRecord).toMatchObject({
      recordType: "message",
    });
    expect(secondRecord).toMatchObject({
      recordType: "message",
    });

    if (
      firstRecord?.recordType !== "message" ||
      secondRecord?.recordType !== "message" ||
      !("checksum" in firstRecord) ||
      !("checksum" in secondRecord)
    ) {
      throw new Error("Expected imported Gmail .mbox records to be messages.");
    }

    expect(firstRecord.recordId).toBe(secondRecord.recordId);
    expect(firstRecord.checksum).toBe(secondRecord.checksum);
  });

  it("falls back to content hashing when Message-ID is absent", async () => {
    const firstRecord = (
      await importGmailMboxRecords({
        mboxText: `From MAILER-DAEMON Fri Jan 03 00:00:00 2026
Date: Fri, 03 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: Historical volunteer reply

Hello from an exported mailbox.
`,
        mboxPath: "/tmp/project-antarctica-no-id-a.mbox",
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:05:00.000Z",
      })
    )[0];
    const secondRecord = (
      await importGmailMboxRecords({
        mboxText: `From MAILER-DAEMON Fri Jan 03 00:00:00 2026
Date: Fri, 03 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: Historical volunteer reply

Hello from a different exported mailbox body.
`,
        mboxPath: "/tmp/project-antarctica-no-id-b.mbox",
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        receivedAt: "2026-01-03T00:06:00.000Z",
      })
    )[0];

    expect(firstRecord).toMatchObject({
      recordType: "message",
    });
    expect(secondRecord).toMatchObject({
      recordType: "message",
    });

    if (
      firstRecord?.recordType !== "message" ||
      secondRecord?.recordType !== "message" ||
      !("checksum" in firstRecord) ||
      !("checksum" in secondRecord)
    ) {
      throw new Error("Expected imported Gmail .mbox records to be messages.");
    }

    expect(firstRecord.recordId).not.toBe(secondRecord.recordId);
    expect(firstRecord.checksum).not.toBe(secondRecord.checksum);
  });

  it("normalizes missing or blank subjects to null while preserving non-empty and decoded live subjects", () => {
    const cases = [
      {
        name: "missing subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          "Message-ID": "<gmail-live-missing@example.org>",
        },
        expectedSubject: null,
      },
      {
        name: "empty subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "",
          "Message-ID": "<gmail-live-empty@example.org>",
        },
        expectedSubject: null,
      },
      {
        name: "whitespace-only subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "   ",
          "Message-ID": "<gmail-live-whitespace@example.org>",
        },
        expectedSubject: null,
      },
      {
        name: "normal subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "Status update",
          "Message-ID": "<gmail-live-normal@example.org>",
        },
        expectedSubject: "Status update",
      },
      {
        name: "quoted-printable",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?utf-8?Q?Re:_Training_=3D_=E2=9C=85?=",
          "Message-ID": "<gmail-live-qp@example.org>",
        },
        expectedSubject: "Re: Training = ✅",
      },
      {
        name: "base64",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?utf-8?B?UmU6IEludml0YXRpb24=?=",
          "Message-ID": "<gmail-live-b64@example.org>",
        },
        expectedSubject: "Re: Invitation",
      },
      {
        name: "chained-words",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?utf-8?Q?Hi?= =?utf-8?Q?_world?=",
          "Message-ID": "<gmail-live-chained@example.org>",
        },
        expectedSubject: "Hi world",
      },
      {
        name: "mixed-charsets",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?iso-8859-1?Q?Ol=E1?= =?windows-1252?Q?_price_=80100?=",
          "Message-ID": "<gmail-live-mixed@example.org>",
        },
        expectedSubject: "Olá price €100",
      },
      {
        name: "unknown-charset-fallback",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?x-unknown?Q?Re:_caf=C3=A9?=",
          "Message-ID": "<gmail-live-unknown@example.org>",
        },
        expectedSubject: "Re: café",
      },
    ] as const;

    for (const testCase of cases) {
      const record = buildGmailMessageRecord({
        recordId: testCase.name,
        threadId: "thread-live-subject",
        snippet: "Follow-up from the project inbox",
        internalDate: "2026-01-03T00:00:00.000Z",
        headers: testCase.headers,
        payloadRef: `gmail://volunteers@adventurescientists.org/messages/${encodeURIComponent(
          testCase.name,
        )}`,
        checksum: `checksum:${testCase.name}`,
        capturedMailbox: "volunteers@adventurescientists.org",
        receivedAt: "2026-01-03T00:05:00.000Z",
        internalAddresses: [
          "volunteers@adventurescientists.org",
          "project-antarctica@example.org",
        ],
        projectInboxAliases: ["project-antarctica@example.org"],
      });

      expect(record).toMatchObject({
        recordType: "message",
        subject: testCase.expectedSubject,
      });
    }
  });
});
