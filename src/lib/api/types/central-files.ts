export type CentralFileResourceType =
  | "repo"
  | "wordpress-site"
  | "application"
  | "dataset"
  | "plugin-run"
  | "computer"
  | "workspace"
  | "other";

export interface CentralFileLink {
  id: string;
  resourceType: CentralFileResourceType;
  resourceId: string;
  label: string | null;
  createdAt: string;
}

export interface CentralFileVersion {
  version: number;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  createdAt: string;
}

export interface CentralFileRecord {
  id: string;
  name: string;
  source: "upload" | "generated" | "imported";
  currentVersion: number;
  versions: CentralFileVersion[];
  links: CentralFileLink[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type CentralFileImportSourceType = "job-document" | "plugin-artifact" | "chat-attachment" | "chat";

export interface CentralFileImportSource {
  createdAt?: string;
  sourceType: CentralFileImportSourceType;
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number | null;
  context: string;
}

export interface CentralFileRepoCopyReceipt {
  repoId: string;
  repoName: string;
  computerId: string;
  path: string;
  sha256: string;
}

export interface CentralFileWordPressReceipt {
  siteId: string;
  siteName: string;
  mediaId: string;
  sha256: string;
}
