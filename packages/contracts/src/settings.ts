import { z } from "zod";

export const createProjectAliasSchema = z.object({
  alias: z.string().email(),
  projectId: z.string().nullable()
});
export type CreateProjectAliasInput = z.infer<typeof createProjectAliasSchema>;

export const updateProjectAliasSchema = z.object({
  id: z.string().min(1),
  alias: z.string().email(),
  projectId: z.string().nullable()
});
export type UpdateProjectAliasInput = z.infer<typeof updateProjectAliasSchema>;

export const deleteProjectAliasSchema = z.object({
  id: z.string().min(1)
});
export type DeleteProjectAliasInput = z.infer<typeof deleteProjectAliasSchema>;

export const promoteUserSchema = z.object({
  id: z.string().min(1)
});
export type PromoteUserInput = z.infer<typeof promoteUserSchema>;

export const demoteUserSchema = z.object({
  id: z.string().min(1)
});
export type DemoteUserInput = z.infer<typeof demoteUserSchema>;

export const deactivateUserSchema = z.object({
  id: z.string().min(1)
});
export type DeactivateUserInput = z.infer<typeof deactivateUserSchema>;

export const reactivateUserSchema = z.object({
  id: z.string().min(1)
});
export type ReactivateUserInput = z.infer<typeof reactivateUserSchema>;
