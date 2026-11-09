import { describe, expect, it, vi } from "vitest";

import { SalesforceWriteError } from "@as-comms/integrations";

import {
  createSalesforceExpeditionMemberWithdrawTask,
  isFinalExpeditionMemberStatus,
} from "../src/jobs/salesforce-expedition-member-withdraw.js";

const memberId = "a0B000000000001";
const payload = { expeditionMemberId: memberId, requestedAt: "2026-11-09T00:00:00.000Z" };

function harness(status: string | null, rows = status === null ? [{ Id: memberId, Status__c: null }] : [{ Id: memberId, Status__c: status }]) {
  const queryAll = vi.fn().mockResolvedValue(rows);
  const setExpeditionMemberStatus = vi.fn().mockResolvedValue(undefined);
  const info = vi.fn();
  const error = vi.fn();
  return {
    queryAll,
    setExpeditionMemberStatus,
    info,
    error,
    task: createSalesforceExpeditionMemberWithdrawTask({
      salesforceClient: { queryAll },
      writeClient: { setExpeditionMemberStatus },
      logger: { info, error },
    }),
  };
}

describe("salesforce expedition-member withdrawal task", () => {
  it("aborts active and blank statuses", async () => {
    for (const status of ["In Training", "Applied", "Trip Planning", null]) {
      const value = harness(status);
      await value.task(payload, {} as never);
      expect(value.setExpeditionMemberStatus).toHaveBeenCalledWith(memberId, "Aborted");
    }
  });

  it("keeps every final status", async () => {
    for (const status of ["Successful", "Completed", "Failed", "Returning Gear", "Denied", "Soft Dened", "Soft Denied", "Declined", "Aborted"]) {
      expect(isFinalExpeditionMemberStatus(` ${status.toUpperCase()} `)).toBe(true);
      const value = harness(status);
      await value.task(payload, {} as never);
      expect(value.setExpeditionMemberStatus).not.toHaveBeenCalled();
    }
  });

  it("completes when the member is absent and rethrows write errors", async () => {
    const missing = harness("Applied", []);
    await missing.task(payload, {} as never);
    expect(missing.setExpeditionMemberStatus).not.toHaveBeenCalled();

    const transient = harness("Applied");
    transient.setExpeditionMemberStatus.mockRejectedValueOnce(new Error("network"));
    await expect(transient.task(payload, {} as never)).rejects.toThrow("network");

    const permission = harness("Applied");
    permission.setExpeditionMemberStatus.mockRejectedValueOnce(
      new SalesforceWriteError("denied", "permission", 403, "FORBIDDEN"),
    );
    await expect(permission.task(payload, {} as never)).rejects.toThrow("denied");
    expect(permission.error).toHaveBeenCalled();
  });
});
