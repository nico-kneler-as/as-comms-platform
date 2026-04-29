import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createStage1MailchimpArtifactImportService } from "../src/ops/mailchimp-artifacts.js";
import { Stage1RetryableJobError } from "../src/orchestration/index.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

const contactId = "contact:salesforce:003-stage1";
const salesforceContactId = "003-stage1";

async function seedContact(context: TestWorkerContext) {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: contactId,
      salesforceContactId,
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    identities: [
      {
        id: `identity:${contactId}:salesforce`,
        contactId,
        kind: "salesforce_contact_id",
        normalizedValue: salesforceContactId,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: `identity:${contactId}:email`,
        contactId,
        kind: "email",
        normalizedValue: "volunteer@example.org",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    memberships: [
      {
        id: `membership:${contactId}:project-stage1`,
        contactId,
        salesforceMembershipId: `membership:${contactId}:project-stage1:sf`,
        projectId: "project-stage1",
        expeditionId: "expedition-stage1",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  });
}

async function writeArtifactCampaign(): Promise<string> {
  const artifactRoot = await mkdtemp(resolve(tmpdir(), "mailchimp-artifact-root-"));
  const campaignPath = resolve(artifactRoot, "campaign-1");
  await mkdir(campaignPath, {
    recursive: true
  });

  const writes = [
    [
      "summary.json",
      {
        id: "campaign-1",
        campaign_title: "Volunteer Update",
        subject_line: "Hello volunteers",
        preview_text: "Project updates for this week",
        list_id: "audience-1",
        send_time: "2026-02-01T15:00:00.000Z"
      }
    ],
    [
      "sent-to.json",
      [
        {
          email_id: "member-1",
          email_address: "volunteer@example.org",
          merge_fields: {
            PLATFORMID: "VOL-123"
          },
          status: "sent",
          last_open: "2026-02-01T15:10:00.000Z",
          campaign_id: "campaign-1",
          list_id: "audience-1"
        }
      ]
    ],
    [
      "open-details.json",
      [
        {
          campaign_id: "campaign-1",
          list_id: "audience-1",
          email_id: "member-1",
          email_address: "volunteer@example.org",
          merge_fields: {
            PLATFORMID: "VOL-123"
          },
          opens: [
            {
              timestamp: "2026-02-01T15:10:00.000Z"
            }
          ]
        }
      ]
    ],
    [
      "click-details.json",
      [
        {
          id: "link-1",
          url: "https://example.org/project",
          last_click: "2026-02-01T15:12:00.000Z",
          campaign_id: "campaign-1"
        }
      ]
    ],
    [
      "click-members.json",
      [
        {
          linkId: "link-1",
          url: "https://example.org/project",
          members: [
            {
              email_id: "member-1",
              email_address: "volunteer@example.org",
              merge_fields: {
                PLATFORMID: "VOL-123"
              },
              campaign_id: "campaign-1",
              list_id: "audience-1",
              clicks: 1
            }
          ]
        }
      ]
    ],
    [
      "unsubscribed.json",
      [
        {
          email_id: "member-1",
          email_address: "volunteer@example.org",
          merge_fields: {
            PLATFORMID: "VOL-123"
          },
          timestamp: "2026-02-02T10:00:00.000Z",
          reason: "No thanks",
          campaign_id: "campaign-1",
          list_id: "audience-1"
        }
      ]
    ]
  ] as const;

  await Promise.all(
    writes.map(([fileName, payload]) =>
      writeFile(
        resolve(campaignPath, fileName),
        `${JSON.stringify(payload, null, 2)}\n`
      )
    )
  );

  return artifactRoot;
}

async function writeArtifactCampaignWithUnmatchedRecipient(): Promise<string> {
  const artifactRoot = await mkdtemp(
    resolve(tmpdir(), "mailchimp-artifact-unmatched-root-")
  );
  const campaignPath = resolve(artifactRoot, "campaign-2");
  await mkdir(campaignPath, {
    recursive: true
  });

  const writes = [
    [
      "summary.json",
      {
        id: "campaign-2",
        campaign_title: "Broad Audience Outreach",
        subject_line: "Join us",
        preview_text: "Volunteer and supporter updates",
        list_id: "audience-2",
        send_time: "2026-03-01T15:00:00.000Z"
      }
    ],
    [
      "sent-to.json",
      [
        {
          email_id: "member-known",
          email_address: "volunteer@example.org",
          merge_fields: {
            PLATFORMID: "VOL-123"
          },
          status: "sent",
          last_open: "2026-03-01T15:10:00.000Z",
          campaign_id: "campaign-2",
          list_id: "audience-2"
        },
        {
          email_id: "member-unknown",
          email_address: "supporter@example.net",
          merge_fields: {},
          status: "sent",
          last_open: "2026-03-01T15:20:00.000Z",
          campaign_id: "campaign-2",
          list_id: "audience-2"
        }
      ]
    ],
    [
      "open-details.json",
      [
        {
          campaign_id: "campaign-2",
          list_id: "audience-2",
          email_id: "member-known",
          email_address: "volunteer@example.org",
          merge_fields: {
            PLATFORMID: "VOL-123"
          },
          opens: [
            {
              timestamp: "2026-03-01T15:10:00.000Z"
            }
          ]
        },
        {
          campaign_id: "campaign-2",
          list_id: "audience-2",
          email_id: "member-unknown",
          email_address: "supporter@example.net",
          merge_fields: {},
          opens: [
            {
              timestamp: "2026-03-01T15:20:00.000Z"
            }
          ]
        }
      ]
    ],
    [
      "click-details.json",
      [
        {
          id: "link-1",
          url: "https://example.org/project",
          last_click: "2026-03-01T15:12:00.000Z",
          campaign_id: "campaign-2"
        }
      ]
    ],
    [
      "click-members.json",
      [
        {
          linkId: "link-1",
          url: "https://example.org/project",
          members: [
            {
              email_id: "member-known",
              email_address: "volunteer@example.org",
              merge_fields: {
                PLATFORMID: "VOL-123"
              },
              campaign_id: "campaign-2",
              list_id: "audience-2",
              clicks: 1
            },
            {
              email_id: "member-unknown",
              email_address: "supporter@example.net",
              merge_fields: {},
              campaign_id: "campaign-2",
              list_id: "audience-2",
              clicks: 1
            }
          ]
        }
      ]
    ],
    [
      "unsubscribed.json",
      [
        {
          email_id: "member-known",
          email_address: "volunteer@example.org",
          merge_fields: {
            PLATFORMID: "VOL-123"
          },
          timestamp: "2026-03-02T10:00:00.000Z",
          reason: "No thanks",
          campaign_id: "campaign-2",
          list_id: "audience-2"
        },
        {
          email_id: "member-unknown",
          email_address: "supporter@example.net",
          merge_fields: {},
          timestamp: "2026-03-02T10:05:00.000Z",
          reason: "No thanks",
          campaign_id: "campaign-2",
          list_id: "audience-2"
        }
      ]
    ]
  ] as const;

  await Promise.all(
    writes.map(([fileName, payload]) =>
      writeFile(
        resolve(campaignPath, fileName),
        `${JSON.stringify(payload, null, 2)}\n`
      )
    )
  );

  return artifactRoot;
}

async function writeArtifactCampaignWithRecipientCount(input: {
  readonly campaignId: string;
  readonly recipientCount: number;
}): Promise<string> {
  const artifactRoot = await mkdtemp(
    resolve(tmpdir(), `mailchimp-artifact-${input.campaignId}-`)
  );
  const campaignPath = resolve(artifactRoot, input.campaignId);
  await mkdir(campaignPath, {
    recursive: true
  });

  const sentTo = Array.from({ length: input.recipientCount }, (_, index) => ({
    email_id: `member-${String(index + 1)}`,
    email_address: "volunteer@example.org",
    merge_fields: {
      PLATFORMID: "VOL-123"
    },
    status: "sent",
    campaign_id: input.campaignId,
    list_id: "audience-resume"
  }));
  const writes: readonly (readonly [string, unknown])[] = [
    [
      "summary.json",
      {
        id: input.campaignId,
        campaign_title: "Resume Mailchimp Campaign",
        subject_line: "Resume proof",
        preview_text: "Importer should resume from the last batch checkpoint",
        list_id: "audience-resume",
        send_time: "2026-04-01T15:00:00.000Z"
      }
    ],
    ["sent-to.json", sentTo],
    ["open-details.json", []],
    ["click-details.json", []],
    ["click-members.json", []],
    ["unsubscribed.json", []]
  ];

  await Promise.all(
    writes.map(([fileName, payload]) =>
      writeFile(
        resolve(campaignPath, fileName),
        `${JSON.stringify(payload, null, 2)}\n`
      )
    )
  );

  return artifactRoot;
}

describe("Stage 1 Mailchimp artifact importer", () => {
  it("imports Mailchimp campaign artifacts through the historical normalization path and stays replay-safe", async () => {
    const context = await createTestWorkerContext();
    const artifactRoot = await writeArtifactCampaign();

    try {
      await seedContact(context);
      const importer = createStage1MailchimpArtifactImportService({
        ingest: context.ingest,
        persistence: context.persistence,
        syncState: context.syncState,
        now: () => new Date("2026-02-03T00:00:00.000Z")
      });

      const firstRun = await importer.importArtifacts({
        artifactPath: artifactRoot,
        syncStateId: "sync:mailchimp:artifacts:first",
        correlationId: "corr:mailchimp:artifacts:first",
        traceId: null,
        receivedAt: "2026-02-03T00:00:00.000Z"
      });
      const secondRun = await importer.importArtifacts({
        artifactPath: artifactRoot,
        syncStateId: "sync:mailchimp:artifacts:second",
        correlationId: "corr:mailchimp:artifacts:second",
        traceId: null,
        receivedAt: "2026-02-03T00:05:00.000Z"
      });

      expect(firstRun).toMatchObject({
        outcome: "succeeded",
        parsedCampaigns: 1,
        parsedRecords: 4,
        syncStatus: "succeeded",
        summary: {
          processed: 4,
          normalized: 4
        }
      });
      expect(secondRun).toMatchObject({
        outcome: "succeeded",
        parsedCampaigns: 1,
        parsedRecords: 4,
        syncStatus: "succeeded",
        summary: {
          processed: 4,
          duplicate: 4
        }
      });

      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(4);
      const canonicalEvents =
        await context.repositories.canonicalEvents.listByContactId(contactId);
      expect(canonicalEvents).toHaveLength(4);

      await expect(
        context.repositories.inboxProjection.findByContactId(contactId)
      ).resolves.toBeNull();

      const sourceEvidenceIds = canonicalEvents.map((event) => event.sourceEvidenceId);
      await expect(
        context.repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds(
          sourceEvidenceIds
        )
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activityType: "sent",
            campaignId: "campaign-1",
            audienceId: "audience-1",
            campaignName: "Volunteer Update"
          }),
          expect.objectContaining({
            activityType: "clicked",
            snippet: "https://example.org/project"
          })
        ])
      );
      await expect(
        context.repositories.syncState.findById("sync:mailchimp:artifacts:first")
      ).resolves.toMatchObject({
        provider: "mailchimp",
        jobType: "historical_backfill",
        status: "succeeded"
      });
    } finally {
      await rm(artifactRoot, {
        recursive: true,
        force: true
      });
      await context.dispose();
    }
  });

  it("skips unmatched Mailchimp recipients and writes an aggregate report instead of opening identity review", async () => {
    const context = await createTestWorkerContext();
    const artifactRoot = await writeArtifactCampaignWithUnmatchedRecipient();

    try {
      await seedContact(context);
      const importer = createStage1MailchimpArtifactImportService({
        ingest: context.ingest,
        persistence: context.persistence,
        syncState: context.syncState,
        now: () => new Date("2026-03-03T00:00:00.000Z")
      });

      const result = await importer.importArtifacts({
        artifactPath: artifactRoot,
        syncStateId: "sync:mailchimp:artifacts:skip-unmatched",
        correlationId: "corr:mailchimp:artifacts:skip-unmatched",
        traceId: null,
        receivedAt: "2026-03-03T00:00:00.000Z"
      });

      expect(result).toMatchObject({
        outcome: "succeeded",
        parsedCampaigns: 1,
        parsedRecords: 8,
        syncStatus: "succeeded",
        summary: {
          processed: 4,
          normalized: 4,
          reviewOpened: 0,
          skippedUnmatched: 4,
          skippedUnmatchedRecipients: 1
        }
      });
      expect(result.unmatchedReportJsonPath).toBeTruthy();
      expect(result.unmatchedReportCsvPath).toBeTruthy();

      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(4);
      await expect(
        context.repositories.identityResolutionQueue.listOpenByReasonCode(
          "identity_missing_anchor"
        )
      ).resolves.toEqual([]);
    } finally {
      await rm(artifactRoot, {
        recursive: true,
        force: true
      });
      await context.dispose();
    }
  });

  it("resumes within a Mailchimp campaign after a retryable failure instead of replaying the whole artifact", async () => {
    const context = await createTestWorkerContext();
    const artifactRoot = await writeArtifactCampaignWithRecipientCount({
      campaignId: "campaign-resume",
      recipientCount: 30
    });

    try {
      await seedContact(context);
      let shouldFailOnce = true;
      let ingestCalls = 0;
      const flakyIngest = {
        async ingestMailchimpHistoricalRecord(
          record: Parameters<
            TestWorkerContext["ingest"]["ingestMailchimpHistoricalRecord"]
          >[0]
        ) {
          ingestCalls += 1;

          if (shouldFailOnce && ingestCalls === 28) {
            shouldFailOnce = false;
            throw new Stage1RetryableJobError("read ECONNRESET");
          }

          return context.ingest.ingestMailchimpHistoricalRecord(record);
        }
      };
      const importer = createStage1MailchimpArtifactImportService({
        ingest: flakyIngest,
        persistence: context.persistence,
        syncState: context.syncState,
        now: () => new Date("2026-04-02T00:00:00.000Z")
      });

      const firstRun = await importer.importArtifacts({
        artifactPath: artifactRoot,
        syncStateId: "sync:mailchimp:artifacts:resume",
        correlationId: "corr:mailchimp:artifacts:resume:first",
        traceId: null,
        receivedAt: "2026-04-02T00:00:00.000Z"
      });

      expect(firstRun).toMatchObject({
        outcome: "failed",
        parsedCampaigns: 1,
        parsedRecords: 30,
        syncStatus: "failed",
        summary: {
          processed: 27,
          normalized: 27
        }
      });
      await expect(
        context.repositories.syncState.findById("sync:mailchimp:artifacts:resume")
      ).resolves.toMatchObject({
        status: "failed",
        cursor: "campaign-resume:record:25"
      });

      const secondRun = await importer.importArtifacts({
        artifactPath: artifactRoot,
        syncStateId: "sync:mailchimp:artifacts:resume",
        correlationId: "corr:mailchimp:artifacts:resume:second",
        traceId: null,
        receivedAt: "2026-04-02T00:05:00.000Z"
      });

      expect(secondRun).toMatchObject({
        outcome: "succeeded",
        parsedCampaigns: 1,
        parsedRecords: 30,
        syncStatus: "succeeded",
        summary: {
          processed: 5,
          normalized: 3,
          duplicate: 2
        }
      });

      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(30);
      await expect(
        context.repositories.syncState.findById("sync:mailchimp:artifacts:resume")
      ).resolves.toMatchObject({
        status: "succeeded",
        cursor: "campaign-resume"
      });
    } finally {
      await rm(artifactRoot, {
        recursive: true,
        force: true
      });
      await context.dispose();
    }
  });

  it("heartbeats while a long Mailchimp artifact import is still running", async () => {
    vi.useFakeTimers();
    const context = await createTestWorkerContext();
    const artifactRoot = await writeArtifactCampaign();

    try {
      await seedContact(context);

      let notifyIngestStarted: (() => void) | undefined;
      const ingestStarted = new Promise<void>((resolve) => {
        notifyIngestStarted = resolve;
      });
      let releaseIngest: (() => void) | undefined;
      const holdIngest = new Promise<void>((resolve) => {
        releaseIngest = resolve;
      });
      const heartbeat = vi.fn(({ syncStateId }: { readonly syncStateId: string }) =>
        context.syncState.heartbeat({ syncStateId })
      );
      const importer = createStage1MailchimpArtifactImportService({
        ingest: {
          ingestMailchimpHistoricalRecord(record) {
            notifyIngestStarted?.();

            return holdIngest.then(() =>
              context.ingest.ingestMailchimpHistoricalRecord(record)
            );
          }
        },
        persistence: context.persistence,
        syncState: {
          ...context.syncState,
          heartbeat
        },
        now: () => new Date("2026-02-03T00:00:00.000Z")
      });

      const importPromise = importer.importArtifacts({
        artifactPath: artifactRoot,
        syncStateId: "sync:mailchimp:artifacts:heartbeat",
        correlationId: "corr:mailchimp:artifacts:heartbeat",
        traceId: null,
        receivedAt: "2026-02-03T00:00:00.000Z"
      });

      await ingestStarted;
      await vi.advanceTimersByTimeAsync(30_000);
      if (releaseIngest !== undefined) {
        releaseIngest();
      }
      await importPromise;

      expect(heartbeat).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await rm(artifactRoot, {
        recursive: true,
        force: true
      });
      await context.dispose();
    }
  });
});
