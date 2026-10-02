import type { WordPressExtensionKind, WordPressExtensionOperation } from "../../lib/api";

export function wordpressExtensionActions(
  kind: WordPressExtensionKind,
  status: string,
  updateAvailable: boolean
): WordPressExtensionOperation[] {
  if (status !== "active" && status !== "inactive") return [];

  const actions: WordPressExtensionOperation[] = [];
  if (updateAvailable) actions.push("update");
  if (kind === "plugin" && status === "active") actions.push("deactivate");
  if (status === "inactive") actions.push("activate");
  if (kind === "plugin" || status === "inactive") actions.push("uninstall");
  return actions;
}
