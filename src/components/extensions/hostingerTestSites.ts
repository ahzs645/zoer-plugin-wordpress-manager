import type { HostingerConnectionPublic, HostingerSetupInventory, WordPressDeployment } from "../../lib/api";

/** One Hostinger website Zoer created with Zoer Connect (`site-provision` receipt). */
export interface HostingerTestSite {
  id: string;
  connectionId: string;
  domain: string;
  status: WordPressDeployment["status"];
  step: string;
  error: string | null;
  createdAt: string;
  running: boolean;
  ready: boolean;
  deleted: boolean;
  warnings: string[];
}

const RUNNING = ["queued", "preparing", "uploading", "verifying"];

/** Websites created here, newest first; receipts without a domain or account are left out. */
export function hostingerTestSites(deployments: WordPressDeployment[]): HostingerTestSite[] {
  return deployments.flatMap((item) => {
    const provision = (item.details as { provision?: { deletedAt?: unknown; warnings?: unknown } } | undefined)?.provision;
    if (item.type !== "site-provision" || !provision || !item.domain || !item.connectionId) return [];
    return [{
      id: item.id, connectionId: item.connectionId, domain: item.domain, status: item.status, step: item.step, error: item.error, createdAt: item.createdAt,
      running: RUNNING.includes(item.status), ready: item.status === "succeeded", deleted: typeof provision.deletedAt === "string",
      warnings: Array.isArray(provision.warnings) ? provision.warnings.filter((value): value is string => typeof value === "string") : [],
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A hosting plan of one connected account; the value names both, so plans of several accounts share one list. */
export interface HostingerPlanOption { value: string; connectionId: string; orderId: number; label: string; disabled: boolean }

export function hostingerPlanOptions(connections: HostingerConnectionPublic[], inventories: Record<string, HostingerSetupInventory | undefined>): HostingerPlanOption[] {
  return connections.flatMap((connection) => (inventories[connection.id]?.orders ?? []).map((order) => {
    const websites = inventories[connection.id]!.websites.filter((site) => site.orderId === order.id).length;
    const plan = order.name.replace(/^hostinger_/, "").replace(/_/g, " ");
    return {
      value: `${connection.id}:${order.id}`, connectionId: connection.id, orderId: order.id, disabled: order.status !== "active",
      label: `${connections.length > 1 ? `${connection.name} · ` : ""}${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan · ${websites} website${websites === 1 ? "" : "s"}${order.status === "active" ? "" : ` · ${order.status}`}`,
    };
  }));
}
