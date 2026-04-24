// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./libmime.d.ts" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./mailparser.d.ts" />

export * from "./provider-types.js";
export * from "./shared.js";
export {
  classifySalesforceTaskMessageKind,
  parseSubjectDirection,
  type SalesforceTaskMessageKindClassification,
  type SalesforceTaskMessageKindClassificationInput
} from "./providers/salesforce.js";
export * from "./capture/shared.js";
export * from "./capture/gmail.js";
export * from "./capture/mailchimp.js";
export * from "./capture/salesforce.js";
export * from "./capture/simpletexting.js";
export * from "./capture-services/shared.js";
export * from "./capture-services/gmail.js";
export * from "./capture-services/salesforce.js";
export * from "./providers/gmail.js";
export * from "./providers/gmail-body.js";
export * from "./providers/gmail-mbox.js";
export * from "./providers/gmail-send.js";
export * from "./providers/gmail-record-builder.js";
export * from "./providers/mailchimp.js";
export * from "./providers/anthropic.js";
export * from "./providers/notion.js";
export * from "./providers/salesforce.js";
export * from "./providers/simpletexting.js";
