import { describe, expect, it } from "vitest";

import {
  buildUnmappedTaskScopeReport,
  classifyUnmappedTaskSubjectBucket
} from "../src/ops/diag-unmapped-task-scope.js";

describe("diag-unmapped-task-scope", () => {
  it("buckets subjects into the expected operator-facing clusters", () => {
    expect(classifyUnmappedTaskSubjectBucket("Hex 36016 (Date Pending)")).toBe(
      "hex"
    );
    expect(
      classifyUnmappedTaskSubjectBucket("Plan your Adventure Today!")
    ).toBe("plan_your");
    expect(
      classifyUnmappedTaskSubjectBucket("Time to Plan Your Adventures")
    ).toBe("time_to_plan");
    expect(classifyUnmappedTaskSubjectBucket("Don't Forget to Finish")).toBe(
      "dont_forget"
    );
    expect(classifyUnmappedTaskSubjectBucket("Completely different subject")).toBe(
      "other"
    );
  });

  it("builds distributions, last-30-day counts, and capped cluster samples", () => {
    const report = buildUnmappedTaskScopeReport({
      now: new Date("2026-04-30T12:00:00.000Z"),
      rows: [
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-1",
          occurredAt: "2026-04-30T10:00:00.000Z",
          taskSubtype: "Task",
          subject: "Plan your Adventure Today!",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-1",
          relatedMembershipPresent: true,
          createdDate: "2026-04-30T09:00:00.000Z",
          lastModifiedDate: "2026-04-30T09:30:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-2",
          occurredAt: "2026-04-29T10:00:00.000Z",
          taskSubtype: "Task",
          subject: "Hex 36016 (Date Pending)",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-2",
          relatedMembershipPresent: true,
          createdDate: "2026-04-29T09:00:00.000Z",
          lastModifiedDate: "2026-04-29T09:30:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-3",
          // 2026-04-01T13:00 sits AFTER the 30-day cutoff at 2026-04-01T12:00
          // (now=2026-04-30T12:00 minus 29 days), so this row stays in window.
          occurredAt: "2026-04-01T13:00:00.000Z",
          taskSubtype: null,
          subject: "Completely different subject",
          ownerUsername: "someone@example.org",
          whoId: "003-3",
          relatedMembershipPresent: false,
          createdDate: "2026-04-01T12:00:00.000Z",
          lastModifiedDate: "2026-04-01T12:30:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-4",
          occurredAt: "2026-03-01T10:00:00.000Z",
          taskSubtype: "Call",
          subject: "Don't Forget to Finish",
          ownerUsername: null,
          whoId: "003-4",
          relatedMembershipPresent: false,
          createdDate: "2026-03-01T09:00:00.000Z",
          lastModifiedDate: "2026-03-01T09:30:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-5",
          occurredAt: "2026-04-30T11:00:00.000Z",
          taskSubtype: "Task",
          subject: "Time to Plan Your Adventures",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-5",
          relatedMembershipPresent: true,
          createdDate: "2026-04-30T10:30:00.000Z",
          lastModifiedDate: "2026-04-30T10:40:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-6",
          occurredAt: "2026-04-30T11:10:00.000Z",
          taskSubtype: "Task",
          subject: "Time to Plan Your Adventures",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-6",
          relatedMembershipPresent: true,
          createdDate: "2026-04-30T10:35:00.000Z",
          lastModifiedDate: "2026-04-30T10:45:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-7",
          occurredAt: "2026-04-30T11:20:00.000Z",
          taskSubtype: "Task",
          subject: "Time to Plan Your Adventures",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-7",
          relatedMembershipPresent: true,
          createdDate: "2026-04-30T10:36:00.000Z",
          lastModifiedDate: "2026-04-30T10:46:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-8",
          occurredAt: "2026-04-30T11:30:00.000Z",
          taskSubtype: "Task",
          subject: "Time to Plan Your Adventures",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-8",
          relatedMembershipPresent: true,
          createdDate: "2026-04-30T10:37:00.000Z",
          lastModifiedDate: "2026-04-30T10:47:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-9",
          occurredAt: "2026-04-30T11:40:00.000Z",
          taskSubtype: "Task",
          subject: "Time to Plan Your Adventures",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-9",
          relatedMembershipPresent: true,
          createdDate: "2026-04-30T10:38:00.000Z",
          lastModifiedDate: "2026-04-30T10:48:00.000Z"
        },
        {
          policyCode: "stage1.skip.task_unmapped_channel",
          entityId: "00T-10",
          occurredAt: "2026-04-30T11:50:00.000Z",
          taskSubtype: "Task",
          subject: "Time to Plan Your Adventures",
          ownerUsername: "admin+1@adventurescientists.org",
          whoId: "003-10",
          relatedMembershipPresent: true,
          createdDate: "2026-04-30T10:39:00.000Z",
          lastModifiedDate: "2026-04-30T10:49:00.000Z"
        }
      ]
    });

    expect(report.totalRows).toBe(10);
    expect(report.taskSubtypeDistribution).toEqual({
      "(missing)": 1,
      Call: 1,
      Task: 8
    });
    expect(report.subjectBucketDistribution).toEqual({
      hex: 1,
      plan_your: 1,
      time_to_plan: 6,
      dont_forget: 1,
      other: 1
    });
    expect(report.ownerUsernameDistribution[0]).toEqual({
      ownerUsername: "admin+1@adventurescientists.org",
      count: 8,
      launchScopeOwner: true
    });
    expect(report.last30DayCounts).toEqual([
      { day: "2026-04-01", count: 1 },
      { day: "2026-04-29", count: 1 },
      { day: "2026-04-30", count: 7 }
    ]);
    const adminTaskCluster = report.samplesByCluster.find(
      (cluster) =>
        cluster.ownerUsername === "admin+1@adventurescientists.org" &&
        cluster.taskSubtype === "Task"
    );
    expect(adminTaskCluster?.rows).toHaveLength(5);
  });
});
