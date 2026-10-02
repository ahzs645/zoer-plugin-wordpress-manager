/**
 * Repository access model: a repository is durable; working copies are the
 * concrete sets of files people and agents use; attachments expose a
 * repository's storage to a computer with a fixed access level.
 */

/** Where a working copy's files live. */
export type WorkingCopyLocation =
  /** Inside the repository's own volume or claim; path is relative to its root ("" for the root). */
  | { kind: "repository-storage"; path: string }
  /** On one computer; path is absolute inside that computer. */
  | { kind: "computer"; computerId: string; path: string };

export type WorkingCopyKind =
  /** The repository's primary files, shared live by every attached computer. */
  | "shared"
  /** An isolated clone under `.zoer/runs/<id>` created for an agent run. */
  | "agent-run"
  /** Committed source copied into a computer for a chat; changes return as reviewed patches. */
  | "chat-copy"
  /** A checkout on a computer that was registered with Zoer (for example on OpenSandbox or Coder). */
  | "checkout";

export interface WorkingCopy {
  /** Stable across listings: `shared:<repo>`, `run:<id>`, `chat:<id>` or `checkout:<id>`. */
  id: string;
  repositoryId: string;
  kind: WorkingCopyKind;
  label: string;
  location: WorkingCopyLocation;
  /** `live`: the repository's files themselves. `clone`: separate Git history. `snapshot`: committed source only. */
  contents: "live" | "clone" | "snapshot";
  branch: string | null;
  /** Commit the copy started from, when known. */
  baseCommit: string | null;
  /** Branch the copy started from, when known. */
  baseRef: string | null;
  /** Computers that can reach these files. */
  computerIds: string[];
  /** Lifecycle state from the owning feature, such as an agent run's status. */
  state: string | null;
  conversationId: string | null;
  createdAt: string | null;
}

/** Live Git state of one working copy. `available: false` means Zoer could not read it now. */
export interface WorkingCopyChanges {
  available: boolean;
  reason: string | null;
  branch: string | null;
  head: string | null;
  /** `git status --porcelain` lines, at most 200. */
  changes: string[];
  truncated: boolean;
  /** Commits on HEAD that are not in the base, when the base is known. */
  commitsSinceBase: number | null;
  checkedAt: string;
}

export type RepositoryAccess = "read" | "write";

/** An additional repository mounted into a computer. The computer's primary repository stays at /workspace. */
export interface RepositoryAttachment {
  repositoryId: string;
  access: RepositoryAccess;
  /** Absolute mount path, `/repos/<slug>`. */
  mountPath: string;
}
