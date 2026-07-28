import { z } from "zod";

const timestampSchema = z.string().datetime();

export const dependencyAuditSummaryId = "dependency_audit_latest" as const;

export const dependencyAuditSeveritySchema = z.enum([
  "low",
  "moderate",
  "high",
  "critical",
]);
export type DependencyAuditSeverity = z.infer<
  typeof dependencyAuditSeveritySchema
>;

export const dependencyAuditDependencyTypeSchema = z.enum([
  "direct",
  "transitive",
]);
export type DependencyAuditDependencyType = z.infer<
  typeof dependencyAuditDependencyTypeSchema
>;

export const dependencyAuditAdvisorySchema = z.object({
  ghsaId: z.string().min(1),
  packageName: z.string().min(1),
  severity: dependencyAuditSeveritySchema,
  vulnerableRange: z.string().min(1),
  patchedRange: z.string().min(1),
  dependencyType: dependencyAuditDependencyTypeSchema,
});
export type DependencyAuditAdvisory = z.infer<
  typeof dependencyAuditAdvisorySchema
>;

export const dependencyAuditSummaryPayloadSchema = z.object({
  generatedAt: timestampSchema,
  exitStatus: z.number().int().nonnegative(),
  advisories: z.array(dependencyAuditAdvisorySchema),
});
export type DependencyAuditSummaryPayload = z.infer<
  typeof dependencyAuditSummaryPayloadSchema
>;

export const dependencyAuditSummaryRecordSchema = z.object({
  id: z.literal(dependencyAuditSummaryId),
  generatedAt: timestampSchema,
  exitStatus: z.number().int().nonnegative(),
  advisories: z.array(dependencyAuditAdvisorySchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type DependencyAuditSummaryRecord = z.infer<
  typeof dependencyAuditSummaryRecordSchema
>;
