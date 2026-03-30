import {
  simpleTextingHistoricalCaptureBatchPayloadSchema,
  simpleTextingLiveCaptureBatchPayloadSchema,
  type SimpleTextingHistoricalCaptureBatchPayload,
  type SimpleTextingLiveCaptureBatchPayload
} from "@as-comms/contracts";

import {
  simpleTextingRecordSchema,
  type SimpleTextingRecord
} from "../providers/simpletexting.js";
import {
  type CapturedBatchResponse,
  createCapturedBatchResponseSchema,
  requestCaptureBatch,
  type CapturePortHttpConfig,
  type FetchImplementation
} from "./shared.js";

const simpleTextingCapturedBatchSchema = createCapturedBatchResponseSchema(
  simpleTextingRecordSchema
);

export function createSimpleTextingCapturePort(
  config: CapturePortHttpConfig,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
  }
): {
  captureHistoricalBatch(
    payload: SimpleTextingHistoricalCaptureBatchPayload
  ): Promise<CapturedBatchResponse<SimpleTextingRecord>>;
  captureLiveBatch(
    payload: SimpleTextingLiveCaptureBatchPayload
  ): Promise<CapturedBatchResponse<SimpleTextingRecord>>;
} {
  return {
    captureHistoricalBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/historical",
        payload,
        payloadSchema: simpleTextingHistoricalCaptureBatchPayloadSchema,
        responseSchema: simpleTextingCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    },
    captureLiveBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/live",
        payload,
        payloadSchema: simpleTextingLiveCaptureBatchPayloadSchema,
        responseSchema: simpleTextingCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    }
  };
}
