import type { WordPressExtensionKind, WordPressExtensionOperation } from "../../lib/api";

export function wordpressExtensionActionLabel(operation: WordPressExtensionOperation): string {
  return operation === "uninstall" ? "Delete" : operation.charAt(0).toUpperCase() + operation.slice(1);
}

export function wordpressExtensionAutoUpdateLabel(value: string): string {
  if (value === "on" || value === "enabled") return "On";
  if (value === "off" || value === "disabled") return "Off";
  return "Not reported";
}

export function wordpressExtensionActions(
  kind: WordPressExtensionKind,
  status: string,
  updateAvailable: boolean
): WordPressExtensionOperation[] {
  // The active child theme depends on its parent. It can be updated, but never deleted here.
  if (kind === "theme" && status === "parent") return updateAvailable ? ["update"] : [];
  if (status !== "active" && status !== "inactive") return [];

  const actions: WordPressExtensionOperation[] = [];
  if (updateAvailable) actions.push("update");
  if (kind === "plugin" && status === "active") actions.push("deactivate");
  if (status === "inactive") actions.push("activate");
  if (kind === "plugin" || status === "inactive") actions.push("uninstall");
  return actions;
}
