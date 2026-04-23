export interface InboxRecencyFixtureRow {
  readonly contactId: string;
  readonly displayName: string;
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
}

export const inboxRecencyFixture: readonly InboxRecencyFixtureRow[] = [
  {
    contactId: "contact:inbound-latest",
    displayName: "Inbound Latest",
    lastInboundAt: "2026-04-15T16:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: "2026-04-15T16:00:00.000Z",
  },
  {
    contactId: "contact:inbound-with-newer-outbound",
    displayName: "Inbound With Newer Outbound",
    lastInboundAt: "2026-04-15T15:00:00.000Z",
    lastOutboundAt: "2026-04-15T19:00:00.000Z",
    lastActivityAt: "2026-04-15T19:00:00.000Z",
  },
  {
    contactId: "contact:inbound-same-older-activity",
    displayName: "Inbound Same Older Activity",
    lastInboundAt: "2026-04-15T15:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: "2026-04-15T15:00:00.000Z",
  },
  {
    contactId: "contact:inbound-older",
    displayName: "Inbound Older",
    lastInboundAt: "2026-04-15T14:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: "2026-04-15T14:00:00.000Z",
  },
  {
    contactId: "contact:outbound-only-recent",
    displayName: "Outbound Only Recent",
    lastInboundAt: null,
    lastOutboundAt: "2026-04-15T20:00:00.000Z",
    lastActivityAt: "2026-04-15T20:00:00.000Z",
  },
  {
    contactId: "contact:outbound-only-older",
    displayName: "Outbound Only Older",
    lastInboundAt: null,
    lastOutboundAt: "2026-04-15T18:30:00.000Z",
    lastActivityAt: "2026-04-15T18:30:00.000Z",
  },
];

export const inboxRecencyExpectedOrder: readonly string[] =
  inboxRecencyFixture.map((row) => row.contactId);

export const inboxSentExpectedOrder: readonly string[] = [
  "contact:outbound-only-recent",
  "contact:inbound-with-newer-outbound",
  "contact:outbound-only-older",
];
