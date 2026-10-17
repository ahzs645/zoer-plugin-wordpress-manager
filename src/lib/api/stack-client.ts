import { json } from "./_http";

/**
 * Host routes behind stack files and theme development: repository Git metadata and one-file reads
 * (`workspace:repositories`), and the WordPress-specific stack-file save and one-off repository
 * installs (`workspace:wordpress`).
 */
export interface RepositoryInventoryEntry { id: string; name: string; href: string; gitUrl?: string | null; defaultBranch?: string | null; attachedComputers: { id: string; name: string; status: string }[] }
export interface RepositoryGitState { url: string | null; defaultBranch: string | null; branch: string | null; head: string | null; tags: string[]; dirty: boolean }
export interface RepositoryTextFile { path: string; content: string; data: string; sha256: string; bytes: number }
export interface SiteRepositorySource { id: string; name: string; linked: boolean; link: { repoId: string; siteId: string; slug: string; folder: string; kind?: "plugin" | "theme" } | null }
export interface InstallReview { id: string; fingerprint: string; repoId: string; siteId: string; slug: string; kind: "plugin" | "theme"; folder: string; installed: boolean; source: { name: string; version: string; commit: string | null; digest: string; files: number; bytes: number }; changes: { path: string; kind: string }[] }
export interface InstallJob { id: string; repoId: string; status: string; error?: string; createdAt: string; slug?: string; digest?: string; sourceCommit?: string | null; version?: string }

const repo = (id: string) => `/repository-development/${encodeURIComponent(id)}`;
const site = (id: string) => `/wordpress-manager/sites/${encodeURIComponent(id)}`;

export const stackClient = {
  repositories: () => json<{ version: 1; repositories: RepositoryInventoryEntry[] }>("/repository-development"),
  git: (repoId: string) => json<RepositoryGitState>(`${repo(repoId)}/git`),
  /** null when the file does not exist. */
  file: async (repoId: string, path: string) => {
    try { return await json<RepositoryTextFile>(`${repo(repoId)}/file?path=${encodeURIComponent(path)}`); }
    catch (error) { if (error instanceof Error && /not found/i.test(error.message)) return null; throw error; }
  },
  /** Saves one stack file; fails if the file changed since `expectedSha256` (null: it must not exist). */
  saveStackFile: (repoId: string, input: { path: string; content: string; expectedSha256: string | null }) =>
    json<{ path: string; sha256: string; replaced: boolean }>(`/wordpress-manager/repositories/${encodeURIComponent(repoId)}/stack-file`, { method: "PUT", body: JSON.stringify(input) }),
  siteRepositories: (siteId: string) => json<{ repositories: SiteRepositorySource[] }>(`${site(siteId)}/repository-development`),
  reviewInstall: (siteId: string, input: { repoId: string; folder: string; slug: string; kind: "plugin" | "theme" }) =>
    json<InstallReview>(`${site(siteId)}/repository-install/review`, { method: "POST", body: JSON.stringify(input) }),
  applyInstall: (siteId: string, review: InstallReview) =>
    json<InstallJob>(`${site(siteId)}/repository-install/apply`, { method: "POST", body: JSON.stringify({ id: review.id, fingerprint: review.fingerprint, repoId: review.repoId }) }),
  installs: (siteId: string) => json<{ jobs: InstallJob[] }>(`${site(siteId)}/repository-install`),
};
