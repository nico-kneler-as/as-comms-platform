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

  it("upsert allows non-null callers to update an existing alias", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_alias_update",
        projectName: "Original Project Name",
        projectAlias: "Old Alias",
        source: "salesforce",
      });

      const updated = await context.repositories.projectDimensions.upsert({
        projectId: "project_alias_update",
        projectName: "Original Project Name",
        projectAlias: "New Alias",
        source: "salesforce",
      });

      expect(updated.projectAlias).toBe("New Alias");
    } finally {
      await context.dispose();
    }
  });

  it("lists all normalized project aliases including inactive rows and excludes blank values", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_alias_active",
        projectName: "Active Project",
        projectAlias: "PNWBio@AdventureScientists.org",
        source: "salesforce",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "project_alias_inactive",
        projectName: "Inactive Project",
        projectAlias: "  past-orcas@adventurescientists.org  ",
        source: "salesforce",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "project_alias_duplicate",
        projectName: "Duplicate Project",
        projectAlias: "pnwbio@adventurescientists.org",
        source: "salesforce",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "project_alias_blank",
        projectName: "Blank Project",
        projectAlias: "   ",
        source: "salesforce",
      });
      await context.repositories.projectDimensions.upsert({
        projectId: "project_alias_null",
        projectName: "Null Project",
        source: "salesforce",
      });

      const aliases =
        await context.repositories.projectDimensions.listAllProjectAliases();

      expect(aliases).toEqual([
        "past-orcas@adventurescientists.org",
        "pnwbio@adventurescientists.org",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("includes previous_aliases in listAllProjectAliases output (D-049 rename preservation)", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_rename_target",
        projectName: "Rename Target",
        projectAlias: "current@adventurescientists.org",
        source: "salesforce",
      });
      // Simulate a rename history by setting the alias twice via the
      // public setter — the prior value should land in previous_aliases.
      await context.settings.projects.setProjectAlias(
        "project_rename_target",
        "renamed-once@adventurescientists.org",
      );
      await context.settings.projects.setProjectAlias(
        "project_rename_target",
        "renamed-twice@adventurescientists.org",
      );

      const aliases =
        await context.repositories.projectDimensions.listAllProjectAliases();

      expect(aliases).toEqual([
        "current@adventurescientists.org",
        "renamed-once@adventurescientists.org",
        "renamed-twice@adventurescientists.org",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("setProjectAlias appends the prior alias to previous_aliases on rename", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_setter_rename",
        projectName: "Setter Rename",
        projectAlias: "old@adventurescientists.org",
        source: "salesforce",
      });

      await context.settings.projects.setProjectAlias(
        "project_setter_rename",
        "new@adventurescientists.org",
      );

      const [updated] = await context.repositories.projectDimensions.listByIds(
        ["project_setter_rename"],
      );

      expect(updated?.projectAlias).toBe("new@adventurescientists.org");
      expect(updated?.previousAliases).toEqual([
        "old@adventurescientists.org",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("setProjectAlias does NOT append history when prior alias was null/empty", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_first_alias",
        projectName: "First Alias",
        // No projectAlias — prior is null.
        source: "salesforce",
      });

      await context.settings.projects.setProjectAlias(
        "project_first_alias",
        "new@adventurescientists.org",
      );

      const [updated] = await context.repositories.projectDimensions.listByIds(
        ["project_first_alias"],
      );

      expect(updated?.projectAlias).toBe("new@adventurescientists.org");
      expect(updated?.previousAliases).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("setProjectAlias does NOT append history when the new alias normalizes to the same value", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_same_alias",
        projectName: "Same Alias",
        projectAlias: "pnwbio@adventurescientists.org",
        source: "salesforce",
      });

      // Casing/whitespace edit should not flip a no-op rename into a
      // history-polluting append.
      await context.settings.projects.setProjectAlias(
        "project_same_alias",
        "  PNWBio@AdventureScientists.org  ",
      );

      const [updated] = await context.repositories.projectDimensions.listByIds(
        ["project_same_alias"],
      );

      expect(updated?.previousAliases).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("setProjectAlias dedupes when prior alias is already in previous_aliases", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project_dedupe_history",
        projectName: "Dedupe History",
        projectAlias: "alpha@adventurescientists.org",
        source: "salesforce",
      });

      // alpha → beta (history: [alpha])
      await context.settings.projects.setProjectAlias(
        "project_dedupe_history",
        "beta@adventurescientists.org",
      );
      // beta → alpha (history: [alpha] — alpha not duplicated because the
      // dedupe check excludes any prior value already in the array)
      await context.settings.projects.setProjectAlias(
        "project_dedupe_history",
        "alpha@adventurescientists.org",
      );
      // alpha → beta again (history: [alpha, beta] — beta now appended)
      await context.settings.projects.setProjectAlias(
        "project_dedupe_history",
        "beta@adventurescientists.org",
      );

      const [updated] = await context.repositories.projectDimensions.listByIds(
        ["project_dedupe_history"],
      );

      expect(updated?.previousAliases).toEqual([
        "alpha@adventurescientists.org",
        "beta@adventurescientists.org",
      ]);
    } finally {
      await context.dispose();
    }
  });
});
