import {
  mailchimpHistoricalCaptureBatchPayloadSchema,
  mailchimpTransitionCaptureBatchPayloadSchema,
  type MailchimpHistoricalCaptureBatchPayload,
  type MailchimpTransitionCaptureBatchPayload
} from "@as-comms/contracts";

import {
  mailchimpRecordSchema,
  type MailchimpRecord
} from "../providers/mailchimp.js";
import {
  type CapturedBatchResponse,
  createCapturedBatchResponseSchema,
  requestCaptureBatch,
  type CapturePortHttpConfig,
  type FetchImplementation
} from "./shared.js";

const mailchimpCapturedBatchSchema = createCapturedBatchResponseSchema(
  mailchimpRecordSchema
);

export function createMailchimpCapturePort(
  config: CapturePortHttpConfig,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
  }
): {
  captureHistoricalBatch(
    payload: MailchimpHistoricalCaptureBatchPayload
  ): Promise<CapturedBatchResponse<MailchimpRecord>>;
  captureTransitionBatch(
    payload: MailchimpTransitionCaptureBatchPayload
  ): Promise<CapturedBatchResponse<MailchimpRecord>>;
} {
  return {
    captureHistoricalBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/historical",
        payload,
        payloadSchema: mailchimpHistoricalCaptureBatchPayloadSchema,
        responseSchema: mailchimpCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    },
    captureTransitionBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/transition",
        payload,
        payloadSchema: mailchimpTransitionCaptureBatchPayloadSchema,
        responseSchema: mailchimpCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    }
  };
}
