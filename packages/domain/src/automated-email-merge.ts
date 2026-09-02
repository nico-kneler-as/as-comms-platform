export type AutomatedEmailMergeFieldKey =
  | "firstName"
  | "lastName"
  | "email"
  | "projectName"
  | "volunteerId"
  | "esriUsername";

export type AutomatedEmailMergeFieldPolicy =
  | { readonly kind: "fallback"; readonly value: string }
  | { readonly kind: "required" };

export interface AutomatedEmailMergeField {
  readonly key: AutomatedEmailMergeFieldKey;
  readonly label: string;
  readonly policy: AutomatedEmailMergeFieldPolicy;
  /**
   * Stand-in used when no real Salesforce record is in play — the editor's
   * preview drawer and test sends. Every field carries one so that previewing
   * a template can never fail for want of a value: callers build their sample
   * set by walking this catalog, not by listing keys by hand. Adding a field
   * to the catalog therefore makes it previewable in the same commit.
   */
  readonly sampleValue: string;
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
    sampleValue: "Alex",
  },
  {
    key: "lastName",
    label: "Last name",
    policy: { kind: "fallback", value: "" },
    sampleValue: "Rivera",
  },
  {
    key: "email",
    label: "Email",
    policy: { kind: "required" },
    sampleValue: "alex.rivera@example.org",
  },
  {
    key: "projectName",
    label: "Project name",
    policy: { kind: "required" },
    sampleValue: "Sample Project",
  },
  {
    key: "volunteerId",
    label: "Volunteer ID",
    policy: { kind: "required" },
    sampleValue: "4821",
  },
  {
    key: "esriUsername",
    label: "Esri username",
    policy: { kind: "required" },
    sampleValue: "arivera_advsci",
  },
] as const satisfies readonly AutomatedEmailMergeField[];

/**
 * Builds a value set covering EVERY catalog field, for surfaces that render a
 * template without a Salesforce record behind it (preview, test send).
 *
 * Overrides win where supplied; every other key falls back to the field's
 * `sampleValue`. Because the result is derived from the catalog rather than a
 * hand-written key list, a template can never fail to preview because a newly
 * added merge field was forgotten here — the bug that made 61 of the 122
 * Salesforce-imported drafts unpreviewable on 2026-09-02.
 */
export function buildAutomatedEmailSampleValues(
  overrides: AutomatedEmailMergeValues = {},
): Record<AutomatedEmailMergeFieldKey, string> {
  const values = {} as Record<AutomatedEmailMergeFieldKey, string>;
  for (const field of AUTOMATED_EMAIL_MERGE_FIELDS) {
    const override = overrides[field.key];
    values[field.key] =
      override !== undefined && override.length > 0
        ? override
        : field.sampleValue;
  }

  return values;
}

/** Human label for a merge key, for operator-facing messages. */
export function automatedEmailMergeFieldLabel(key: string): string {
  return (
    AUTOMATED_EMAIL_MERGE_FIELDS.find((field) => field.key === key)?.label ??
    key
  );
}

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
    volunteerId: coalesce(
      readRelatedString(row, "Contact__r", "Volunteer_ID_Plain__c"),
      readRelatedString(row, "Contact__r", "Volunteer_ID__c"),
    ),
    esriUsername: readTrimmedString(row.Esri_Username__c),
  };
}

function buildExpeditionMemberQuery(expeditionMemberId: string): string {
  return `SELECT Id, First_Name__c, Last_Name__c, Email__c, Esri_Username__c, Contact__c, Contact__r.FirstName, Contact__r.LastName, Contact__r.Email, Contact__r.Volunteer_ID_Plain__c, Contact__r.Volunteer_ID__c, Expedition__r.Name FROM Expedition_Members__c WHERE Id = '${expeditionMemberId}'`;
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
