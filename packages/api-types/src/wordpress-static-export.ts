/** Public WordPress snapshots. Jobs use existing WordPress Manager catalog/file-set storage. */
export interface WordPressStaticExportOptions {
  mode: "site" | "selected";
  /** Source-relative public URLs. Query-loop pagination parameters are supported. */
  paths: string[];
  /** Destination path, for example / or /resources/. */
  basePath: string;
  /** Relative links keep selected-page packages portable under unknown upload paths. */
  linkMode?: "relative" | "root";
  maxPages: number;
  maxAssets: number;
  maxBytes: number;
}

export interface WordPressStaticExportFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  url?: string;
}

export interface WordPressStaticExportPreflight {
  siteId: string;
  sourceUrl: string;
  engine: "zoer-static-crawler-v1";
  options: WordPressStaticExportOptions;
  /** Candidate links discovered in the sampled pages, not a complete database inventory. */
  pages: Array<{ url: string; title: string }>;
  sampledPages: number;
  findings: WordPressStaticExportFinding[];
  limits: { maxPages: number; maxAssets: number; maxBytes: number };
}

export interface WordPressStaticExportJob {
  id: string;
  siteId: string;
  sourceUrl: string;
  engine: "zoer-static-crawler-v1";
  options: WordPressStaticExportOptions;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  phase: string;
  createdAt: string;
  updatedAt: string;
  progress: { pages: number; assets: number; bytes: number; queued: number };
  findings: WordPressStaticExportFinding[];
  fileSetId?: string;
  sha256?: string;
  zipBytes?: number;
  downloadUrl?: string;
  previewUrl?: string;
  error?: string;
}
