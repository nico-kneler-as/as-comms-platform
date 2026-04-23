import { z } from "zod";

import {
  normalizedCanonicalEventIntakeSchema,
  normalizedContactGraphUpsertInputSchema,
  providerSchema,
  type NormalizedCanonicalEventIntake,
  type NormalizedContactGraphUpsertInput,
  type Provider
} from "@as-comms/contracts";

const idSchema = z.string().min(1);

export const supportingProviderRecordSchema = z.object({
  provider: providerSchema,
  providerRecordType: z.string().min(1),
  providerRecordId: z.string().min(1)
});
export type SupportingProviderRecord = z.infer<
  typeof supportingProviderRecordSchema
>;

export const providerMappingDeferredReasonValues = [
  "unsupported_record_type",
  "deferred_record_family",
  "skipped_by_policy"
] as const;
export const providerMappingDeferredReasonSchema = z.enum(
  providerMappingDeferredReasonValues
);
export type ProviderMappingDeferredReason = z.infer<
  typeof providerMappingDeferredReasonSchema
>;

export interface CanonicalEventMappingCommand {
  readonly kind: "canonical_event";
  readonly input: NormalizedCanonicalEventIntake;
}

export interface ContactGraphMappingCommand {
  readonly kind: "contact_graph";
  readonly input: NormalizedContactGraphUpsertInput;
}

export type ProviderMappingCommand =
  | CanonicalEventMappingCommand
  | ContactGraphMappingCommand;

interface ProviderMappingBase {
  readonly provider: Provider;
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
}

export interface ProviderCommandMappingResult extends ProviderMappingBase {
  readonly outcome: "command";
  readonly command: ProviderMappingCommand;
}

export interface ProviderDeferredMappingResult extends ProviderMappingBase {
  readonly outcome: "deferred";
  readonly reason: ProviderMappingDeferredReason;
  readonly detail: string;
}

export type ProviderMappingResult =
  | ProviderCommandMappingResult
  | ProviderDeferredMappingResult;

export function createCanonicalEventCommand(
  input: NormalizedCanonicalEventIntake
): CanonicalEventMappingCommand {
  return {
    kind: "canonical_event",
    input: normalizedCanonicalEventIntakeSchema.parse(input)
  };
}

export function createContactGraphCommand(
  input: NormalizedContactGraphUpsertInput
): ContactGraphMappingCommand {
  return {
    kind: "contact_graph",
    input: normalizedContactGraphUpsertInputSchema.parse(input)
  };
}

export function createCommandMappingResult(input: {
  readonly provider: Provider;
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
  readonly command: ProviderMappingCommand;
}): ProviderCommandMappingResult {
  return {
    outcome: "command",
    provider: input.provider,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: idSchema.parse(input.sourceRecordId),
    command: input.command
  };
}

export function createDeferredMappingResult(input: {
  readonly provider: Provider;
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
  readonly reason: ProviderMappingDeferredReason;
  readonly detail: string;
}): ProviderDeferredMappingResult {
  return {
    outcome: "deferred",
    provider: input.provider,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: idSchema.parse(input.sourceRecordId),
    reason: providerMappingDeferredReasonSchema.parse(input.reason),
    detail: z.string().min(1).parse(input.detail)
  };
}
