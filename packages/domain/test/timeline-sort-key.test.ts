import { canonicalEventTypeValues } from "@as-comms/contracts";

import { describe, expect, it } from "vitest";

import { buildTimelineSortKey } from "../src/normalization.js";

const [
  communicationEmailInboundEventType,
  ,
  ,
  ,
  ,
  ,
  lifecycleSignedUpEventType,
  lifecycleReceivedTrainingEventType,
  lifecycleCompletedTrainingEventType,
] = canonicalEventTypeValues;

describe("buildTimelineSortKey", () => {
  it("orders same-day lifecycle events by canonical lifecycle order", () => {
    const occurredAt = "2025-11-17T00:00:00.000Z";
    const rows = [
      {
        canonicalEventId: "evt:received-training",
        sortKey: buildTimelineSortKey(
          "evt:received-training",
          occurredAt,
          lifecycleReceivedTrainingEventType,
        ),
      },
      {
        canonicalEventId: "evt:signed-up",
        sortKey: buildTimelineSortKey(
          "evt:signed-up",
          occurredAt,
          lifecycleSignedUpEventType,
        ),
      },
    ];

    const orderedIds = rows
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .map((row) => row.canonicalEventId);

    expect(orderedIds).toEqual(["evt:signed-up", "evt:received-training"]);
  });

  it("orders multiple same-day lifecycle events by the locked lifecycle sequence", () => {
    const rows = [
      {
        canonicalEventId: "evt:completed-training",
        sortKey: buildTimelineSortKey(
          "evt:completed-training",
          "2025-11-17T08:30:00.000Z",
          lifecycleCompletedTrainingEventType,
        ),
      },
      {
        canonicalEventId: "evt:signed-up",
        sortKey: buildTimelineSortKey(
          "evt:signed-up",
          "2025-11-17T18:45:00.000Z",
          lifecycleSignedUpEventType,
        ),
      },
      {
        canonicalEventId: "evt:received-training",
        sortKey: buildTimelineSortKey(
          "evt:received-training",
          "2025-11-17T23:00:00.000Z",
          lifecycleReceivedTrainingEventType,
        ),
      },
    ];

    const orderedIds = rows
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .map((row) => row.canonicalEventId);

    expect(orderedIds).toEqual([
      "evt:signed-up",
      "evt:received-training",
      "evt:completed-training",
    ]);
  });

  it("preserves non-lifecycle ordering by occurredAt then canonicalEventId", () => {
    const occurredAt = "2025-11-17T00:00:00.000Z";
    const rows = [
      buildTimelineSortKey(
        "evt:b",
        occurredAt,
        communicationEmailInboundEventType,
      ),
      buildTimelineSortKey(
        "evt:a",
        occurredAt,
        communicationEmailInboundEventType,
      ),
    ].sort((left, right) => left.localeCompare(right));

    expect(rows).toEqual([
      `${occurredAt}::00::evt:a`,
      `${occurredAt}::00::evt:b`,
    ]);
  });

  it("sorts non-lifecycle events before lifecycle events at the same timestamp", () => {
    const occurredAt = "2025-11-17T00:00:00.000Z";
    const rows = [
      buildTimelineSortKey(
        "evt:lifecycle",
        occurredAt,
        lifecycleSignedUpEventType,
      ),
      buildTimelineSortKey(
        "evt:email",
        occurredAt,
        communicationEmailInboundEventType,
      ),
    ].sort((left, right) => left.localeCompare(right));

    expect(rows).toEqual([
      `${occurredAt}::00::evt:email`,
      `${occurredAt}::01::evt:lifecycle`,
    ]);
  });
});
