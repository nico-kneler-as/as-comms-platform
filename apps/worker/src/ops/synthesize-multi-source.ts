#!/usr/bin/env tsx
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  createStage2RepositoryBundleFromConnection,
} from "@as-comms/db";
import {
  createAnthropicClient,
  invokeModel,
  InlineTextFetcher,
  NotionPageFetcher,
  WebPageFetcher,
} from "@as-comms/integrations";

import {
  runSynthesizeProjectKnowledge,
  type SynthesizeProjectKnowledgeDependencies,
} from "../jobs/synthesize-project-knowledge/index.js";

function readRequiredEnv(
  key: "ANTHROPIC_API_KEY" | "DATABASE_URL" | "NOTION_API_KEY",
): string {
  const value = process.env[key]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function readAnthropicModel(): string {
  const value = process.env.ANTHROPIC_MODEL?.trim();
  return value && value.length > 0 ? value : "claude-sonnet-4-6";
}

function buildDependencies(): SynthesizeProjectKnowledgeDependencies {
  const connection = createDatabaseConnection({
    connectionString: readRequiredEnv("DATABASE_URL"),
  });
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const settings = createStage2RepositoryBundleFromConnection(connection);
  const anthropicClient = createAnthropicClient({
    ANTHROPIC_API_KEY: readRequiredEnv("ANTHROPIC_API_KEY"),
  });
  const notionApiKey = readRequiredEnv("NOTION_API_KEY");

  const base: SynthesizeProjectKnowledgeDependencies = {
    repositories: {
      projectDimensions: repositories.projectDimensions,
      settingsProjects: settings.projects,
    },
    fetchers: {
      notion: new NotionPageFetcher({ apiKey: notionApiKey }),
      web_page: new WebPageFetcher(),
      inline_text: new InlineTextFetcher(),
    },
    notion: {
      apiKey: notionApiKey,
    },
    model: readAnthropicModel(),
    invokeModel: (input) => invokeModel(anthropicClient, input),
  };

  return Object.assign(base, {
    async dispose() {
      await closeDatabaseConnection(connection);
    },
  }) as SynthesizeProjectKnowledgeDependencies & {
    dispose(): Promise<void>;
  };
}

async function main(): Promise<void> {
  const projectId = process.argv[2];

  if (projectId === undefined || projectId.trim().length === 0) {
    throw new Error("Usage: tsx src/ops/synthesize-multi-source.ts <project_id>");
  }

  const dependencies = buildDependencies() as SynthesizeProjectKnowledgeDependencies & {
    dispose(): Promise<void>;
  };

  try {
    const result = await runSynthesizeProjectKnowledge(dependencies, {
      projectId,
    });

    if (!result.ok) {
      console.error(`Synthesis failed: ${result.code}`);
      console.error(result.message);
      if (result.error !== undefined) {
        console.error(result.error);
      }
      process.exitCode = 1;
      return;
    }

    if ("unchanged" in result) {
      console.info(
        `No source changes detected for ${result.projectId}; checked ${String(result.sourcesChecked)} sources.`,
      );
      return;
    }

    if (!("notionUrl" in result)) {
      throw new Error("Expected synthesized Notion output when result is not unchanged.");
    }

    console.info(`Notion URL: ${result.notionUrl}`);
    console.info(`Model: ${result.model}`);
    console.info(`Sources used: ${String(result.sourcesUsed)}`);
    console.info(`Tokens: ${String(result.tokensIn)} in, ${String(result.tokensOut)} out`);
    console.info(`Estimated cost: $${result.costUsd.toFixed(3)}`);
  } finally {
    await dependencies.dispose();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
