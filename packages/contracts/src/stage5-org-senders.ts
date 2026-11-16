import { z } from "zod";

const orgSenderIdValueSchema = z.string().uuid();
const orgSenderEmailSchema = z.string().trim().email();
const orgSenderLabelSchema = z.string().min(1);
const orgSenderDisplayNameSchema = z.string().trim().min(1).max(100);
const timestampSchema = z.string().datetime();

export const orgSenderRecordSchema = z.object({
  id: orgSenderIdValueSchema,
  email: orgSenderEmailSchema,
  label: orgSenderLabelSchema,
  displayName: orgSenderDisplayNameSchema,
  enabled: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createOrgSenderInputSchema = z.object({
  email: orgSenderEmailSchema,
  label: orgSenderLabelSchema,
  displayName: orgSenderDisplayNameSchema,
});

export const updateOrgSenderInputSchema = z.object({
  label: orgSenderLabelSchema.optional(),
  displayName: orgSenderDisplayNameSchema.optional(),
  enabled: z.boolean().optional(),
});

export const orgSenderIdSchema = orgSenderIdValueSchema;

export type OrgSenderRecord = z.infer<typeof orgSenderRecordSchema>;
export type OrgSenderRecordInput = z.input<typeof orgSenderRecordSchema>;
export type CreateOrgSenderInput = z.infer<typeof createOrgSenderInputSchema>;
export type CreateOrgSenderInputValue = z.input<
  typeof createOrgSenderInputSchema
>;
export type UpdateOrgSenderInput = z.infer<typeof updateOrgSenderInputSchema>;
export type UpdateOrgSenderInputValue = z.input<
  typeof updateOrgSenderInputSchema
>;
export type OrgSenderId = z.infer<typeof orgSenderIdSchema>;
