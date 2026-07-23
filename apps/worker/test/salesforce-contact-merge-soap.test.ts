import { describe, expect, it } from "vitest";

import {
  buildSalesforceContactMergeEnvelope,
  parseSalesforceContactMergeResponse,
} from "../src/ops/salesforce-contact-merge-soap.js";

describe("salesforce-contact-merge-soap", () => {
  it("builds a Contact merge envelope with the session header and both record ids", () => {
    const envelope = buildSalesforceContactMergeEnvelope({
      sessionId: "session-123",
      masterContactId: "003000000000000AAA",
      duplicateContactId: "003000000000000AAB",
    });

    expect(envelope).toContain("<n1:sessionId>session-123</n1:sessionId>");
    expect(envelope).toContain("<n1:type>Contact</n1:type>");
    expect(envelope).toContain("<n1:Id>003000000000000AAA</n1:Id>");
    expect(envelope).toContain(
      "<n1:recordToMergeIds>003000000000000AAB</n1:recordToMergeIds>",
    );
  });

  it("parses a successful merge response", () => {
    const parsed = parseSalesforceContactMergeResponse(`
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <mergeResponse xmlns="urn:partner.soap.sforce.com">
            <result>
              <id>003000000000000AAA</id>
              <success>true</success>
            </result>
          </mergeResponse>
        </soapenv:Body>
      </soapenv:Envelope>
    `);

    expect(parsed).toEqual({
      kind: "success",
    });
  });

  it("parses merge errors from SOAP fixtures", () => {
    const parsed = parseSalesforceContactMergeResponse(`
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <mergeResponse xmlns="urn:partner.soap.sforce.com">
            <result>
              <success>false</success>
              <errors>
                <statusCode>INSUFFICIENT_ACCESS_OR_READONLY</statusCode>
                <message>insufficient access rights on cross-reference id</message>
              </errors>
            </result>
          </mergeResponse>
        </soapenv:Body>
      </soapenv:Envelope>
    `);

    expect(parsed).toEqual({
      kind: "error",
      code: "INSUFFICIENT_ACCESS_OR_READONLY",
      message: "insufficient access rights on cross-reference id",
    });
  });
});
