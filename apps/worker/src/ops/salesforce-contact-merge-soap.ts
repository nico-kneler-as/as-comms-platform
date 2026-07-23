function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function readFirstTagValue(xml: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`,
    "iu",
  );
  const match = pattern.exec(xml);

  if (match === null) {
    return null;
  }

  return decodeXml(match[1] ?? "").trim();
}

function readAllTagBlocks(xml: string, tagName: string): readonly string[] {
  const pattern = new RegExp(
    `<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`,
    "giu",
  );
  const blocks: string[] = [];

  for (const match of xml.matchAll(pattern)) {
    const block = match[1];

    if (typeof block === "string") {
      blocks.push(block);
    }
  }

  return blocks;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function isPermissionIssue(input: {
  readonly code: string | null;
  readonly message: string;
}): boolean {
  return /(insufficient_access|readonly|permission|merge)/iu.test(
    `${input.code ?? ""} ${input.message}`,
  );
}

export class SalesforceContactMergePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesforceContactMergePermissionError";
  }
}

export class SalesforceContactMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesforceContactMergeError";
  }
}

export interface SalesforceContactMergeSoapResponseSuccess {
  readonly kind: "success";
}

export interface SalesforceContactMergeSoapResponseError {
  readonly kind: "error";
  readonly code: string | null;
  readonly message: string;
}

export type SalesforceContactMergeSoapResponse =
  | SalesforceContactMergeSoapResponseSuccess
  | SalesforceContactMergeSoapResponseError;

export function buildSalesforceContactMergeEnvelope(input: {
  readonly sessionId: string;
  readonly masterContactId: string;
  readonly duplicateContactId: string;
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">',
    "<env:Header>",
    '<n1:SessionHeader xmlns:n1="urn:partner.soap.sforce.com">',
    `<n1:sessionId>${escapeXml(input.sessionId)}</n1:sessionId>`,
    "</n1:SessionHeader>",
    "</env:Header>",
    "<env:Body>",
    '<n1:merge xmlns:n1="urn:partner.soap.sforce.com">',
    "<n1:request>",
    '<n1:masterRecord xsi:type="n1:sObject">',
    "<n1:type>Contact</n1:type>",
    `<n1:Id>${escapeXml(input.masterContactId)}</n1:Id>`,
    "</n1:masterRecord>",
    `<n1:recordToMergeIds>${escapeXml(input.duplicateContactId)}</n1:recordToMergeIds>`,
    "</n1:request>",
    "</n1:merge>",
    "</env:Body>",
    "</env:Envelope>",
  ].join("");
}

export function parseSalesforceContactMergeResponse(
  xml: string,
): SalesforceContactMergeSoapResponse {
  if (
    /<(?:\w+:)?success>\s*true\s*<\/(?:\w+:)?success>/iu.test(xml)
  ) {
    return {
      kind: "success",
    };
  }

  const faultString = readFirstTagValue(xml, "faultstring");

  if (faultString !== null) {
    return {
      kind: "error",
      code: readFirstTagValue(xml, "faultcode"),
      message: faultString,
    };
  }

  const [firstErrorBlock] = readAllTagBlocks(xml, "errors");

  if (firstErrorBlock !== undefined) {
    return {
      kind: "error",
      code: readFirstTagValue(firstErrorBlock, "statusCode"),
      message:
        readFirstTagValue(firstErrorBlock, "message") ??
        "Salesforce merge returned an unspecified error.",
    };
  }

  return {
    kind: "error",
    code: null,
    message: "Salesforce merge returned an unrecognized SOAP response.",
  };
}

function buildPermissionErrorMessage(input: {
  readonly code: string | null;
  readonly message: string;
}): string {
  const suffix =
    input.code === null ? input.message : `${input.code}: ${input.message}`;

  return `Salesforce merge permission error. The integration user likely lacks Contact merge rights or access to one of the records. Salesforce said: ${suffix}. Grant the needed Contact merge permission and record access, then retry.`;
}

export async function mergeSalesforceContactPairViaSoap(input: {
  readonly instanceUrl: string;
  readonly apiVersion: string;
  readonly sessionId: string;
  readonly masterContactId: string;
  readonly duplicateContactId: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<void> {
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new SalesforceContactMergeError(
      "Global fetch is unavailable for Salesforce Contact merge.",
    );
  }

  const endpoint = new URL(
    `/services/Soap/u/${input.apiVersion}`,
    input.instanceUrl,
  ).toString();
  const requestBody = buildSalesforceContactMergeEnvelope({
    sessionId: input.sessionId,
    masterContactId: input.masterContactId,
    duplicateContactId: input.duplicateContactId,
  });

  let response: Response;

  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        accept: "text/xml",
        "content-type": "text/xml; charset=utf-8",
        // Salesforce's SOAP endpoint rejects requests without a SOAPAction
        // header (HTTP 500 soapenv:Client "SOAPAction HTTP header missing").
        // The value is ignored but the header must be present; the empty
        // quoted string is the documented convention.
        soapaction: '""',
      },
      body: requestBody,
      signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new SalesforceContactMergeError(
        "Salesforce Contact merge request timed out.",
      );
    }

    throw new SalesforceContactMergeError(
      "Salesforce Contact merge request failed.",
    );
  }

  const responseText = await response.text();
  const parsed = parseSalesforceContactMergeResponse(responseText);

  if (parsed.kind === "success") {
    return;
  }

  if (isPermissionIssue(parsed)) {
    throw new SalesforceContactMergePermissionError(
      buildPermissionErrorMessage(parsed),
    );
  }

  const statusPrefix = response.ok
    ? "Salesforce Contact merge failed"
    : `Salesforce Contact merge failed with HTTP ${String(response.status)}`;
  const codeSuffix = parsed.code === null ? "" : ` (${parsed.code})`;

  throw new SalesforceContactMergeError(
    `${statusPrefix}${codeSuffix}: ${parsed.message}`,
  );
}
