import type { Task } from "graphile-worker";

import {
  salesforceExpeditionMemberWithdrawPayloadSchema,
} from "@as-comms/contracts";
import { isSalesforceRecordId } from "@as-comms/domain";
import {
  SalesforceWriteError,
  type SalesforceWriteClient,
} from "@as-comms/integrations";

export {
  salesforceExpeditionMemberWithdrawJobMaxAttempts,
  salesforceExpeditionMemberWithdrawJobName,
  salesforceExpeditionMemberWithdrawPayloadSchema,
} from "@as-comms/contracts";
export type { SalesforceExpeditionMemberWithdrawPayload } from "@as-comms/contracts";

const finalStatuses = new Set([
  "successful",
  "completed",
  "failed",
  "returning gear",
  "denied",
  "soft dened",
  "soft denied",
  "declined",
  "aborted",
]);

function normalizedStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isFinalExpeditionMemberStatus(value: unknown): boolean {
  return finalStatuses.has(normalizedStatus(value));
}

export interface SalesforceExpeditionMemberWithdrawTaskDependencies {
  readonly salesforceClient: {
    queryAll(soql: string): Promise<readonly Record<string, unknown>[]>;
  };
  readonly writeClient: Pick<SalesforceWriteClient, "setExpeditionMemberStatus">;
  readonly logger?: Pick<Console, "info" | "error">;
}

export function createSalesforceExpeditionMemberWithdrawTask(
  dependencies: SalesforceExpeditionMemberWithdrawTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;

  return async (payload) => {
    const { expeditionMemberId } = salesforceExpeditionMemberWithdrawPayloadSchema.parse(payload);
    if (!isSalesforceRecordId(expeditionMemberId)) {
      // The schema is the expected guard, but keep SOQL construction safe if a
      // task is ever invoked outside Graphile's normal payload validation.
      throw new Error("Invalid Salesforce expedition member ID.");
    }
    const rows = await dependencies.salesforceClient.queryAll(
      `SELECT Id, Status__c FROM Expedition_Members__c WHERE Id = '${expeditionMemberId}'`,
    );
    const member = rows[0];
    if (member === undefined) {
      logger.info(JSON.stringify({ event: "expedition_withdraw.member_not_found" }));
      return;
    }

    const previousStatus = typeof member.Status__c === "string"
      ? member.Status__c.trim()
      : "";
    if (isFinalExpeditionMemberStatus(member.Status__c)) {
      logger.info(JSON.stringify({
        event: "expedition_withdraw.status_kept",
        status: previousStatus,
      }));
      return;
    }

    try {
      await dependencies.writeClient.setExpeditionMemberStatus(
        expeditionMemberId,
        "Aborted",
      );
    } catch (error) {
      if (error instanceof SalesforceWriteError && error.kind === "permission") {
        logger.error(JSON.stringify({
          event: "expedition_withdraw.permission_error",
          code: error.code,
        }));
      }
      throw error;
    }
    logger.info(JSON.stringify({
      event: "expedition_withdraw.aborted",
      previous_status: previousStatus,
    }));
  };
}
