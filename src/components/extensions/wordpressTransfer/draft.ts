import type { ExportOptions, ImportOptions, TransferAction } from "../../../lib/api/types/wordpress-transfer";
import { defaultExportOptions, defaultImportOptions, exportOptionsForAction, TRANSFER_ACTIONS } from "../../../lib/wordpress-transfer/options";

export type PushSourceKind = "local-export" | "pull";
export type TransferDraft = {
  action: TransferAction;
  exportOptions: ExportOptions;
  importOptions: ImportOptions;
  sourceKind: PushSourceKind;
  sourceSiteId: string;
  /** Profile the settings were loaded from, sent as `profileId` and used for Overwrite. */
  profileId: string | null;
};
export type DraftUpdate = (update: (draft: TransferDraft) => TransferDraft) => void;

export function initialDraft(action: TransferAction = "pull"): TransferDraft {
  return { action, exportOptions: defaultExportOptions(action), importOptions: defaultImportOptions(), sourceKind: "local-export", sourceSiteId: "", profileId: null };
}

/**
 * The tile a transfer dialog opens on: `preferred` when the site allows it, else the first
 * available tile (a push-only destination opens on Push, not on a disabled Pull).
 */
export function initialAction(availability: Record<TransferAction, string | null>, preferred: TransferAction = "pull"): TransferAction {
  if (!availability[preferred]) return preferred;
  return TRANSFER_ACTIONS.find(action => !availability[action]) ?? preferred;
}

/** Switching action keeps compatible settings but resets resources that the old action locked. */
export function switchAction(draft: TransferDraft, action: TransferAction): TransferDraft {
  if (draft.action === action) return draft;
  const fromBackup = draft.action === "backup" || draft.action === "replace";
  const resources = fromBackup ? defaultExportOptions(action).resources : draft.exportOptions.resources;
  // Find & Replace stores its table list in `database.tables`; never carry it into a transfer or back.
  const database = draft.action === "replace" || action === "replace" ? defaultExportOptions(action).database : draft.exportOptions.database;
  return { ...draft, action, exportOptions: exportOptionsForAction(action, { ...draft.exportOptions, resources, database }) };
}
