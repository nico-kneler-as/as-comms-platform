import {
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema,
  type SalesforceHistoricalCaptureBatchPayload,
  type SalesforceLiveCaptureBatchPayload
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
    }
  };
}
