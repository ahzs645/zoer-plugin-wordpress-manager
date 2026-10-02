// Shared wire types for the Projects repo to computer to app command to
// route to publish workflow. Consumed by both backend and frontend.

/** Workspace-wide policy for project computers with a saved static preview. */
export interface ProjectIdleSettings {
  enabled: boolean;
  idleMinutes: number;
}

/**
 * A Project binds an imported repo (shared workspace) to the computer that
 * runs it, the app command that serves it, and the public route it publishes
 * to. Projects are cheap metadata: deleting one never deletes the underlying
 * repo or computer.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  /** Shared workspace id of the imported repo (see /api/repos). */
  repoId: string;
  /** Git remote URL, denormalized from the repo for display. */
  repoUrl?: string;
  /** Computer bound to this project (created/started by prepare). */
  computerId?: string | null;
  /** Default command for POST /run, e.g. "bun run build && bun run start". */
  devCommand?: string | null;
  /** Last known or intended HTTP app port. */
  port?: number | null;
  cliProvider?: string | null;
  model?: string | null;
  /** Route handle the project publishes under (path slug below /sites/:space). */
  serviceHandle?: string | null;
  datasetIds: string[];
  /** Secret key names only. Never secret values. */
  secretAliases: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Immutable record of a publish. Receipts are append-only: there is no
 * update or delete API for them.
 */
export interface PublishReceipt {
  id: string;
  projectId: string;
  createdAt: string;
  commit: {
    hash: string;
    branch: string;
    dirty: boolean;
  };
  runtime: {
    computerId: string;
    runtime: string;
    runtimeProfile: string;
  };
  /** App command that was running when published (null when unknown). */
  command: string | null;
  port: number;
  route: {
    handle: string;
    url: string;
  };
  health: {
    ok: boolean;
    status?: number;
    checkedAt: string;
  };
  notes?: string;
}
