import { describe, expect, it } from "vitest";

import {
  InvalidProjectConnectionError,
  ProjectNotConnectedError,
} from "../src/repositories.js";
import { createTestStage1Context } from "./helpers.js";

// Repository-level coverage for the Settings UX additions in
// settings.projects: listConnectedProjects, listAvailableConnectionCandidates,
// connectProjectsToHost, disconnectProject, and deactivateWithCascade.
//
// The schema invariants (relaxed CHECK + chain trigger + ON DELETE SET NULL)
// are already covered by projects-repository-connected-projects.test.ts;
// these tests focus on the higher-level repo verbs the action layer uses.
describe("settings.projects connection helpers", () => {
  it("listConnectedProjects returns only active connected subs of the host, ordered by name", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });
      // Pre-existing inactive project (must not show up).
      await context.repositories.projectDimensions.upsert({
        projectId: "other:inactive",
        projectName: "Other Inactive",
        projectAlias: null,
        source: "salesforce",
        isActive: false,
      });
      // Sub: Beech and Butternut, both active connected.
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:butternut",
        projectName: "Butternut",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech",
        projectName: "Beech",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });
      // Different host's sub (must not show up).
      await context.repositories.projectDimensions.upsert({
        projectId: "host:other",
        projectName: "Other Host",
        projectAlias: "Other Host",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:other-host-sub",
        projectName: "Aardvark Foreign Sub",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:other",
      });

      const subs =
        await context.settings.projects.listConnectedProjects("host:forests");

      expect(subs.map((sub) => sub.projectName)).toEqual([
        "Beech",
        "Butternut",
      ]);
      expect(subs.every((sub) => sub.isActive)).toBe(true);
    } finally {
      await context.dispose();
    }
  });

  it("listAvailableConnectionCandidates excludes active hosts, active connected subs, and already-connected rows", async () => {
    const context = await createTestStage1Context();
    try {
      // Active host (excluded — has alias, isActive=true).
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });
      // Active connected sub (excluded).
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech",
        projectName: "Beech",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });
      // Inactive but already connected to a host that the operator may
      // disconnect later — currently has connectedToProjectId set, so it's
      // still excluded from candidates until disconnected.
      // (Per schema, an inactive sub with a connection is unusual but
      // possible after a partial migration; verify exclusion either way.)
      await context.repositories.projectDimensions.upsert({
        projectId: "leftover:connected",
        projectName: "Leftover Connected",
        projectAlias: "Leftover",
        source: "salesforce",
        isActive: false,
        connectedToProjectId: "host:forests",
      });
      // Inactive, unconnected: the only candidate.
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:butternut",
        projectName: "Butternut",
        projectAlias: null,
        source: "salesforce",
        isActive: false,
      });
      // Another inactive, unconnected, with name that sorts before Butternut.
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:aspen",
        projectName: "Aspen",
        projectAlias: null,
        source: "salesforce",
        isActive: false,
      });

      const candidates =
        await context.settings.projects.listAvailableConnectionCandidates();

      expect(candidates.map((c) => c.projectName)).toEqual([
        "Aspen",
        "Butternut",
      ]);
      expect(candidates.every((c) => !c.isActive)).toBe(true);
      expect(candidates.every((c) => c.connectedToProjectId === null)).toBe(
        true,
      );
    } finally {
      await context.dispose();
    }
  });

  it("connectProjectsToHost flips multiple subs in one call, clearing their alias and AI knowledge URL", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:beech",
        projectName: "Beech",
        projectAlias: "Old Beech Alias",
        aiKnowledgeUrl: "https://www.notion.so/old-beech",
        source: "salesforce",
        isActive: false,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:butternut",
        projectName: "Butternut",
        projectAlias: null,
        source: "salesforce",
        isActive: false,
      });

      const result = await context.settings.projects.connectProjectsToHost({
        hostProjectId: "host:forests",
        connectedProjectIds: ["candidate:beech", "candidate:butternut"],
      });

      expect(result.host.projectId).toBe("host:forests");
      expect(result.connectedProjects.map((sub) => sub.projectId).sort()).toEqual([
        "candidate:beech",
        "candidate:butternut",
      ]);

      // Verify each sub is now flipped at the underlying table.
      const beech =
        await context.repositories.projectDimensions.findById("candidate:beech");
      expect(beech?.isActive).toBe(true);
      expect(beech?.connectedToProjectId).toBe("host:forests");
      expect(beech?.projectAlias).toBeNull();
      expect(beech?.aiKnowledgeUrl).toBeNull();

      const butternut =
        await context.repositories.projectDimensions.findById(
          "candidate:butternut",
        );
      expect(butternut?.isActive).toBe(true);
      expect(butternut?.connectedToProjectId).toBe("host:forests");
      expect(butternut?.projectAlias).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("connectProjectsToHost rejects when the host is inactive", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:dormant",
        projectName: "Dormant",
        projectAlias: "Dormant",
        source: "salesforce",
        isActive: false,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:c",
        projectName: "Candidate",
        projectAlias: null,
        source: "salesforce",
        isActive: false,
      });

      await expect(
        context.settings.projects.connectProjectsToHost({
          hostProjectId: "host:dormant",
          connectedProjectIds: ["candidate:c"],
        }),
      ).rejects.toBeInstanceOf(InvalidProjectConnectionError);
    } finally {
      await context.dispose();
    }
  });

  it("connectProjectsToHost rejects when the host is itself a connected sub-project", async () => {
    // Defence-in-depth: a connected sub-project (which has no alias of its
    // own) must never be picked as a host. The action layer enforces this
    // via the host_already_connected branch.
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech",
        projectName: "Beech",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:c",
        projectName: "Candidate",
        projectAlias: null,
        source: "salesforce",
        isActive: false,
      });

      const error = await context.settings.projects
        .connectProjectsToHost({
          hostProjectId: "sub:beech",
          connectedProjectIds: ["candidate:c"],
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidProjectConnectionError);
      expect((error as InvalidProjectConnectionError).code).toBe(
        "host_already_connected",
      );
    } finally {
      await context.dispose();
    }
  });

  // Note: the host_missing_alias branch in connectProjectsToHost is purely
  // defensive — the schema CHECK constraint already prevents an active row
  // from having a null/empty alias. We don't have a way to construct that
  // state in test without bypassing the constraint, so this branch is left
  // un-tested at the repo level. The action layer enforces the same check
  // earlier, where it's easy to test in isolation.

  it("connectProjectsToHost rejects an empty-set candidate that's already active", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "candidate:active",
        projectName: "Already Active",
        projectAlias: "Already Active",
        source: "salesforce",
        isActive: true,
      });

      const error = await context.settings.projects
        .connectProjectsToHost({
          hostProjectId: "host:forests",
          connectedProjectIds: ["candidate:active"],
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidProjectConnectionError);
      expect((error as InvalidProjectConnectionError).code).toBe(
        "candidate_already_active",
      );
    } finally {
      await context.dispose();
    }
  });

  it("disconnectProject flips a sub back to inactive with cleared connection", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech",
        projectName: "Beech",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });

      const updated =
        await context.settings.projects.disconnectProject("sub:beech");

      expect(updated).not.toBeNull();
      expect(updated?.isActive).toBe(false);
      expect(updated?.connectedToProjectId).toBeNull();

      const refreshed =
        await context.repositories.projectDimensions.findById("sub:beech");
      expect(refreshed?.isActive).toBe(false);
      expect(refreshed?.connectedToProjectId).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("disconnectProject throws ProjectNotConnectedError when target has no connection", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "standalone",
        projectName: "Standalone",
        projectAlias: "Standalone",
        source: "salesforce",
        isActive: true,
      });

      await expect(
        context.settings.projects.disconnectProject("standalone"),
      ).rejects.toBeInstanceOf(ProjectNotConnectedError);
    } finally {
      await context.dispose();
    }
  });

  it("deactivateWithCascade flips host + connected subs in the same transaction", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "host:forests",
        projectName: "Forests",
        projectAlias: "Forests",
        source: "salesforce",
        isActive: true,
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:beech",
        projectName: "Beech",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "sub:butternut",
        projectName: "Butternut",
        projectAlias: null,
        source: "salesforce",
        isActive: true,
        connectedToProjectId: "host:forests",
      });

      const result =
        await context.settings.projects.deactivateWithCascade("host:forests");

      expect(result?.project.isActive).toBe(false);
      expect(result?.cascadedSubProjects.map((sub) => sub.projectName)).toEqual([
        "Beech",
        "Butternut",
      ]);

      // All three rows should now be isActive=false with no connection.
      const host =
        await context.repositories.projectDimensions.findById("host:forests");
      expect(host?.isActive).toBe(false);

      const beech =
        await context.repositories.projectDimensions.findById("sub:beech");
      expect(beech?.isActive).toBe(false);
      expect(beech?.connectedToProjectId).toBeNull();

      const butternut =
        await context.repositories.projectDimensions.findById("sub:butternut");
      expect(butternut?.isActive).toBe(false);
      expect(butternut?.connectedToProjectId).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("deactivateWithCascade is a no-op for the cascade list when the host has no subs", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "standalone",
        projectName: "Standalone",
        projectAlias: "Standalone",
        source: "salesforce",
        isActive: true,
      });

      const result =
        await context.settings.projects.deactivateWithCascade("standalone");

      expect(result?.project.isActive).toBe(false);
      expect(result?.cascadedSubProjects).toEqual([]);
    } finally {
      await context.dispose();
    }
  });
});
