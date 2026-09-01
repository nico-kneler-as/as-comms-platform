export type AutomatedEmailMergeFieldKey =
  | "firstName"
  | "lastName"
  | "email"
  | "projectName";

export type AutomatedEmailMergeFieldPolicy =
  | { readonly kind: "fallback"; readonly value: string }
  | { readonly kind: "required" };

export interface AutomatedEmailMergeField {
  readonly key: AutomatedEmailMergeFieldKey;
  readonly label: string;
  readonly policy: AutomatedEmailMergeFieldPolicy;
}

/**
 * The single curated merge-field catalog for automated email.
 *
 * Later consumers, including the editor picker and documentation, must read
 * missing-data behavior from this data rather than define it separately.
 */
export const AUTOMATED_EMAIL_MERGE_FIELDS = [
  {
    key: "firstName",
    label: "First name",
    policy: { kind: "fallback", value: "there" },
  },
  {
    key: "lastName",
    label: "Last name",
    policy: { kind: "fallback", value: "" },
  },
  {
    key: "email",
    label: "Email",
    policy: { kind: "required" },
  },
  {
    key: "projectName",
    label: "Project name",
    policy: { kind: "required" },
  },
] as const satisfies readonly AutomatedEmailMergeField[];

export interface AutomatedEmailSalesforceClient {
  queryAll(soql: string): Promise<readonly Record<string, unknown>[]>;
}

export class UnknownAutomatedEmailMergeFieldError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Unknown automated email merge field: ${key}`);
    this.name = "UnknownAutomatedEmailMergeFieldError";
    this.key = key;
  }
}

export type AutomatedEmailMergeValues = Partial<
  Record<AutomatedEmailMergeFieldKey, string>
>;

export type AutomatedEmailMergeResolution =
  | { readonly outcome: "invalid_id" }
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "resolved";
      readonly contactId: string | null;
      readonly recipientEmail: string | null;
      readonly values: AutomatedEmailMergeValues;
      readonly missingRequired: readonly AutomatedEmailMergeFieldKey[];
    };

const expeditionMemberIdPattern = /^(?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/u;
const automatedEmailMergeFieldsByKey = new Map<
  AutomatedEmailMergeFieldKey,
  AutomatedEmailMergeField
>(AUTOMATED_EMAIL_MERGE_FIELDS.map((field) => [field.key, field]));

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRelatedString(
  row: Record<string, unknown>,
  relationshipName: string,
  fieldName: string,
): string | null {
  const relationship = row[relationshipName];
  if (
    typeof relationship !== "object" ||
    relationship === null ||
    Array.isArray(relationship)
  ) {
    return null;
  }

  return readTrimmedString(
    (relationship as Record<string, unknown>)[fieldName],
  );
}

function coalesce(...values: readonly (string | null)[]): string | null {
  return values.find((value) => value !== null) ?? null;
}

function readContactId(row: Record<string, unknown>): string | null {
  const contactId = row.Contact__c;
  return typeof contactId === "string" && contactId.length > 0
    ? contactId
    : null;
}

function readResolvedValues(
  row: Record<string, unknown>,
): Record<AutomatedEmailMergeFieldKey, string | null> {
  return {
    firstName: coalesce(
      readRelatedString(row, "Contact__r", "FirstName"),
      readTrimmedString(row.First_Name__c),
    ),
    lastName: coalesce(
      readRelatedString(row, "Contact__r", "LastName"),
      readTrimmedString(row.Last_Name__c),
    ),
    email: coalesce(
      readRelatedString(row, "Contact__r", "Email"),
      readTrimmedString(row.Email__c),
    ),
    projectName: readRelatedString(row, "Expedition__r", "Name"),
  };
}

function buildExpeditionMemberQuery(expeditionMemberId: string): string {
  return `SELECT Id, First_Name__c, Last_Name__c, Email__c, Contact__c, Contact__r.FirstName, Contact__r.LastName, Contact__r.Email, Expedition__r.Name FROM Expedition_Members__c WHERE Id = '${expeditionMemberId}'`;
}

function readField(key: string): AutomatedEmailMergeField {
  const field = automatedEmailMergeFieldsByKey.get(
    key as AutomatedEmailMergeFieldKey,
  );
  if (field === undefined) {
    throw new UnknownAutomatedEmailMergeFieldError(key);
  }

  return field;
}

export async function resolveAutomatedEmailMergeFields(
  client: AutomatedEmailSalesforceClient,
  expeditionMemberId: string,
  keys: readonly AutomatedEmailMergeFieldKey[],
): Promise<AutomatedEmailMergeResolution> {
  const fields = keys.map(readField);
  if (!expeditionMemberIdPattern.test(expeditionMemberId)) {
    return { outcome: "invalid_id" };
  }

  const rows = await client.queryAll(
    buildExpeditionMemberQuery(expeditionMemberId),
  );
  const row = rows[0];
  if (row === undefined) {
    return { outcome: "not_found" };
  }

  const resolvedValues = readResolvedValues(row);
  const values: AutomatedEmailMergeValues = {};
  const missingRequired: AutomatedEmailMergeFieldKey[] = [];

  for (const field of fields) {
    const value = resolvedValues[field.key];
    if (value !== null) {
      values[field.key] = value;
      continue;
    }

    if (field.policy.kind === "fallback") {
      values[field.key] = field.policy.value;
      continue;
    }

    missingRequired.push(field.key);
  }

  return {
    outcome: "resolved",
    contactId: readContactId(row),
    recipientEmail: resolvedValues.email,
    values,
    missingRequired,
  };
}
