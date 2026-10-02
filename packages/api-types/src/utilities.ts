/** Utilities are discovery contributions, never an additional execution tier. */
export interface UtilityContribution {
  id: string;
  title: string;
  description: string;
  category: string;
  keywords?: string[];
  target: { kind: "action"; actionId: string } | { kind: "workspace"; location?: string };
}

export interface StandaloneUtilityMetadata {
  category: string;
  keywords?: string[];
}

export function validateStandaloneUtility(value: unknown, integration: { actions?: unknown[]; utilities?: unknown; workspace?: unknown } | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "utility metadata is required";
  const metadata = value as Record<string, unknown>;
  if (Object.keys(metadata).some(key => !["category", "keywords"].includes(key))) return "utility metadata contains unsupported fields";
  if (typeof metadata.category !== "string" || !metadata.category.trim() || metadata.category.length > 48) return "utility category must be 1–48 characters";
  if (metadata.keywords !== undefined && (!Array.isArray(metadata.keywords) || metadata.keywords.length > 12 || metadata.keywords.some(word => typeof word !== "string" || !word.trim() || word.length > 48))) return "utility keywords are invalid";
  if (!integration || !Array.isArray(integration.actions) || !integration.actions.length) return "utility requires declared actions";
  if (integration.utilities !== undefined) return "standalone utility packages cannot contribute other utilities";
  if (integration.workspace !== undefined) return "standalone utility v1 uses host-rendered actions; sandbox workspaces remain plugin contributions";
  return null;
}

export interface UtilityDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  keywords: string[];
  source: { kind: "utility"; packageId: string; name: string; version: string; bundled: boolean } | { kind: "built-in" } | { kind: "plugin"; pluginId: string; name: string; version: string };
  target: { kind: "package" } | UtilityContribution["target"] | { kind: "built-in"; view: "github-forks" | "json-formatter" | "ai-resource-prompt" };
  available: boolean;
  unavailableReason: string | null;
}

/** Scoped sandbox locations only. No host routes, remote URLs or traversal. */
export function validUtilityLocation(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\#\u0000-\u001f]/.test(value)) return false;
  try {
    const [path, query = ""] = value.split(/\?(.*)/s, 2);
    if (new URLSearchParams(query).has("hostSettings")) return false;
    return path.split("/").filter(Boolean).map(decodeURIComponent).every(part => part !== "." && part !== ".." && !/[\\/\u0000-\u001f]/.test(part));
  } catch { return false; }
}

export function validateUtilityContributions(value: unknown, context: { actionIds: Set<string>; sandboxWorkspace: boolean }): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 64) return "integration utilities must be an array of at most 64 entries";
  const ids = new Set<string>();
  const bounded = (v: unknown, max: number): v is string => typeof v === "string" && Boolean(v.trim()) && v.length <= max;
  for (const utility of value) {
    if (!utility || typeof utility !== "object" || Array.isArray(utility)) return "every utility must be an object";
    if (Object.keys(utility).some(key => !["id", "title", "description", "category", "keywords", "target"].includes(key))) return "utility contains an unsupported field";
    if (typeof utility.id !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(utility.id) || ids.has(utility.id)) return "utility id must be valid and unique within its plugin";
    ids.add(utility.id);
    if (!bounded(utility.title, 120) || !bounded(utility.description, 500) || !bounded(utility.category, 48)) return `utility ${utility.id} requires bounded title, description and category`;
    if (utility.keywords !== undefined && (!Array.isArray(utility.keywords) || utility.keywords.length > 12 || utility.keywords.some((word: unknown) => !bounded(word, 48)))) return `utility ${utility.id} has invalid keywords`;
    const target = utility.target;
    if (!target || typeof target !== "object" || Array.isArray(target)) return `utility ${utility.id} requires a target`;
    if (target.kind === "action") {
      if (Object.keys(target).some(key => !["kind", "actionId"].includes(key)) || !context.actionIds.has(target.actionId)) return `utility ${utility.id} must reference an action in the same plugin`;
    } else if (target.kind === "workspace") {
      if (Object.keys(target).some(key => !["kind", "location"].includes(key)) || !context.sandboxWorkspace || (target.location !== undefined && !validUtilityLocation(target.location))) return `utility ${utility.id} requires a sandbox workspace and a scoped location`;
    } else return `utility ${utility.id} has an unsupported target kind`;
  }
  return null;
}

export function pluginUtilityId(pluginId: string, utilityId: string) { return `plugin:${pluginId}:${utilityId}`; }
export function utilityHref(id: string) { return `#/utilities/${encodeURIComponent(id)}`; }

export const BUILTIN_UTILITIES: UtilityDefinition[] = [
  { id: "builtin:ai-resource-prompt", title: "AI resource prompt", description: "Choose any combination of datasets and plugins, describe your task, and copy access instructions for your AI.", category: "Data & AI", keywords: ["agent", "prompt", "datasets", "data spaces", "plugins", "jupyter", "copy"], source: { kind: "built-in" }, target: { kind: "built-in", view: "ai-resource-prompt" }, available: true, unavailableReason: null },
  { id: "builtin:github-forks", title: "GitHub fork explorer", description: "Find forks and branches with changes ahead of upstream. Save, pause and resume scans.", category: "Development", keywords: ["git", "repository", "branches", "compare"], source: { kind: "built-in" }, target: { kind: "built-in", view: "github-forks" }, available: true, unavailableReason: null },
  { id: "builtin:json-formatter", title: "JSON formatter", description: "Validate, format and compact JSON in your browser.", category: "Development", keywords: ["developer", "data", "pretty print", "minify"], source: { kind: "built-in" }, target: { kind: "built-in", view: "json-formatter" }, available: true, unavailableReason: null },
];
