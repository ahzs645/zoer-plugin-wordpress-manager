export interface StaticReleaseConfig {
  handle: string;
  ref: string;
  buildCommand: string;
  outputDirectory: string;
}
export interface StaticRelease {
  id: string;
  projectId: string;
  computerId: string;
  commit: string;
  ref: string;
  buildCommand: string;
  outputDirectory: string;
  createdAt: string;
  status: "building" | "ready" | "failed";
  error?: string;
  digest?: string;
  bytes?: number;
  /** Explicit request to publish this build after successful artifact validation. */
  liveUpdate?: { previousReleaseId: string; status: "pending" | "published" | "skipped"; message?: string };
}
export interface StaticLiveUpdateRequest {
  commit: string;
  ref: string;
  liveReleaseId: string;
}
export interface RepoLiveDeployment {
  projectId: string;
  projectName: string;
  ref: string;
  sourceCommit: string | null;
  liveCommit: string;
  liveReleaseId: string;
  liveUrl: string;
  needsUpdate: boolean;
  building: boolean;
  latestRelease: StaticRelease | null;
  error?: string;
}
export interface StaticDeploymentState {
  config: StaticReleaseConfig;
  releases: StaticRelease[];
  devReleaseId: string | null;
  liveReleaseId: string | null;
  history: { releaseId: string; environment: "dev" | "live"; createdAt: string }[];
  devUrl: string;
  liveUrl: string;
}
