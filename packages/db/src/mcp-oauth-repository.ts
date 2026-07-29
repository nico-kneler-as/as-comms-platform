import {
  and,
  eq,
  gt,
  isNull,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  CreateMcpOAuthAuthorizationCodeInput,
  CreateMcpOAuthClientInput,
  CreateMcpOAuthTokenInput,
  McpOAuthAuthorizationCodeRecord,
  McpOAuthClientRecord,
  McpOAuthTokenRecord,
} from "@as-comms/contracts";

import type { DatabaseConnection } from "./client.js";
import {
  mapMcpOAuthAuthorizationCodeInsert,
  mapMcpOAuthAuthorizationCodeRow,
  mapMcpOAuthClientInsert,
  mapMcpOAuthClientRow,
  mapMcpOAuthTokenInsert,
  mapMcpOAuthTokenRow,
  type McpOAuthAuthorizationCodeRow,
  type McpOAuthClientRow,
  type McpOAuthTokenRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import {
  mcpOAuthAuthorizationCodes,
  mcpOAuthClients,
  mcpOAuthTokens,
} from "./schema/index.js";

type McpOAuthDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

export interface RotateMcpOAuthRefreshTokenInput
  extends CreateMcpOAuthTokenInput {
  readonly rotatedFromRefreshTokenHash: string;
  readonly rotatedAt: Date;
}

function toMcpOAuthClientRow(
  row: typeof mcpOAuthClients.$inferSelect,
): McpOAuthClientRow {
  return {
    id: row.id,
    client_id: row.clientId,
    client_secret_hash: row.clientSecretHash,
    name: row.name,
    allowed_redirect_uris: row.allowedRedirectUris,
    revoked_at: row.revokedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toMcpOAuthAuthorizationCodeRow(
  row: typeof mcpOAuthAuthorizationCodes.$inferSelect,
): McpOAuthAuthorizationCodeRow {
  return {
    id: row.id,
    authorization_code_hash: row.authorizationCodeHash,
    client_id: row.clientId,
    user_id: row.userId,
    redirect_uri: row.redirectUri,
    code_challenge: row.codeChallenge,
    scope: row.scope,
    resource: row.resource,
    expires_at: row.expiresAt,
    consumed_at: row.consumedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toMcpOAuthTokenRow(
  row: typeof mcpOAuthTokens.$inferSelect,
): McpOAuthTokenRow {
  return {
    id: row.id,
    access_token_hash: row.accessTokenHash,
    refresh_token_hash: row.refreshTokenHash,
    client_id: row.clientId,
    user_id: row.userId,
    scope: row.scope,
    resource: row.resource,
    token_family_id: row.tokenFamilyId,
    authorization_code_hash: row.authorizationCodeHash,
    rotated_from_token_id: row.rotatedFromTokenId,
    access_expires_at: row.accessExpiresAt,
    refresh_expires_at: row.refreshExpiresAt,
    rotated_at: row.rotatedAt,
    revoked_at: row.revokedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function createMcpOAuthClient(
  db: McpOAuthDatabase,
  input: CreateMcpOAuthClientInput,
): Promise<McpOAuthClientRecord> {
  const values = mapMcpOAuthClientInsert(input);
  const [row] = await db.insert(mcpOAuthClients).values(values).returning();

  if (row === undefined) {
    throw new Error("Failed to create MCP OAuth client.");
  }

  return mapMcpOAuthClientRow(toMcpOAuthClientRow(row));
}

export async function findMcpOAuthClientByClientId(
  db: McpOAuthDatabase,
  clientId: string,
): Promise<McpOAuthClientRecord | null> {
  const [row] = await db
    .select()
    .from(mcpOAuthClients)
    .where(eq(mcpOAuthClients.clientId, clientId))
    .limit(1);

  return row === undefined ? null : mapMcpOAuthClientRow(toMcpOAuthClientRow(row));
}

export async function createMcpOAuthAuthorizationCode(
  db: McpOAuthDatabase,
  input: CreateMcpOAuthAuthorizationCodeInput,
): Promise<McpOAuthAuthorizationCodeRecord> {
  const values = mapMcpOAuthAuthorizationCodeInsert(input);
  const [row] = await db
    .insert(mcpOAuthAuthorizationCodes)
    .values(values)
    .returning();

  if (row === undefined) {
    throw new Error("Failed to create MCP OAuth authorization code.");
  }

  return mapMcpOAuthAuthorizationCodeRow(toMcpOAuthAuthorizationCodeRow(row));
}

export async function findMcpOAuthAuthorizationCodeByHash(
  db: McpOAuthDatabase,
  authorizationCodeHash: string,
): Promise<McpOAuthAuthorizationCodeRecord | null> {
  const [row] = await db
    .select()
    .from(mcpOAuthAuthorizationCodes)
    .where(eq(mcpOAuthAuthorizationCodes.authorizationCodeHash, authorizationCodeHash))
    .limit(1);

  return row === undefined
    ? null
    : mapMcpOAuthAuthorizationCodeRow(toMcpOAuthAuthorizationCodeRow(row));
}

export async function consumeMcpOAuthAuthorizationCode(
  db: McpOAuthDatabase,
  authorizationCodeHash: string,
  consumedAt: Date,
): Promise<McpOAuthAuthorizationCodeRecord | null> {
  const [row] = await db
    .update(mcpOAuthAuthorizationCodes)
    .set({
      consumedAt,
      updatedAt: consumedAt,
    })
    .where(
      and(
        eq(mcpOAuthAuthorizationCodes.authorizationCodeHash, authorizationCodeHash),
        isNull(mcpOAuthAuthorizationCodes.consumedAt),
        gt(mcpOAuthAuthorizationCodes.expiresAt, consumedAt),
      ),
    )
    .returning();

  return row === undefined
    ? null
    : mapMcpOAuthAuthorizationCodeRow(toMcpOAuthAuthorizationCodeRow(row));
}

export async function createMcpOAuthTokenFamily(
  db: McpOAuthDatabase,
  input: CreateMcpOAuthTokenInput,
): Promise<McpOAuthTokenRecord> {
  const values = mapMcpOAuthTokenInsert(input);
  const [row] = await db.insert(mcpOAuthTokens).values(values).returning();

  if (row === undefined) {
    throw new Error("Failed to create MCP OAuth token family row.");
  }

  return mapMcpOAuthTokenRow(toMcpOAuthTokenRow(row));
}

export async function findMcpOAuthTokenByAccessTokenHash(
  db: McpOAuthDatabase,
  accessTokenHash: string,
): Promise<McpOAuthTokenRecord | null> {
  const [row] = await db
    .select()
    .from(mcpOAuthTokens)
    .where(eq(mcpOAuthTokens.accessTokenHash, accessTokenHash))
    .limit(1);

  return row === undefined ? null : mapMcpOAuthTokenRow(toMcpOAuthTokenRow(row));
}

export async function findMcpOAuthTokenByRefreshTokenHash(
  db: McpOAuthDatabase,
  refreshTokenHash: string,
): Promise<McpOAuthTokenRecord | null> {
  const [row] = await db
    .select()
    .from(mcpOAuthTokens)
    .where(eq(mcpOAuthTokens.refreshTokenHash, refreshTokenHash))
    .limit(1);

  return row === undefined ? null : mapMcpOAuthTokenRow(toMcpOAuthTokenRow(row));
}

export async function rotateMcpOAuthRefreshToken(
  db: McpOAuthDatabase,
  input: RotateMcpOAuthRefreshTokenInput,
): Promise<McpOAuthTokenRecord | null> {
  return db.transaction(async (tx) => {
    const [rotatedRow] = await tx
      .update(mcpOAuthTokens)
      .set({
        rotatedAt: input.rotatedAt,
        updatedAt: input.rotatedAt,
      })
      .where(
        and(
          eq(mcpOAuthTokens.refreshTokenHash, input.rotatedFromRefreshTokenHash),
          isNull(mcpOAuthTokens.rotatedAt),
          isNull(mcpOAuthTokens.revokedAt),
          gt(mcpOAuthTokens.refreshExpiresAt, input.rotatedAt),
        ),
      )
      .returning();

    if (rotatedRow === undefined) {
      return null;
    }

    const values = mapMcpOAuthTokenInsert({
      ...input,
      rotatedFromTokenId: rotatedRow.id,
    });
    const [insertedRow] = await tx.insert(mcpOAuthTokens).values(values).returning();

    if (insertedRow === undefined) {
      throw new Error("Failed to insert rotated MCP OAuth refresh token.");
    }

    return mapMcpOAuthTokenRow(toMcpOAuthTokenRow(insertedRow));
  });
}

export async function revokeMcpOAuthTokenFamily(
  db: McpOAuthDatabase,
  tokenFamilyId: string,
  revokedAt: Date,
): Promise<number> {
  const rows = await db
    .update(mcpOAuthTokens)
    .set({
      revokedAt,
      updatedAt: revokedAt,
    })
    .where(
      and(
        eq(mcpOAuthTokens.tokenFamilyId, tokenFamilyId),
        isNull(mcpOAuthTokens.revokedAt),
      ),
    )
    .returning({ id: mcpOAuthTokens.id });

  return rows.length;
}

export async function revokeMcpOAuthTokensByAuthorizationCodeHash(
  db: McpOAuthDatabase,
  authorizationCodeHash: string,
  revokedAt: Date,
): Promise<number> {
  const rows = await db
    .update(mcpOAuthTokens)
    .set({
      revokedAt,
      updatedAt: revokedAt,
    })
    .where(
      and(
        eq(mcpOAuthTokens.authorizationCodeHash, authorizationCodeHash),
        isNull(mcpOAuthTokens.revokedAt),
      ),
    )
    .returning({ id: mcpOAuthTokens.id });

  return rows.length;
}

export async function revokeAllMcpOAuthTokensForUser(
  db: McpOAuthDatabase,
  userId: string,
  revokedAt: Date,
): Promise<number> {
  const rows = await db
    .update(mcpOAuthTokens)
    .set({
      revokedAt,
      updatedAt: revokedAt,
    })
    .where(and(eq(mcpOAuthTokens.userId, userId), isNull(mcpOAuthTokens.revokedAt)))
    .returning({ id: mcpOAuthTokens.id });

  return rows.length;
}

export function createMcpOAuthRepository(db: McpOAuthDatabase) {
  return {
    createClient: (input: CreateMcpOAuthClientInput) =>
      createMcpOAuthClient(db, input),
    findClientByClientId: (clientId: string) =>
      findMcpOAuthClientByClientId(db, clientId),
    createAuthorizationCode: (input: CreateMcpOAuthAuthorizationCodeInput) =>
      createMcpOAuthAuthorizationCode(db, input),
    findAuthorizationCodeByHash: (authorizationCodeHash: string) =>
      findMcpOAuthAuthorizationCodeByHash(db, authorizationCodeHash),
    consumeAuthorizationCode: (authorizationCodeHash: string, consumedAt: Date) =>
      consumeMcpOAuthAuthorizationCode(db, authorizationCodeHash, consumedAt),
    createTokenFamily: (input: CreateMcpOAuthTokenInput) =>
      createMcpOAuthTokenFamily(db, input),
    findTokenByAccessTokenHash: (accessTokenHash: string) =>
      findMcpOAuthTokenByAccessTokenHash(db, accessTokenHash),
    findTokenByRefreshTokenHash: (refreshTokenHash: string) =>
      findMcpOAuthTokenByRefreshTokenHash(db, refreshTokenHash),
    rotateRefreshToken: (input: RotateMcpOAuthRefreshTokenInput) =>
      rotateMcpOAuthRefreshToken(db, input),
    revokeTokenFamily: (tokenFamilyId: string, revokedAt: Date) =>
      revokeMcpOAuthTokenFamily(db, tokenFamilyId, revokedAt),
    revokeTokensByAuthorizationCodeHash: (
      authorizationCodeHash: string,
      revokedAt: Date,
    ) => revokeMcpOAuthTokensByAuthorizationCodeHash(db, authorizationCodeHash, revokedAt),
    revokeAllTokensForUser: (userId: string, revokedAt: Date) =>
      revokeAllMcpOAuthTokensForUser(db, userId, revokedAt),
  };
}

export type McpOAuthRepository = ReturnType<typeof createMcpOAuthRepository>;

export function createMcpOAuthRepositoryFromConnection(
  connection: Pick<DatabaseConnection, "db">,
): McpOAuthRepository {
  return createMcpOAuthRepository(connection.db as McpOAuthDatabase);
}
