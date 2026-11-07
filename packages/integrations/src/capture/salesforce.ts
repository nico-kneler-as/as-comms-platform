import {
  salesforceHistoricalCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema,
  salesforceAudienceListsCaptureRequestSchema,
  salesforceAudienceListsCaptureResponseSchema,
  salesforceContactStatesCaptureRequestSchema,
  salesforceContactStatesCaptureResponseSchema,
  salesforceProjectBoxesSyncPayloadSchema,
  salesforceProjectBoxesCaptureResponseSchema,
  salesforceSubscriptionPreferencesCaptureRequestSchema,
  salesforceSubscriptionPreferencesCaptureResponseSchema,
  type SalesforceHistoricalCaptureBatchPayload,
  type SalesforceLiveCaptureBatchPayload,
  type SalesforceAudienceListsCaptureRequest,
  type SalesforceAudienceListsSnapshot,
  type SalesforceContactStatesCaptureRequest,
  type SalesforceContactStatesSnapshot,
  type SalesforceProjectBoxesCaptureResponse,
  type SalesforceSubscriptionPreferencesCaptureRequest,
  type SalesforceSubscriptionPreferencesCaptureResponse,
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

const SALESFORCE_CONTACT_STATES_MIN_TIMEOUT_MS = 120_000;
const SALESFORCE_SUBSCRIPTION_PREFERENCES_MIN_TIMEOUT_MS = 120_000;

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
  captureContactStates(
    payload: SalesforceContactStatesCaptureRequest
  ): Promise<SalesforceContactStatesSnapshot>;
  captureProjectSubscriptionBoxes(payload: {
    readonly version: 1;
  }): Promise<SalesforceProjectBoxesCaptureResponse>;
  captureSubscriptionPreferences(
    payload: SalesforceSubscriptionPreferencesCaptureRequest,
  ): Promise<SalesforceSubscriptionPreferencesCaptureResponse>;
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
    },
    captureContactStates(payload) {
      return requestCaptureBatch({
        // Full-table snapshot (~21K contacts, ~11 Salesforce pages): the
        // default 15s capture timeout is sized for incremental batches.
        config: {
          ...config,
          timeoutMs: Math.max(
            config.timeoutMs,
            SALESFORCE_CONTACT_STATES_MIN_TIMEOUT_MS
          )
        },
        path: "/contact-states",
        payload,
        payloadSchema: salesforceContactStatesCaptureRequestSchema,
        responseSchema: salesforceContactStatesCaptureResponseSchema,
        fetchImplementation: input?.fetchImplementation
      });
    },
    captureProjectSubscriptionBoxes(payload) {
      return requestCaptureBatch({
        config,
        path: "/project-subscription-boxes",
        payload,
        payloadSchema: salesforceProjectBoxesSyncPayloadSchema,
        responseSchema: salesforceProjectBoxesCaptureResponseSchema,
        fetchImplementation: input?.fetchImplementation,
      });
    },
    captureSubscriptionPreferences(payload) {
      return requestCaptureBatch({
        config: {
          ...config,
          timeoutMs: Math.max(config.timeoutMs, SALESFORCE_SUBSCRIPTION_PREFERENCES_MIN_TIMEOUT_MS),
        },
        path: "/subscription-preferences",
        payload,
        payloadSchema: salesforceSubscriptionPreferencesCaptureRequestSchema,
        responseSchema: salesforceSubscriptionPreferencesCaptureResponseSchema,
        fetchImplementation: input?.fetchImplementation,
      });
    },
  };
}
