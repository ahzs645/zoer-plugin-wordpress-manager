import type { TransferAction, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { hasCapability, REQUIRES_040 } from "../../../lib/wordpress-transfer/options";

/** Zoer Connect's own settings page on a site. */
export function zoerConnectSettingsUrl(siteUrl: string) {
  return `${siteUrl.replace(/\/+$/, "")}/wp-admin/tools.php?page=zoer-connect`;
}

/**
 * `publish` is false until an administrator completes "Destination import setup" (Check requests
 * and enable imports) on Zoer Connect's page; the plugin version is not the cause.
 */
export const IMPORT_SETUP_NEEDED = "Finish “Destination import setup” in WordPress → Tools → Zoer Connect";
export const PUSH_OFF = "Turn on Push in WordPress → Tools → Zoer Connect";
export const PULL_OFF = "Turn on Pull in WordPress → Tools → Zoer Connect";
export const STORAGE_MISSING = "Set a private storage folder in WordPress → Tools → Zoer Connect";

/** Why each transfer action is unavailable on a Zoer Connect site (null: available). */
export function actionAvailability(connection: ZoerConnectConnection): Record<TransferAction, string | null> {
  const s = connection.status;
  const pull = !s.pull ? PULL_OFF : !s.stagingReady ? STORAGE_MISSING : null;
  const push = !s.push ? PUSH_OFF : !s.publish ? IMPORT_SETUP_NEEDED : null;
  return {
    pull, backup: pull, export: pull, push,
    replace: !hasCapability(s.capabilities, "siteReplace") ? REQUIRES_040 : push,
  };
}

export interface ReadinessItem { key: string; label: string; ok: boolean; fix: string }

/** The destination checks a push needs, in the order an administrator fixes them. */
export function pushReadiness(connection: ZoerConnectConnection): ReadinessItem[] {
  const s = connection.status;
  return [
    { key: "push", label: "Push allowed", ok: s.push, fix: PUSH_OFF },
    { key: "imports", label: "Imports set up", ok: s.publish, fix: IMPORT_SETUP_NEEDED },
    { key: "storage", label: "Private storage", ok: s.stagingReady, fix: STORAGE_MISSING },
  ];
}
