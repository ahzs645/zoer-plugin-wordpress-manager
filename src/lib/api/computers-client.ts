export type WordPressUpdraftComponent = "database" | "plugins" | "themes" | "uploads" | "others";

export interface WordPressUpdraftImportManifest {
  importId: string;
  sessionName: string;
  components: Array<{
    component: WordPressUpdraftComponent;
    originalName: string;
    size: number;
    sha256: string;
    chunks: number;
  }>;
}

export interface WordPressUpdraftImportStatus {
  state: "preparing" | "prepared" | "restarting" | "applying" | "completed" | "failed";
  importId: string;
  computerId: string;
  computerStatus?: string;
  sessionName?: string;
  sourceUrl?: string;
  wordpressVersion?: string;
  warnings?: string[];
  error?: string;
}
