import { describe, expect, it } from "vitest";

import {
  AUTOMATED_EMAIL_MERGE_FIELDS,
  type AutomatedEmailMergeFieldKey,
  type AutomatedEmailSalesforceClient,
  resolveAutomatedEmailMergeFields,
  UnknownAutomatedEmailMergeFieldError,
} from "../src/automated-email-merge.js";

const validFifteenCharacterId = "001ABCDEF123456";
const validEighteenCharacterId = "001ABCDEF123456789";

class FakeSalesforceClient implements AutomatedEmailSalesforceClient {
  readonly queries: string[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  queryAll(soql: string): Promise<readonly Record<string, unknown>[]> {
    this.queries.push(soql);
    return Promise.resolve(this.rows);
  }
}

function resolve(
  client: AutomatedEmailSalesforceClient,
  keys: readonly AutomatedEmailMergeFieldKey[] = [
    "firstName",
    "lastName",
    "email",
    "projectName",
  ],
  expeditionMemberId = validFifteenCharacterId,
) {
  return resolveAutomatedEmailMergeFields(client, expeditionMemberId, keys);
}

describe("resolveAutomatedEmailMergeFields", () => {
  it("publishes the new required fields in the shared picker catalog", () => {
    expect(AUTOMATED_EMAIL_MERGE_FIELDS).toEqual(
      expect.arrayContaining([
        {
          key: "volunteerId",
          label: "Volunteer ID",
          policy: { kind: "required" },
        },
        {
          key: "esriUsername",
          label: "Esri username",
          policy: { kind: "required" },
        },
      ]),
    );
  });

  it.each([validFifteenCharacterId, validEighteenCharacterId])(
    "accepts a %s Salesforce ID",
    async (expeditionMemberId) => {
      const client = new FakeSalesforceClient([]);

      await expect(resolve(client, [], expeditionMemberId)).resolves.toEqual({
        outcome: "not_found",
      });
      expect(client.queries).toHaveLength(1);
    },
  );

  it.each(["'; DROP", "", "001ABCDEF12345678"])(
    "rejects invalid ID %j without querying Salesforce",
    async (expeditionMemberId) => {
      const client = new FakeSalesforceClient([]);

      await expect(resolve(client, [], expeditionMemberId)).resolves.toEqual({
        outcome: "invalid_id",
      });
      expect(client.queries).toEqual([]);
    },
  );

  it("uses linked Contact values before expedition-member fallbacks", async () => {
    const client = new FakeSalesforceClient([
      {
        Contact__c: "003CONTACT",
        Contact__r: {
          FirstName: "  Casey  ",
          LastName: "  Rivera ",
          Email: " casey@example.org ",
        },
        First_Name__c: "Fallback first",
        Last_Name__c: "Fallback last",
        Email__c: "fallback@example.org",
        Expedition__r: { Name: "  Sea Turtles  " },
      },
    ]);

    await expect(resolve(client)).resolves.toEqual({
      outcome: "resolved",
      contactId: "003CONTACT",
      recipientEmail: "casey@example.org",
      values: {
        firstName: "Casey",
        lastName: "Rivera",
        email: "casey@example.org",
        projectName: "Sea Turtles",
      },
      missingRequired: [],
    });
  });

  it("uses expedition-member fields when no linked Contact is returned", async () => {
    const client = new FakeSalesforceClient([
      {
        First_Name__c: " Taylor ",
        Last_Name__c: " Green ",
        Email__c: " taylor@example.org ",
        Expedition__r: { Name: "Forest Watch" },
      },
    ]);

    await expect(resolve(client)).resolves.toMatchObject({
      outcome: "resolved",
      contactId: null,
      recipientEmail: "taylor@example.org",
      values: {
        firstName: "Taylor",
        lastName: "Green",
        email: "taylor@example.org",
        projectName: "Forest Watch",
      },
      missingRequired: [],
    });
  });

  it("falls through empty linked Contact fields", async () => {
    const client = new FakeSalesforceClient([
      {
        Contact__r: { FirstName: "  ", LastName: "", Email: " \t " },
        First_Name__c: "Taylor",
        Last_Name__c: "Green",
        Email__c: "taylor@example.org",
        Expedition__r: { Name: "Forest Watch" },
      },
    ]);

    await expect(resolve(client)).resolves.toMatchObject({
      outcome: "resolved",
      recipientEmail: "taylor@example.org",
      values: {
        firstName: "Taylor",
        lastName: "Green",
        email: "taylor@example.org",
      },
    });
  });

  it("applies the catalog fallbacks for missing optional fields", async () => {
    const client = new FakeSalesforceClient([
      { Expedition__r: { Name: "Forest Watch" } },
    ]);

    await expect(resolve(client, ["firstName", "lastName"])).resolves.toEqual({
      outcome: "resolved",
      contactId: null,
      recipientEmail: null,
      values: { firstName: "there", lastName: "" },
      missingRequired: [],
    });
  });

  it("reports missing required values without failing the resolution", async () => {
    const client = new FakeSalesforceClient([{}]);

    await expect(resolve(client, ["email", "projectName"])).resolves.toEqual({
      outcome: "resolved",
      contactId: null,
      recipientEmail: null,
      values: {},
      missingRequired: ["email", "projectName"],
    });
  });

  it("resolves the required volunteer ID fallback chain and Esri username", async () => {
    const client = new FakeSalesforceClient([
      {
        Contact__r: {
          Volunteer_ID_Plain__c: " ",
          Volunteer_ID__c: " encrypted-id ",
        },
        Esri_Username__c: " field-user ",
      },
    ]);

    await expect(
      resolve(client, ["volunteerId", "esriUsername"]),
    ).resolves.toEqual({
      outcome: "resolved",
      contactId: null,
      recipientEmail: null,
      values: { volunteerId: "encrypted-id", esriUsername: "field-user" },
      missingRequired: [],
    });
  });

  it("reports new catalog fields as required when Salesforce does not supply them", async () => {
    const client = new FakeSalesforceClient([{}]);

    await expect(
      resolve(client, ["volunteerId", "esriUsername"]),
    ).resolves.toMatchObject({
      outcome: "resolved",
      values: {},
      missingRequired: ["volunteerId", "esriUsername"],
    });
  });

  it("returns not_found when Salesforce returns no expedition member", async () => {
    const client = new FakeSalesforceClient([]);

    await expect(resolve(client)).resolves.toEqual({ outcome: "not_found" });
  });

  it("surfaces recipient email even when email was not requested", async () => {
    const client = new FakeSalesforceClient([
      {
        Contact__c: "003CONTACT",
        Email__c: "recipient@example.org",
        Expedition__r: { Name: "Forest Watch" },
      },
    ]);

    await expect(resolve(client, ["projectName"])).resolves.toEqual({
      outcome: "resolved",
      contactId: "003CONTACT",
      recipientEmail: "recipient@example.org",
      values: { projectName: "Forest Watch" },
      missingRequired: [],
    });
  });

  it("emits the exact expedition-member query and includes the ID once", async () => {
    const client = new FakeSalesforceClient([]);

    await resolve(client);

    expect(client.queries).toEqual([
      "SELECT Id, First_Name__c, Last_Name__c, Email__c, Esri_Username__c, Contact__c, Contact__r.FirstName, Contact__r.LastName, Contact__r.Email, Contact__r.Volunteer_ID_Plain__c, Contact__r.Volunteer_ID__c, Expedition__r.Name FROM Expedition_Members__c WHERE Id = '001ABCDEF123456'",
    ]);
    expect(client.queries[0]?.match(/001ABCDEF123456/gu)).toHaveLength(1);
  });

  it("throws a typed error for an unknown merge field", async () => {
    const client = new FakeSalesforceClient([]);

    await expect(
      resolve(client, ["unknown" as AutomatedEmailMergeFieldKey]),
    ).rejects.toBeInstanceOf(UnknownAutomatedEmailMergeFieldError);
    expect(client.queries).toEqual([]);
  });
});
