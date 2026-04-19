import { describe, expect, it } from "vitest";

import {
  buildGmailMessageRecord,
  importGmailMboxRecords,
  mapGmailRecord
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
      receivedAt: "2026-01-03T00:05:00.000Z"
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
        crossProviderCollapseKey: "rfc822:<gmail-mbox-1@example.org>"
      })
    ]);
  });

  it("converges with live Gmail API records through the same downstream mapper contract", async () => {
    const historicalRecord = (await importGmailMboxRecords({
      mboxText,
      mboxPath: "/tmp/project-antarctica.mbox",
      capturedMailbox: "project-antarctica@example.org",
      liveAccount: "volunteers@adventurescientists.org",
      projectInboxAliases: ["project-antarctica@example.org"],
      receivedAt: "2026-01-03T00:05:00.000Z"
    }))[0];

    expect(historicalRecord).toBeDefined();
    if (historicalRecord === undefined) {
      throw new Error("Expected a historical Gmail record from the .mbox import.");
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
        "Message-ID": "<gmail-mbox-1@example.org>"
      },
      payloadRef: "gmail://volunteers@adventurescientists.org/messages/gmail-live-1",
      checksum: "checksum-live-1",
      capturedMailbox: "volunteers@adventurescientists.org",
      receivedAt: "2026-01-03T00:05:00.000Z",
      internalAddresses: [
        "volunteers@adventurescientists.org",
        "project-antarctica@example.org"
      ],
      projectInboxAliases: ["project-antarctica@example.org"]
    });

    const historicalResult = mapGmailRecord(historicalRecord);
    const liveResult = mapGmailRecord(liveRecord);

    expect(historicalResult.outcome).toBe("command");
    expect(liveResult.outcome).toBe("command");
    if (historicalResult.outcome === "command" && liveResult.outcome === "command") {
      expect(historicalResult.command.kind).toBe("canonical_event");
      expect(liveResult.command.kind).toBe("canonical_event");

      if (
        historicalResult.command.kind === "canonical_event" &&
        liveResult.command.kind === "canonical_event"
      ) {
        expect(historicalResult.command.input.canonicalEvent.eventType).toBe(
          "communication.email.inbound"
        );
        expect(liveResult.command.input.canonicalEvent.eventType).toBe(
          historicalResult.command.input.canonicalEvent.eventType
        );
        expect(liveResult.command.input.canonicalEvent.idempotencyKey).toBe(
          historicalResult.command.input.canonicalEvent.idempotencyKey
        );
        expect(liveResult.command.input.identity.normalizedEmails).toEqual(
          historicalResult.command.input.identity.normalizedEmails
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
      receivedAt: "2026-01-03T00:05:00.000Z"
    });

    expect(records).toEqual([
      expect.objectContaining({
        recordType: "message",
        subject: null
      })
    ]);
  });

  it("decodes RFC 2047 subjects during mbox import", async () => {
    const cases = [
      {
        name: "quoted-printable",
        subjectHeader: "=?utf-8?Q?Re:_Training_=3D_=E2=9C=85?=",
        expectedSubject: "Re: Training = ✅"
      },
      {
        name: "base64",
        subjectHeader: "=?utf-8?B?UmU6IEludml0YXRpb24=?=",
        expectedSubject: "Re: Invitation"
      },
      {
        name: "chained-words",
        subjectHeader: "=?utf-8?Q?Hi?= =?utf-8?Q?_world?=",
        expectedSubject: "Hi world"
      },
      {
        name: "mixed-charsets",
        subjectHeader:
          "=?iso-8859-1?Q?Ol=E1?= =?windows-1252?Q?_price_=80100?=",
        expectedSubject: "Olá price €100"
      },
      {
        name: "unknown-charset-fallback",
        subjectHeader: "=?x-unknown?Q?Re:_caf=C3=A9?=",
        expectedSubject: "Re: café"
      }
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
        receivedAt: "2026-01-03T00:05:00.000Z"
      });

      expect(records).toEqual([
        expect.objectContaining({
          recordType: "message",
          subject: testCase.expectedSubject,
          snippet: testCase.expectedSubject,
          snippetClean: testCase.expectedSubject
        })
      ]);
    }
  });

  it("normalizes missing or blank subjects to null while preserving non-empty and decoded live subjects", () => {
    const cases = [
      {
        name: "missing subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          "Message-ID": "<gmail-live-missing@example.org>"
        },
        expectedSubject: null
      },
      {
        name: "empty subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "",
          "Message-ID": "<gmail-live-empty@example.org>"
        },
        expectedSubject: null
      },
      {
        name: "whitespace-only subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "   ",
          "Message-ID": "<gmail-live-whitespace@example.org>"
        },
        expectedSubject: null
      },
      {
        name: "normal subject",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "Status update",
          "Message-ID": "<gmail-live-normal@example.org>"
        },
        expectedSubject: "Status update"
      },
      {
        name: "quoted-printable",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?utf-8?Q?Re:_Training_=3D_=E2=9C=85?=",
          "Message-ID": "<gmail-live-qp@example.org>"
        },
        expectedSubject: "Re: Training = ✅"
      },
      {
        name: "base64",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?utf-8?B?UmU6IEludml0YXRpb24=?=",
          "Message-ID": "<gmail-live-b64@example.org>"
        },
        expectedSubject: "Re: Invitation"
      },
      {
        name: "chained-words",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?utf-8?Q?Hi?= =?utf-8?Q?_world?=",
          "Message-ID": "<gmail-live-chained@example.org>"
        },
        expectedSubject: "Hi world"
      },
      {
        name: "mixed-charsets",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject:
            "=?iso-8859-1?Q?Ol=E1?= =?windows-1252?Q?_price_=80100?=",
          "Message-ID": "<gmail-live-mixed@example.org>"
        },
        expectedSubject: "Olá price €100"
      },
      {
        name: "unknown-charset-fallback",
        headers: {
          Date: "Fri, 03 Jan 2026 00:00:00 +0000",
          From: "Project Antarctica <project-antarctica@example.org>",
          To: "Volunteer <volunteer@example.org>",
          Subject: "=?x-unknown?Q?Re:_caf=C3=A9?=",
          "Message-ID": "<gmail-live-unknown@example.org>"
        },
        expectedSubject: "Re: café"
      }
    ] as const;

    for (const testCase of cases) {
      const record = buildGmailMessageRecord({
        recordId: testCase.name,
        threadId: "thread-live-subject",
        snippet: "Follow-up from the project inbox",
        internalDate: "2026-01-03T00:00:00.000Z",
        headers: testCase.headers,
        payloadRef: `gmail://volunteers@adventurescientists.org/messages/${encodeURIComponent(
          testCase.name
        )}`,
        checksum: `checksum:${testCase.name}`,
        capturedMailbox: "volunteers@adventurescientists.org",
        receivedAt: "2026-01-03T00:05:00.000Z",
        internalAddresses: [
          "volunteers@adventurescientists.org",
          "project-antarctica@example.org"
        ],
        projectInboxAliases: ["project-antarctica@example.org"]
      });

      expect(record).toMatchObject({
        recordType: "message",
        subject: testCase.expectedSubject
      });
    }
  });
});
