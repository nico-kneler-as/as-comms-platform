import { describe, expect, it, vi } from "vitest";

import {
  contacts,
  contactMemberships,
  projectDimensions,
  salesforceReconciliationRuns,
} from "@as-comms/db";
import { asc, isNotNull } from "drizzle-orm";
import type {
  SalesforceApiClient,
  SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";

import { reconcileSalesforceState } from "../src/ops/reconcile-salesforce-state.js";
import { createTestStage1Context } from "./helpers.js";

const runTimestamp = "2026-06-13T06:00:00.000Z";

function buildSalesforceConfig(): SalesforceCaptureServiceConfig {
  return {
    bearerToken: "capture-token",
    loginUrl: "https://login.salesforce.com",
    clientId: "client-id",
    username: "worker@example.org",
    jwtPrivateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    jwtExpirationSeconds: 180,
    apiVersion: "61.0",
    contactCaptureMode: "delta_polling",
    membershipCaptureMode: "delta_polling",
    membershipObjectName: "Expedition_Members__c",
    membershipContactField: "Contact__c",
    membershipProjectField: "Project__c",
    membershipProjectNameField: "Project__r.Name",
    membershipExpeditionField: "Expedition__c",
    membershipExpeditionNameField: "Expedition__r.Name",
    membershipRoleField: null,
    membershipStatusField: "Status__c",
    taskContactField: "WhoId",
    taskChannelField: "TaskSubtype",
    taskEmailChannelValues: ["Email"],
    taskSmsChannelValues: ["SMS", "Text"],
    taskSnippetField: "Description",
    taskOccurredAtField: "CreatedDate",
    taskCrossProviderKeyField: null,
    timeoutMs: 15_000,
  };
}

function parseSoql(input: string): {
  readonly objectName: string;
  readonly ids: readonly string[];
} {
  const objectNameMatch = /FROM\s+([A-Za-z0-9_]+)\s+WHERE/u.exec(input);

  if (objectNameMatch?.[1] === undefined) {
    throw new Error(`Could not parse object name from SOQL: ${input}`);
  }

  const ids = Array.from(input.matchAll(/'([^']+)'/gu), (match) => match[1] ?? "");

  return {
    objectName: objectNameMatch[1],
    ids,
  };
}

async function seedStandardFixture(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
): Promise<void> {
  await Promise.all([
    context.repositories.contacts.upsert({
      id: "contact:present",
      salesforceContactId: "003CONTACTPRESENT",
      displayName: "Contact Present",
      primaryEmail: "present@example.org",
      primaryPhone: null,
      createdAt: runTimestamp,
      updatedAt: runTimestamp,
    }),
    context.repositories.contacts.upsert({
      id: "contact:deleted",
      salesforceContactId: "003CONTACTDELETED",
      displayName: "Contact Deleted",
      primaryEmail: "deleted@example.org",
      primaryPhone: null,
      createdAt: runTimestamp,
      updatedAt: runTimestamp,
    }),
    context.repositories.contacts.upsert({
      id: "contact:missing",
      salesforceContactId: "003CONTACTMISSING",
      displayName: "Contact Missing",
      primaryEmail: "missing@example.org",
      primaryPhone: null,
      createdAt: runTimestamp,
      updatedAt: runTimestamp,
    }),
    context.repositories.projectDimensions.upsert({
      projectId: "701PROJECTPRESENT",
      projectName: "Project Present",
      source: "salesforce",
    }),
    context.repositories.projectDimensions.upsert({
      projectId: "701PROJECTDELETED",
      projectName: "Project Deleted",
      source: "salesforce",
    }),
    context.repositories.projectDimensions.upsert({
      projectId: "701PROJECTMISSING",
      projectName: "Project Missing",
      source: "salesforce",
    }),
  ]);

  await Promise.all([
    context.repositories.contactMemberships.upsert({
      id: "membership:present",
      contactId: "contact:present",
      projectId: "701PROJECTPRESENT",
      expeditionId: null,
      salesforceMembershipId: "a15MEMBERSHIPPRESENT",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: runTimestamp,
    }),
    context.repositories.contactMemberships.upsert({
      id: "membership:deleted",
      contactId: "contact:deleted",
      projectId: "701PROJECTDELETED",
      expeditionId: null,
      salesforceMembershipId: "a15MEMBERSHIPDELETED",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: runTimestamp,
    }),
    context.repositories.contactMemberships.upsert({
      id: "membership:missing",
      contactId: "contact:missing",
      projectId: "701PROJECTMISSING",
      expeditionId: null,
      salesforceMembershipId: "a15MEMBERSHIPMISSING",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: runTimestamp,
    }),
  ]);
}

function buildStandardApiClient(): SalesforceApiClient {
  return {
    queryAll: vi.fn(() => Promise.resolve([])),
    queryAllIncludingDeleted: vi.fn((soql: string) => {
      const { objectName } = parseSoql(soql);

      switch (objectName) {
        case "Contact":
          return Promise.resolve([
            { Id: "003CONTACTPRESENT", IsDeleted: false },
            { Id: "003CONTACTDELETED", IsDeleted: true },
            { Id: "003CONTACTEXTRA", IsDeleted: false },
          ]);
        case "Expedition_Members__c":
          return Promise.resolve([
            { Id: "a15MEMBERSHIPPRESENT", IsDeleted: false },
            { Id: "a15MEMBERSHIPDELETED", IsDeleted: true },
            { Id: "a15MEMBERSHIPEXTRA", IsDeleted: false },
          ]);
        case "Campaign":
          return Promise.resolve([
            { Id: "701PROJECTPRESENT", IsDeleted: false },
            { Id: "701PROJECTDELETED", IsDeleted: true },
            { Id: "701PROJECTEXTRA", IsDeleted: false },
          ]);
        default:
          throw new Error(`Unexpected object name: ${objectName}`);
      }
    }),
  };
}

async function readRunRows(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
) {
  return context.db
    .select()
    .from(salesforceReconciliationRuns)
    .orderBy(asc(salesforceReconciliationRuns.entityType));
}

describe("reconcileSalesforceState", () => {
  it("dry_run writes run-log rows but no tombstones or reconciled timestamps", async () => {
    const context = await createTestStage1Context();

    try {
      await seedStandardFixture(context);

      const report = await reconcileSalesforceState({
        db: context.db,
        repositories: context.repositories,
        apiClient: buildStandardApiClient(),
        mode: "dry_run",
        salesforceConfig: buildSalesforceConfig(),
        now: () => new Date(runTimestamp),
        logger: {
          log: () => undefined,
          warn: () => undefined,
        },
      });

      expect(report.runs).toEqual([
        expect.objectContaining({
          entityType: "contact",
          mode: "dry_run",
          scanned: 3,
          confirmedPresent: 1,
          markedDeleted: 2,
          missingLocallyCount: 1,
          errors: [],
          abortedReason: null,
        }),
        expect.objectContaining({
          entityType: "membership",
          mode: "dry_run",
          scanned: 3,
          confirmedPresent: 1,
          markedDeleted: 2,
          missingLocallyCount: 1,
          errors: [],
          abortedReason: null,
        }),
        expect.objectContaining({
          entityType: "project",
          mode: "dry_run",
          scanned: 3,
          confirmedPresent: 1,
          markedDeleted: 2,
          missingLocallyCount: 1,
          errors: [],
          abortedReason: null,
        }),
      ]);

      expect(await readRunRows(context)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityType: "contact",
            mode: "dry_run",
            scanned: 3,
            confirmedPresent: 1,
            markedDeleted: 2,
            missingLocallyCount: 1,
            errors: [],
          }),
          expect.objectContaining({
            entityType: "membership",
            mode: "dry_run",
            scanned: 3,
            confirmedPresent: 1,
            markedDeleted: 2,
            missingLocallyCount: 1,
            errors: [],
          }),
          expect.objectContaining({
            entityType: "project",
            mode: "dry_run",
            scanned: 3,
            confirmedPresent: 1,
            markedDeleted: 2,
            missingLocallyCount: 1,
            errors: [],
          }),
        ]),
      );

      expect(
        await context.db
          .select()
          .from(contacts)
          .where(isNotNull(contacts.salesforceDeletedAt)),
      ).toHaveLength(0);
      expect(
        await context.db
          .select()
          .from(contactMemberships)
          .where(isNotNull(contactMemberships.salesforceDeletedAt)),
      ).toHaveLength(0);
      expect(
        await context.db
          .select()
          .from(projectDimensions)
          .where(isNotNull(projectDimensions.salesforceDeletedAt)),
      ).toHaveLength(0);
      expect(
        await context.db
          .select()
          .from(contacts)
          .where(isNotNull(contacts.salesforceReconciledAt)),
      ).toHaveLength(0);
      expect(
        await context.db
          .select()
          .from(contactMemberships)
          .where(isNotNull(contactMemberships.salesforceReconciledAt)),
      ).toHaveLength(0);
      expect(
        await context.db
          .select()
          .from(projectDimensions)
          .where(isNotNull(projectDimensions.salesforceReconciledAt)),
      ).toHaveLength(0);
    } finally {
      await context.dispose();
    }
  });

  it("enforce writes tombstones, reconciled timestamps, and run-log rows", async () => {
    const context = await createTestStage1Context();

    try {
      await seedStandardFixture(context);

      await reconcileSalesforceState({
        db: context.db,
        repositories: context.repositories,
        apiClient: buildStandardApiClient(),
        mode: "enforce",
        salesforceConfig: buildSalesforceConfig(),
        now: () => new Date(runTimestamp),
        logger: {
          log: () => undefined,
          warn: () => undefined,
        },
      });

      expect(await readRunRows(context)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityType: "contact", mode: "enforce" }),
          expect.objectContaining({
            entityType: "membership",
            mode: "enforce",
          }),
          expect.objectContaining({ entityType: "project", mode: "enforce" }),
        ]),
      );

      await expect(
        context.repositories.contacts.findById("contact:present"),
      ).resolves.toMatchObject({
        salesforceDeletedAt: null,
        salesforceReconciledAt: runTimestamp,
      });
      await expect(
        context.repositories.contacts.findById("contact:deleted"),
      ).resolves.toMatchObject({
        salesforceDeletedAt: runTimestamp,
        salesforceReconciledAt: null,
      });
      await expect(
        context.repositories.contacts.findById("contact:missing"),
      ).resolves.toMatchObject({
        salesforceDeletedAt: runTimestamp,
        salesforceReconciledAt: null,
      });

      await expect(
        context.repositories.contactMemberships.listByContactId("contact:present"),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "membership:present",
            salesforceDeletedAt: null,
            salesforceReconciledAt: runTimestamp,
          }),
        ]),
      );
      await expect(
        context.repositories.contactMemberships.listByContactId("contact:deleted"),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "membership:deleted",
            salesforceDeletedAt: runTimestamp,
            salesforceReconciledAt: null,
          }),
        ]),
      );
      await expect(
        context.repositories.contactMemberships.listByContactId("contact:missing"),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "membership:missing",
            salesforceDeletedAt: runTimestamp,
            salesforceReconciledAt: null,
          }),
        ]),
      );

      await expect(
        context.repositories.projectDimensions.findById("701PROJECTPRESENT"),
      ).resolves.toMatchObject({
        salesforceDeletedAt: null,
        salesforceReconciledAt: runTimestamp,
      });
      await expect(
        context.repositories.projectDimensions.findById("701PROJECTDELETED"),
      ).resolves.toMatchObject({
        salesforceDeletedAt: runTimestamp,
        salesforceReconciledAt: null,
      });
      await expect(
        context.repositories.projectDimensions.findById("701PROJECTMISSING"),
      ).resolves.toMatchObject({
        salesforceDeletedAt: runTimestamp,
        salesforceReconciledAt: null,
      });
    } finally {
      await context.dispose();
    }
  });

  it("writes zero-everything run rows for an empty database", async () => {
    const context = await createTestStage1Context();

    try {
      const report = await reconcileSalesforceState({
        db: context.db,
        repositories: context.repositories,
        apiClient: buildStandardApiClient(),
        mode: "dry_run",
        salesforceConfig: buildSalesforceConfig(),
        now: () => new Date(runTimestamp),
        logger: {
          log: () => undefined,
          warn: () => undefined,
        },
      });

      expect(report.runs).toEqual([
        expect.objectContaining({
          entityType: "contact",
          scanned: 0,
          confirmedPresent: 0,
          markedDeleted: 0,
          missingLocallyCount: 0,
          errors: [],
        }),
        expect.objectContaining({
          entityType: "membership",
          scanned: 0,
          confirmedPresent: 0,
          markedDeleted: 0,
          missingLocallyCount: 0,
          errors: [],
        }),
        expect.objectContaining({
          entityType: "project",
          scanned: 0,
          confirmedPresent: 0,
          markedDeleted: 0,
          missingLocallyCount: 0,
          errors: [],
        }),
      ]);

      expect(await readRunRows(context)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityType: "contact",
            scanned: 0,
            confirmedPresent: 0,
            markedDeleted: 0,
            missingLocallyCount: 0,
            errors: [],
          }),
          expect.objectContaining({
            entityType: "membership",
            scanned: 0,
            confirmedPresent: 0,
            markedDeleted: 0,
            missingLocallyCount: 0,
            errors: [],
          }),
          expect.objectContaining({
            entityType: "project",
            scanned: 0,
            confirmedPresent: 0,
            markedDeleted: 0,
            missingLocallyCount: 0,
            errors: [],
          }),
        ]),
      );
    } finally {
      await context.dispose();
    }
  });

  it("continues after a batch failure and records the batch error", async () => {
    const context = await createTestStage1Context();
    const queryAllIncludingDeleted = vi.fn(
      (soql: string): Promise<readonly Record<string, unknown>[]> => {
        const { objectName, ids } = parseSoql(soql);

        if (objectName !== "Contact") {
          return Promise.resolve([]);
        }

        const batchIndex = queryAllIncludingDeleted.mock.calls.filter(
          ([call]) => parseSoql(call).objectName === "Contact",
        ).length - 1;

        if (batchIndex === 1) {
          throw new Error("Synthetic batch failure");
        }

        return Promise.resolve(ids.map((id) => ({ Id: id, IsDeleted: false })));
      },
    );

    try {
      for (let index = 0; index < 1200; index += 1) {
        const id = `003BATCH${index.toString().padStart(4, "0")}`;
        await context.repositories.contacts.upsert({
          id: `contact:${id}`,
          salesforceContactId: id,
          displayName: `Contact ${index.toString()}`,
          primaryEmail: `contact-${index.toString()}@example.org`,
          primaryPhone: null,
          createdAt: runTimestamp,
          updatedAt: runTimestamp,
        });
      }

      await reconcileSalesforceState({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          queryAll: vi.fn(() => Promise.resolve([])),
          queryAllIncludingDeleted,
        },
        mode: "dry_run",
        salesforceConfig: buildSalesforceConfig(),
        now: () => new Date(runTimestamp),
        logger: {
          log: () => undefined,
          warn: () => undefined,
        },
      });

      const runRows = await readRunRows(context);
      const contactRun = runRows.find((row) => row.entityType === "contact");
      const membershipRun = runRows.find((row) => row.entityType === "membership");
      const projectRun = runRows.find((row) => row.entityType === "project");

      expect(contactRun).toMatchObject({
        scanned: 1200,
      });
      expect(contactRun?.errors).toEqual([
        expect.objectContaining({
          batchIndex: 1,
          message: "Synthetic batch failure",
        }),
      ]);
      expect(membershipRun?.errors).toEqual([]);
      expect(projectRun?.errors).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("never sends a manual project id to Salesforce or tombstones it through the orchestrator path", async () => {
    const context = await createTestStage1Context();
    const queryAllIncludingDeleted = vi.fn(
      (soql: string): Promise<readonly Record<string, unknown>[]> => {
        const { objectName, ids } = parseSoql(soql);

        if (objectName !== "Campaign") {
          return Promise.resolve([]);
        }

        expect(ids).toEqual(["701PROJECTSALESFORCE"]);

        return Promise.resolve([
          { Id: "701PROJECTSALESFORCE", IsDeleted: false },
          { Id: "701PROJECTMANUAL", IsDeleted: true },
        ]);
      },
    );

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "701PROJECTSALESFORCE",
        projectName: "Salesforce Project",
        source: "salesforce",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "701PROJECTMANUAL",
        projectName: "Manual Project",
        source: "manual",
      });

      await reconcileSalesforceState({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          queryAll: vi.fn(() => Promise.resolve([])),
          queryAllIncludingDeleted,
        },
        mode: "enforce",
        salesforceConfig: buildSalesforceConfig(),
        now: () => new Date(runTimestamp),
        logger: {
          log: () => undefined,
          warn: () => undefined,
        },
      });

      await expect(
        context.repositories.projectDimensions.findById("701PROJECTMANUAL"),
      ).resolves.toMatchObject({
        salesforceDeletedAt: null,
      });
    } finally {
      await context.dispose();
    }
  });
});
