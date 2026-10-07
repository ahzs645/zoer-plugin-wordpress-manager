import type { WordPressDeployment } from "../../lib/api";
import { wordpressExtensionActionLabel } from "./wordpressExtensionActions";

/** Match the saved connection IDs, never a coincidentally matching display name/domain. */
export function wordpressExtensionLogs(receipts: WordPressDeployment[], siteIds: string[]): WordPressDeployment[] {
  const ids = new Set(siteIds);
  return receipts.filter(receipt => receipt.type === "extension-change" &&
    ((!!receipt.sourceSiteId && ids.has(receipt.sourceSiteId)) || (!!receipt.targetSiteId && ids.has(receipt.targetSiteId))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function wordpressExtensionLogLabel(receipt: WordPressDeployment): string {
  const operation = receipt.details.operation;
  const kind = receipt.details.kind;
  if ((kind === "plugin" || kind === "theme") &&
    (operation === "install" || operation === "activate" || operation === "deactivate" || operation === "update" || operation === "uninstall")) {
    return `${wordpressExtensionActionLabel(operation)} ${kind}${wordpressExtensionLogSlugs(receipt).length > 1 ? "s" : ""}`;
  }
  return receipt.step || "Extension change";
}

export function wordpressExtensionLogSlugs(receipt: WordPressDeployment): string[] {
  return Array.isArray(receipt.details.slugs) ? receipt.details.slugs.filter((slug): slug is string => typeof slug === "string") : [];
}

export function wordpressExtensionLogStatus(receipt: WordPressDeployment): string {
  switch (receipt.status) {
    case "queued": return "Accepted · waiting for verification";
    case "succeeded": return "Verified";
    case "failed": return "Failed";
    case "outcome_unknown": return "Outcome unknown";
    case "verification_required": return "Verification required";
    default: return receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1);
  }
}
