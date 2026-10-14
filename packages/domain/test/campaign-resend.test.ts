import { describe, expect, it } from "vitest";

import type { AudienceSnapshotRecord } from "@as-comms/contracts";

import { selectResendRecipients } from "../src/campaign-resend.js";

function snapshot(
  id: string,
  deliveryStatus: AudienceSnapshotRecord["deliveryStatus"],
  overrides: Partial<AudienceSnapshotRecord> = {},
): AudienceSnapshotRecord {
  return {
    id,
    campaignRunId: "parent",
    contactId: `contact-${id}`,
    newsletterSubscriberId: null,
    frozenEmail: `${id}@example.org`,
    frozenFirstName: `First ${id}`,
    frozenProjectName: "Forest",
    frozenProjectId: "forest",
    frozenAliasEmail: "forest@example.org",
    unsubscribeToken: `token-${id}`,
    subjectVariant: null,
    deliveryStatus,
    providerMessageId: null,
    sentAt: null,
    deliveredAt: null,
    bouncedAt: null,
    openedAt: null,
    clickedAt: null,
    complainedAt: null,
    unsubscribedAt: null,
    lastEventAt: null,
    createdAt: "2026-10-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("selectResendRecipients", () => {
  it("keeps provider-handed recipients and preserves their frozen data", () => {
    const result = selectResendRecipients({
      parentSnapshots: [snapshot("sent", "sent"), snapshot("delivered", "delivered")],
      openedSnapshotIds: [], clickedSnapshotIds: [],
    });
    expect(result).toEqual([
      expect.objectContaining({ frozenEmail: "sent@example.org", frozenFirstName: "First sent", frozenProjectId: "forest" }),
      expect.objectContaining({ frozenEmail: "delivered@example.org", frozenAliasEmail: "forest@example.org" }),
    ]);
  });

  it("excludes any open, including Apple-style automatic opens, and click-only recipients", () => {
    expect(selectResendRecipients({
      parentSnapshots: [snapshot("apple", "delivered"), snapshot("click", "sent"), snapshot("quiet", "sent")],
      openedSnapshotIds: ["apple"], clickedSnapshotIds: ["click"],
    }).map((member) => member.frozenEmail)).toEqual(["quiet@example.org"]);
  });

  it.each(["pending", "bounced", "failed", "suppressed_at_send", "complained", "unsubscribed"] as const)(
    "excludes %s snapshots", (status) => {
      expect(selectResendRecipients({ parentSnapshots: [snapshot(status, status)], openedSnapshotIds: [], clickedSnapshotIds: [] })).toEqual([]);
    },
  );

  it("de-duplicates legacy duplicate recipients and handles empty inputs", () => {
    expect(selectResendRecipients({ parentSnapshots: [], openedSnapshotIds: [], clickedSnapshotIds: [] })).toEqual([]);
    expect(selectResendRecipients({
      parentSnapshots: [snapshot("one", "sent"), snapshot("two", "delivered", { contactId: "contact-one", frozenEmail: "two@example.org" })],
      openedSnapshotIds: [], clickedSnapshotIds: [],
    }).map((member) => member.frozenEmail)).toEqual(["one@example.org"]);
  });
});
