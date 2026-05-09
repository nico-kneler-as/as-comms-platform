import { describe, expect, it } from "vitest";

import type { SourceEvidenceRecord } from "@as-comms/contracts";

import {
  decideSourceEvidenceSupersede,
  sameSourceEvidenceRecord,
} from "../src/source-evidence-supersede-policy.js";

const baseRecord: SourceEvidenceRecord = {
  id: "sev_supersede_baseline",
  provider: "salesforce",
  providerRecordType: "task_communication",
  providerRecordId: "00TVK00000lqsXc2AI",
  receivedAt: "2026-04-04T23:45:53.149Z",
  occurredAt: "2025-10-10T00:16:54.000Z",
  payloadRef: "salesforce://Task/00TVK00000lqsXc2AI",
  idempotencyKey:
    "source-evidence:salesforce:task_communication:00TVK00000lqsXc2AI",
  checksum: "0dda81118c60c0ffeebabe000000000000000000000000000000000000000001",
};

describe("decideSourceEvidenceSupersede", () => {
  it("returns duplicate when records match by all checksum-bearing fields", () => {
    const decision = decideSourceEvidenceSupersede(baseRecord, baseRecord);

    expect(decision).toEqual({ kind: "duplicate" });
  });

  it("returns duplicate when only payloadRef differs (not checksum-bearing)", () => {
    const movedPayload: SourceEvidenceRecord = {
      ...baseRecord,
      payloadRef: "salesforce://Task/00TVK00000lqsXc2AI?archived=true",
    };

    expect(decideSourceEvidenceSupersede(baseRecord, movedPayload)).toEqual({
      kind: "duplicate",
    });
  });

  it("returns duplicate when only receivedAt differs (re-poll same payload)", () => {
    const replay: SourceEvidenceRecord = {
      ...baseRecord,
      receivedAt: "2026-05-01T04:37:15.471Z",
    };

    expect(decideSourceEvidenceSupersede(baseRecord, replay)).toEqual({
      kind: "duplicate",
    });
  });

  it("returns duplicate when only id differs (post-restart fresh id, identical content)", () => {
    const fresh: SourceEvidenceRecord = {
      ...baseRecord,
      id: "sev_post_restart",
    };

    expect(decideSourceEvidenceSupersede(baseRecord, fresh)).toEqual({
      kind: "duplicate",
    });
  });

  it("returns supersede when checksum differs (capture-mapper change)", () => {
    const corrected: SourceEvidenceRecord = {
      ...baseRecord,
      checksum:
        "3b9ae90e1191c0ffeebabe000000000000000000000000000000000000000002",
    };

    expect(decideSourceEvidenceSupersede(baseRecord, corrected)).toEqual({
      kind: "supersede",
    });
  });

  it("returns supersede when occurredAt differs (SF date corrected upstream)", () => {
    const dateCorrected: SourceEvidenceRecord = {
      ...baseRecord,
      occurredAt: "2025-10-11T00:16:54.000Z",
    };

    expect(decideSourceEvidenceSupersede(baseRecord, dateCorrected)).toEqual({
      kind: "supersede",
    });
  });

  it("returns supersede when providerRecordType differs (record reclassified)", () => {
    const reclassified: SourceEvidenceRecord = {
      ...baseRecord,
      providerRecordType: "lifecycle_milestone",
    };

    expect(decideSourceEvidenceSupersede(baseRecord, reclassified)).toEqual({
      kind: "supersede",
    });
  });
});

describe("sameSourceEvidenceRecord", () => {
  it("ignores id, payloadRef, and receivedAt", () => {
    const reshaped: SourceEvidenceRecord = {
      ...baseRecord,
      id: "sev_other",
      payloadRef: "salesforce://Task/00TVK00000lqsXc2AI?v=2",
      receivedAt: "2026-09-01T00:00:00.000Z",
    };

    expect(sameSourceEvidenceRecord(baseRecord, reshaped)).toBe(true);
  });

  it("rejects records with mismatched checksum", () => {
    const corrected: SourceEvidenceRecord = {
      ...baseRecord,
      checksum:
        "3b9ae90e1191c0ffeebabe000000000000000000000000000000000000000002",
    };

    expect(sameSourceEvidenceRecord(baseRecord, corrected)).toBe(false);
  });
});
