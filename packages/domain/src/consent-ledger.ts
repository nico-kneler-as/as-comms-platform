import type {
  ConsentScopeType,
  ContactConsentRecord,
  ConsentSource,
} from "@as-comms/contracts";

export interface Repositories {
  readonly contactConsent: {
    recordOptOut(
      contactId: string,
      scope: { readonly type: ConsentScopeType; readonly id?: string },
      source: ConsentSource,
      sourceRunId?: string,
    ): Promise<void>;
    listForContact(contactId: string): Promise<readonly ContactConsentRecord[]>;
  };
}

export interface ConsentLedger {
  recordOptOut(input: {
    contactId: string;
    scope: { type: "project" | "newsletter" | "all"; id?: string };
    source: "recipient_click" | "admin_action" | "provider_event" | "import";
    sourceRunId?: string;
  }): Promise<void>;
  isConsentedFor(
    contactId: string,
    scope: { type: ConsentScopeType; id?: string },
    at: Date,
  ): Promise<boolean>;
  listForContact(contactId: string): Promise<ContactConsentRecord[]>;
}

function matchesScope(
  record: ContactConsentRecord,
  scope: { readonly type: ConsentScopeType; readonly id?: string },
): boolean {
  if (record.scopeType === "all") {
    return true;
  }

  if (scope.type === "all") {
    return false;
  }

  if (scope.type === "project") {
    return (
      record.scopeType === "project" &&
      record.scopeId === (scope.id ?? null)
    );
  }

  return record.scopeType === "newsletter";
}

export function createConsentLedger(deps: {
  repositories: Repositories;
}): ConsentLedger {
  return {
    async recordOptOut(input) {
      await deps.repositories.contactConsent.recordOptOut(
        input.contactId,
        input.scope,
        input.source,
        input.sourceRunId,
      );
    },

    async isConsentedFor(contactId, scope, at) {
      const records = await deps.repositories.contactConsent.listForContact(
        contactId,
      );

      return !records.some(
        (record) =>
          record.optedOutAt <= at.toISOString() && matchesScope(record, scope),
      );
    },

    async listForContact(contactId) {
      return [...(await deps.repositories.contactConsent.listForContact(contactId))];
    },
  };
}
