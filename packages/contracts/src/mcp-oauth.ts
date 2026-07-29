import { z } from "zod";

const timestampSchema = z.string().datetime();
const redirectUriSchema = z.string().url();
const redirectUriListSchema = z.array(redirectUriSchema).min(1);
const resourceSchema = z.string().url();

export const mcpOAuthClientRecordSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().min(1),
  clientSecretHash: z.string().min(1),
  name: z.string().min(1),
  allowedRedirectUris: redirectUriListSchema,
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createMcpOAuthClientInputSchema = z.object({
  clientId: z.string().min(1),
  clientSecretHash: z.string().min(1),
  name: z.string().min(1),
  allowedRedirectUris: redirectUriListSchema,
});

export const mcpOAuthAuthorizationCodeRecordSchema = z.object({
  id: z.string().uuid(),
  authorizationCodeHash: z.string().min(1),
  clientId: z.string().min(1),
  userId: z.string().min(1),
  redirectUri: redirectUriSchema,
  codeChallenge: z.string().min(1),
  scope: z.string().min(1),
  resource: resourceSchema,
  expiresAt: timestampSchema,
  consumedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createMcpOAuthAuthorizationCodeInputSchema = z.object({
  authorizationCodeHash: z.string().min(1),
  clientId: z.string().min(1),
  userId: z.string().min(1),
  redirectUri: redirectUriSchema,
  codeChallenge: z.string().min(1),
  scope: z.string().min(1),
  resource: resourceSchema,
  expiresAt: timestampSchema,
});

export const mcpOAuthTokenRecordSchema = z.object({
  id: z.string().uuid(),
  accessTokenHash: z.string().min(1),
  refreshTokenHash: z.string().min(1),
  clientId: z.string().min(1),
  userId: z.string().min(1),
  scope: z.string().min(1),
  resource: resourceSchema,
  tokenFamilyId: z.string().uuid(),
  authorizationCodeHash: z.string().min(1).nullable(),
  rotatedFromTokenId: z.string().uuid().nullable(),
  accessExpiresAt: timestampSchema,
  refreshExpiresAt: timestampSchema,
  rotatedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createMcpOAuthTokenInputSchema = z.object({
  accessTokenHash: z.string().min(1),
  refreshTokenHash: z.string().min(1),
  clientId: z.string().min(1),
  userId: z.string().min(1),
  scope: z.string().min(1),
  resource: resourceSchema,
  tokenFamilyId: z.string().uuid(),
  authorizationCodeHash: z.string().min(1).nullable().optional(),
  rotatedFromTokenId: z.string().uuid().nullable().optional(),
  accessExpiresAt: timestampSchema,
  refreshExpiresAt: timestampSchema,
});

export type McpOAuthClientRecord = z.infer<typeof mcpOAuthClientRecordSchema>;
export type CreateMcpOAuthClientInput = z.infer<
  typeof createMcpOAuthClientInputSchema
>;
export type McpOAuthAuthorizationCodeRecord = z.infer<
  typeof mcpOAuthAuthorizationCodeRecordSchema
>;
export type CreateMcpOAuthAuthorizationCodeInput = z.infer<
  typeof createMcpOAuthAuthorizationCodeInputSchema
>;
export type McpOAuthTokenRecord = z.infer<typeof mcpOAuthTokenRecordSchema>;
export type CreateMcpOAuthTokenInput = z.infer<
  typeof createMcpOAuthTokenInputSchema
>;
