import { COMPONENTS } from "./updraftFiles";
export type BackupFormat = "updraft" | "hostinger";
export type BackupComponent = "database" | "plugins" | "themes" | "uploads" | "others" | "archive";
export const backupComponents = (format: BackupFormat): BackupComponent[] => format === "hostinger" ? ["database", "archive"] : COMPONENTS;
const suffixes: Record<BackupComponent, RegExp> = { database: /-db\.gz$/i, plugins: /-plugins\.zip$/i, themes: /-themes\.zip$/i, uploads: /-uploads\.zip$/i, others: /-others\.zip$/i, archive: /\.tar\.gz$/i };
export function classifyBackup(name: string, format: BackupFormat): BackupComponent | null {
  if (format === "hostinger") return /\.sql\.gz$/i.test(name) ? "database" : /\.tar\.gz$/i.test(name) ? "archive" : null;
  return COMPONENTS.find(c => suffixes[c].test(name)) ?? null;
}
export function backupIdentity(name: string, component: BackupComponent, format: BackupFormat): string {
  if (format === "updraft") return name.replace(suffixes[component], "");
  const m = /^([A-Za-z0-9]+)(?:_[A-Za-z0-9]+)?\.([A-Za-z0-9.-]+)\.(\d{14})\.(tar|sql)\.gz$/i.exec(name);
  if (!m) throw new Error("Use the original Hostinger hPanel download filenames.");
  return [m[1],m[2],m[3]].join(".").toLowerCase();
}
export function backupSelectionError(files: Partial<Record<BackupComponent, File>>, format: BackupFormat): string | null {
  const components = backupComponents(format);
  const selected = components.flatMap(c => files[c] ? [{ component: c, file: files[c]! }] : []);
  try {
    if (new Set(selected.map(({ component, file }) => backupIdentity(file.name, component, format))).size > 1) return format === "hostinger" ? "Both files must belong to the same Hostinger account, website and backup time." : "All five files must come from the same UpdraftPlus backup set.";
  } catch (error) { return (error as Error).message; }
  if (selected.some(({ file }) => file.size <= 0 || file.size > 1024 ** 3)) return "Each backup file must be between 1 byte and 1 GiB.";
  if (selected.reduce((sum, { file }) => sum + file.size, 0) > 2 * 1024 ** 3) return "The complete backup set must be 2 GiB or smaller.";
  return null;
}
