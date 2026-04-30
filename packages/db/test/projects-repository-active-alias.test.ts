import { describe, expect, it } from "vitest";

import { ProjectAliasRequiredError } from "../src/repositories.js";
import { createTestStage1Context } from "./helpers.js";

describe("settings.projects.setActive — alias requirement", () => {
  it("throws ProjectAliasRequiredError when activating a project with NULL alias", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_no_alias",
        projectName: "Long Marketing Project Name",
        source: "salesforce",
      });

      await expect(
        context.settings.projects.setActive("project_no_alias", true),
      ).rejects.toBeInstanceOf(ProjectAliasRequiredError);
    } finally {
      await context.dispose();
    }
  });

  it("throws ProjectAliasRequiredError when activating a project with whitespace-only alias", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_blank_alias",
        projectName: "Long Marketing Project Name",
        projectAlias: "   ",
        source: "salesforce",
      });

      await expect(
        context.settings.projects.setActive("project_blank_alias", true),
      ).rejects.toBeInstanceOf(ProjectAliasRequiredError);
    } finally {
      await context.dispose();
    }
  });

  it("activates a project successfully when alias is set", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_with_alias",
        projectName: "Long Marketing Project Name",
        projectAlias: "Short Name",
        source: "salesforce",
      });

      const activated = await context.settings.projects.setActive(
        "project_with_alias",
        true,
      );

      expect(activated).not.toBeNull();
      expect(activated?.isActive).toBe(true);
      expect(activated?.projectAlias).toBe("Short Name");
    } finally {
      await context.dispose();
    }
  });

  it("deactivates a project regardless of alias state (NULL alias allowed)", async () => {
    const context = await createTestStage1Context();
    try {
      // Seed an inactive row with NULL alias — represents the "stale row"
      // shape (active=false, alias=null) that the CHECK constraint allows.
      await context.repositories.projectDimensions.upsert({
        projectId: "project_inactive_no_alias",
        projectName: "Long Marketing Project Name",
        source: "salesforce",
      });

      // Deactivating an already-inactive row should succeed (no-op semantics).
      const deactivated = await context.settings.projects.setActive(
        "project_inactive_no_alias",
        false,
      );

      expect(deactivated).not.toBeNull();
      expect(deactivated?.isActive).toBe(false);
      expect(deactivated?.projectAlias).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("preserves operator-set alias and active state when Salesforce upsert sends null alias", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_preserve_alias",
        projectName: "Original Project Name",
        projectAlias: "Operator-Set Alias",
        source: "salesforce",
      });

      await context.settings.projects.setActive("project_preserve_alias", true);

      await context.repositories.projectDimensions.upsert({
        projectId: "project_preserve_alias",
        projectName: "Updated Project Name",
        projectAlias: null,
        source: "salesforce",
      });

      const [project] = await context.repositories.projectDimensions.listByIds([
        "project_preserve_alias",
      ]);

      expect(project).toBeDefined();
      expect(project?.projectAlias).toBe("Operator-Set Alias");
      expect(project?.isActive).toBe(true);
      expect(project?.projectName).toBe("Updated Project Name");
    } finally {
      await context.dispose();
    }
  });

  it("inserts new Salesforce projects inactive with null alias", async () => {
    const context = await createTestStage1Context();
    try {
      const inserted = await context.repositories.projectDimensions.upsert({
        projectId: "project_insert_defaults",
        projectName: "Inserted Project",
        projectAlias: null,
        source: "salesforce",
      });

      expect(inserted.isActive).toBe(false);
      expect(inserted.projectAlias).toBeNull();
    } finally {
      await context.dispose();
    }
  });
});
