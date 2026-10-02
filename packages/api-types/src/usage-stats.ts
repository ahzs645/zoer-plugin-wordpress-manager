/** Token and estimated API cost from the CLI session transcripts on computers. */
export type UsageStatsProvider = string;
export type UsageStatsDays = 1 | 7 | 30 | 90;

export interface UsageStatsTotals {
  totalTokens: number;
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Estimated at API list prices; subscriptions are billed differently. */
  costUsd: number;
  cacheSavingsUsd: number;
  sessions: number;
  records: number;
  unpricedRecords: number;
}

export interface UsageStatsProviderTotals {
  provider: UsageStatsProvider;
  totalTokens: number;
  costUsd: number;
  sessions: number;
  tokenShare: number;
  costShare: number;
}

export interface UsageStatsPeriod {
  /** `YYYY-MM-DD` in the requested time zone, or an ISO hour start for the 24-hour view. */
  period: string;
  totalTokens: number;
  costUsd: number;
  byProvider: Partial<Record<UsageStatsProvider, { totalTokens: number; costUsd: number }>>;
}

export interface UsageStatsModel {
  provider: UsageStatsProvider;
  model: string;
  totalTokens: number;
  costUsd: number;
  tokenShare: number;
  costShare: number;
  /** No price is known for this model, so its cost is left out. */
  unpriced: boolean;
}

export interface UsageStatsComputer {
  computerId: string;
  name: string;
  /** False for a computer that has since been deleted; its recorded usage still counts. */
  present: boolean;
  running: boolean;
  scannedAt: string | null;
  error: string | null;
  totalTokens: number;
  costUsd: number;
  sessions: number;
}

export interface UsageStatsReport {
  generatedAt: string;
  days: UsageStatsDays;
  timeZone: string;
  resolution: "day" | "hour";
  periods: string[];
  totals: UsageStatsTotals;
  providers: UsageStatsProviderTotals[];
  series: UsageStatsPeriod[];
  models: UsageStatsModel[];
  computers: UsageStatsComputer[];
  /** Sessions found on more than one computer (a copied home), counted once. */
  duplicateSessions: number;
  accounting?: {
    requests: number;
    unavailableRequests: number;
    partialRequests: number;
    duplicateRecords: number;
  };
  activity?: UsageStatsActivity[];
  pricing: { source: string; fetchedAt: string | null; available: boolean };
}

/** A group of actual model attempts, retaining workflow and computer attribution. */
export interface UsageStatsActivity {
  pluginId?: string;
  actionId?: string;
  runId?: string;
  computerId?: string;
  workload?: string;
  model: string | null;
  provider: string;
  source: "hosted-api" | "installed-cli";
  requests: number;
  unavailable: number;
  partial: number;
  failed: number;
  totalTokens: number | null;
  costUsd: number | null;
}
