import {
  gmailHistoricalCaptureBatchPayloadSchema,
  gmailLiveCaptureBatchPayloadSchema,
  type GmailHistoricalCaptureBatchPayload,
  type GmailLiveCaptureBatchPayload
} from "@as-comms/contracts";

import { gmailRecordSchema, type GmailRecord } from "../providers/gmail.js";
import {
  type CapturedBatchResponse,
  createCapturedBatchResponseSchema,
  requestCaptureBatch,
  type CapturePortHttpConfig,
  type FetchImplementation
} from "./shared.js";

const gmailCapturedBatchSchema = createCapturedBatchResponseSchema(gmailRecordSchema);

export function createGmailCapturePort(
  config: CapturePortHttpConfig,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
  }
): {
  captureHistoricalBatch(
    payload: GmailHistoricalCaptureBatchPayload
  ): Promise<CapturedBatchResponse<GmailRecord>>;
  captureLiveBatch(
    payload: GmailLiveCaptureBatchPayload
  ): Promise<CapturedBatchResponse<GmailRecord>>;
} {
  return {
    captureHistoricalBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/historical",
        payload,
        payloadSchema: gmailHistoricalCaptureBatchPayloadSchema,
        responseSchema: gmailCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    },
    captureLiveBatch(payload) {
      return requestCaptureBatch({
        config,
        path: "/live",
        payload,
        payloadSchema: gmailLiveCaptureBatchPayloadSchema,
        responseSchema: gmailCapturedBatchSchema,
        fetchImplementation: input?.fetchImplementation
      });
    }
  };
}
