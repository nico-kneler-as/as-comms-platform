import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

// drizzle-orm wraps Postgres errors in a generic "Failed query: ..." Error.
// The original Postgres error (with our raise message) lives in `cause`.
// Walk the cause chain to find a message we can assert against.
function readNestedErrorMessage(error: unknown): string {
  let current: unknown = error;
  let message = error instanceof Error ? error.message : String(error);
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof Error && typeof current.cause !== "undefined") {
      current = current.cause;
      if (current instanceof Error) {
        message = `${message}\n${current.message}`;
      } else if (typeof current === "string") {
        message = `${message}\n${current}`;
      } else if (current && typeof current === "object" && "message" in current) {
        const nested = (current as { message?: unknown }).message;
        if (typeof nested === "string") {
          message = `${message}\n${nested}`;
        }
      }
      continue;
    }
    break;
  }
  return message;
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

// Schema-level guarantees added by migration 0056. The data foundation needs
// to enforce four invariants:
//   1. Active connected sub-projects don't need their own alias (relaxed
//      project_dimensions_active_alias_required CHECK).
//   2. Active stand-alone projects with no alias and no host are still
//      rejected (the relaxed constraint must not turn into "anything goes").
//   3. Connected sub-projects can't chain (a sub can't itself be a host).
//   4. Deleting a host disconnects its sub-projects via ON DELETE SET NULL.
describe("project_dimensions connected-sub-project schema", () => {
  it("allows an active connected sub-project with no alias", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:beech",
        projectName: "Beech",
        projectAlias: "Beech",
        source: "salesforce",
        isActive: true,
      });

      const sub = await context.repositories.projectDimensions.upsert({
        projectId: "sub:butternut",
        projectName: "Butternut",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:beech",
      });

      expect(sub.isActive).toBe(true);
      expect(sub.projectAlias).toBeNull();
      expect(sub.connectedToProjectId).toBe("host:beech");
    } finally {
      await context.dispose();
    }
  });

  it("also allows an active connected sub-project with an alias set", async () => {
    // We don't FORBID a connected sub-project from having an alias; the
    // constraint only says "active rows must have alias OR connection".
    // Operators may still want a friendly short name for display purposes
    // even though sends go through the host's alias.
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });

      const sub = await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech",
        projectName: "Beech",
        projectAlias: "Beech",
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });

      expect(sub.isActive).toBe(true);
      expect(sub.projectAlias).toBe("Beech");
      expect(sub.connectedToProjectId).toBe("host:forests");
    } finally {
      await context.dispose();
    }
  });

  it("rejects an active row with no alias AND no connection", async () => {
    const context = await createTestStage1Context();
    try {
      // Direct INSERT bypasses the upsert protection (which preserves
      // operator-set alias/active state) so we hit the relaxed CHECK head-on.
      const error = await captureError(
        context.db.execute(sql`
          insert into "project_dimensions"
            ("project_id", "project_name", "project_alias",
             "is_active", "connected_to_project_id", "source")
          values
            ('orphan', 'Orphan', null, true, null, 'salesforce')
        `),
      );
      expect(readNestedErrorMessage(error)).toMatch(
        /project_dimensions_active_alias_required/u,
      );
    } finally {
      await context.dispose();
    }
  });

  it("rejects setting connected_to_project_id when the target already has its own connection (chain)", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:x",
        projectName: "X",
        projectAlias: "X",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:y",
        projectName: "Y",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:x",
      });

      // Z trying to connect to Y (which already has a connection) -> chain.
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:z",
        projectName: "Z",
        projectAlias: "Z",
        source: "salesforce",
        isActive: true,
      });

      const error = await captureError(
        context.db.execute(sql`
          update "project_dimensions"
             set "connected_to_project_id" = 'sub:y'
           where "project_id" = 'candidate:z'
        `),
      );
      expect(readNestedErrorMessage(error)).toMatch(/cannot be chained/u);
    } finally {
      await context.dispose();
    }
  });

  it("rejects giving an existing host its own connection while it has sub-projects", async () => {
    // The other chain direction: a host that already has children can't itself
    // be turned into a sub-project.
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:m",
        projectName: "M",
        projectAlias: "M",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:n",
        projectName: "N",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:m",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:p",
        projectName: "P",
        projectAlias: "P",
        source: "salesforce",
        isActive: true,
      });

      const error = await captureError(
        context.db.execute(sql`
          update "project_dimensions"
             set "connected_to_project_id" = 'candidate:p'
           where "project_id" = 'host:m'
        `),
      );
      expect(readNestedErrorMessage(error)).toMatch(/cannot be chained/u);
    } finally {
      await context.dispose();
    }
  });

  it("disconnects sub-projects when the host is deleted (ON DELETE SET NULL)", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:to-delete",
        projectName: "Deleted Host",
        projectAlias: "Deleted Host",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:orphaned",
        projectName: "Orphaned Sub",
        // Alias set so the CHECK still holds after the connection disappears.
        projectAlias: "Orphaned Sub",
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:to-delete",
      });

      await context.db.execute(sql`
        delete from "project_dimensions" where "project_id" = 'host:to-delete'
      `);

      const sub = await context.repositories.projectDimensions.findById(
        "sub:orphaned",
      );

      expect(sub).not.toBeNull();
      expect(sub?.connectedToProjectId).toBeNull();
      // The disconnected row should still satisfy the relaxed CHECK because
      // it has its own alias set.
      expect(sub?.isActive).toBe(true);
      expect(sub?.projectAlias).toBe("Orphaned Sub");
    } finally {
      await context.dispose();
    }
  });
});
