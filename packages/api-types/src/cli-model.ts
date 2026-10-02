export interface CliModelOption {
  id: string;
  label: string;
  aliases?: string[];
  description?: string;
  efforts: string[];
  defaultEffort?: string;
}

export interface CliModelCatalog {
  provider: "claude" | "codex" | "opencode";
  models: CliModelOption[];
  source?: "live" | "saved-fallback" | "bundled-fallback";
  warning?: string;
}

export interface CliModelSelection {
  cliProvider?: string;
  cliModel?: string;
  cliEffort?: string;
}

export interface CliModelPreferences {
  defaultSelection: CliModelSelection | null;
  modelEfforts: Record<string, string>;
  workloads?: Record<string, CliModelSelection>;
}
