export interface GithubFork { name: string; defaultBranch: string; stars: number; pushedAt: string | null; archived: boolean }
export interface GithubForkRepository extends GithubFork { forks: number; baseBranch: string; baseSha: string; authenticated: boolean }
export interface GithubForkBranch { name: string; sha: string }
export interface GithubForkComparison { ahead: number; behind: number; status: string }
export interface GithubForkRow { fork: string; branch: GithubForkBranch; comparison?: GithubForkComparison; error?: string }
export type GithubForkScanStatus = "queued" | "running" | "waiting" | "paused" | "completed";
export interface GithubForkScanSummary {
  id: string;
  input: string;
  base: string;
  status: GithubForkScanStatus;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  retryAt: string | null;
  forksFound: number;
  forksChecked: number;
  branchesFound: number;
  compared: number;
}
export interface GithubForkScan extends GithubForkScanSummary {
  repo: GithubForkRepository | null;
  forks: GithubFork[];
  rows: GithubForkRow[];
  warnings: string[];
}
