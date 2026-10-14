import {
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema,
  salesforceAudienceListsCaptureRequestSchema,
  salesforceAudienceListsCaptureResponseSchema,
  type SalesforceHistoricalCaptureBatchPayload,
  type SalesforceLiveCaptureBatchPayload,
  type SalesforceAudienceListsCaptureRequest,
  type SalesforceAudienceListsSnapshot
} from "@as-comms/contracts";

import {
  salesforceRecordSchema,
  type SalesforceRecord
} from "../providers/salesforce.js";
import {
  type CapturedBatchResponse,
  createCapturedBatchResponseSchema,
  requestCaptureBatch,
  type CapturePortHttpConfig,
  type FetchImplementation
} from "./shared.js";

const salesforceCapturedBatchSchema = createCapturedBatchResponseSchema(
  salesforceRecordSchema
);

export function createSalesforceCapturePort(
  config: CapturePortHttpConfig,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
  }
): {
  captureHistoricalBatch(
    payload: SalesforceHistoricalCaptureBatchPayload
  ): Promise<CapturedBatchResponse<SalesforceRecord>>;
  captureLiveBatch(
    payload: SalesforceLiveCaptureBatchPayload
  ): Promise<CapturedBatchResponse<SalesforceRecord>>;
  captureAudienceLists(
    payload: SalesforceAudienceListsCaptureRequest
  ): Promise<SalesforceAudienceListsSnapshot>;
} {
  return {
    captureHistoricalBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/historical",
        payload,
        payloadSchema: salesforceHistoricalCaptureBatchPayloadSchema,
        responseSchema: salesforceCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    },
    captureLiveBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/live",
        payload,
        payloadSchema: salesforceLiveCaptureBatchPayloadSchema,
        responseSchema: salesforceCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    },
    captureAudienceLists(payload) {
      return requestCaptureBatch({
        config,
        path: "/audience-lists",
        payload,
        payloadSchema: salesforceAudienceListsCaptureRequestSchema,
        responseSchema: salesforceAudienceListsCaptureResponseSchema,
        fetchImplementation: input?.fetchImplementation
      });
    }
  };
}
