import type { CampaignRunProjectionRow, RunState } from "@as-comms/contracts";

export interface CampaignRunProjectionRepositories {
  readonly campaignRunProjection: {
    listRecent(opts?: {
      readonly limit?: number;
      readonly offset?: number;
      readonly states?: readonly RunState[];
      readonly projectIds?: readonly string[];
      readonly searchQuery?: string;
    }): Promise<readonly CampaignRunProjectionRow[]>;
    getDetail(
      runId: string,
      provider: "postmark" | "mailchimp",
    ): Promise<CampaignRunProjectionRow | null>;
    count(opts?: {
      readonly states?: readonly RunState[];
      readonly projectIds?: readonly string[];
      readonly searchQuery?: string;
    }): Promise<number>;
    countByState(opts?: {
      readonly projectIds?: readonly string[];
    }): Promise<Partial<Record<RunState, number>>>;
  };
}

export interface CampaignRunProjectionReader {
  listRecent(opts: {
    limit?: number;
    offset?: number;
    states?: RunState[];
    projectIds?: string[];
    searchQuery?: string;
  }): Promise<CampaignRunProjectionRow[]>;
  getDetail(
    runId: string,
    provider: "postmark" | "mailchimp",
  ): Promise<CampaignRunProjectionRow | null>;
  count(opts: {
    states?: RunState[];
    projectIds?: string[];
    searchQuery?: string;
  }): Promise<number>;
  countByState(opts: {
    projectIds?: string[];
  }): Promise<Partial<Record<RunState, number>>>;
}

export function createCampaignRunProjectionReader(deps: {
  repositories: CampaignRunProjectionRepositories;
}): CampaignRunProjectionReader {
  return {
    async listRecent(opts) {
      return [
        ...(await deps.repositories.campaignRunProjection.listRecent({
          ...(opts.limit === undefined ? {} : { limit: opts.limit }),
          ...(opts.offset === undefined ? {} : { offset: opts.offset }),
          ...(opts.states === undefined ? {} : { states: opts.states }),
          ...(opts.projectIds === undefined
            ? {}
            : { projectIds: opts.projectIds }),
          ...(opts.searchQuery === undefined
            ? {}
            : { searchQuery: opts.searchQuery }),
        })),
      ];
    },

    async getDetail(runId, provider) {
      return deps.repositories.campaignRunProjection.getDetail(runId, provider);
    },

    async count(opts) {
      return deps.repositories.campaignRunProjection.count({
        ...(opts.states === undefined ? {} : { states: opts.states }),
        ...(opts.projectIds === undefined
          ? {}
          : { projectIds: opts.projectIds }),
        ...(opts.searchQuery === undefined
          ? {}
          : { searchQuery: opts.searchQuery }),
      });
    },

    async countByState(opts) {
      return deps.repositories.campaignRunProjection.countByState({
        ...(opts.projectIds === undefined
          ? {}
          : { projectIds: opts.projectIds }),
      });
    },
  };
}
