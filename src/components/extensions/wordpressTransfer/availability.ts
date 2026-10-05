import type { TransferAction, ZoerConnectConnection } from "../../../lib/api/types/wordpress-transfer";
import { hasCapability, REQUIRES_040 } from "../../../lib/wordpress-transfer/options";

/** Why each transfer action is unavailable on a Zoer Connect site (null: available). */
export function actionAvailability(connection: ZoerConnectConnection): Record<TransferAction, string | null> {
  const s = connection.status;
  const pull = !s.pull ? "Enable Pull in WordPress → Tools → Zoer Connect" : !s.stagingReady ? "Private storage is unavailable on this site" : null;
  return {
    pull, backup: pull, export: pull,
    push: !s.push ? "Enable Push in WordPress → Tools → Zoer Connect" : !s.publish ? "Update Zoer Connect to an import-capable release" : null,
    replace: !hasCapability(s.capabilities, "siteReplace") ? REQUIRES_040 : !s.push ? "Enable Push in WordPress → Tools → Zoer Connect" : !s.publish ? "Update Zoer Connect to an import-capable release" : null,
  };
}
