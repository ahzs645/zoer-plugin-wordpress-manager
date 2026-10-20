import type { WordPressManagedSite } from "../../lib/api";

/** Hosting accounts and connected external sites never inherit local runtime controls. */
export function wordpressLifecycleAction(site: Pick<WordPressManagedSite, "provider" | "environment" | "status">): "start" | "stop" | null {
  if (!isLocalWordPress(site)) return null;
  if (site.status === "running") return "stop";
  if (["stopped", "exited", "created"].includes(site.status)) return "start";
  return null;
}

export function isLocalWordPress(site: Pick<WordPressManagedSite, "provider" | "environment">): boolean {
  return (["ddev", "kubernetes"].includes(site.provider) && site.environment === "local") || (site.provider === "playground" && site.environment === "playground");
}
