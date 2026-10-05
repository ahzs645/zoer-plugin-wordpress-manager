// Action dispatch of the plugin transfer engine (shared by the worker entry, tests and the parity harness).
import { copySpec, restoreSpec } from "./copy.js";
import { pullSpec } from "./pull.js";
import { previewSpec, pushControl, pushSpec } from "./push.js";
import { runResumable } from "./slices.js";

export const RESUMABLE_ACTIONS = {
  "transfer.pull": pullSpec("pull"),
  "transfer.local-export": pullSpec("local-export"),
  "transfer.preview": previewSpec,
  "transfer.push": pushSpec("push"),
  "transfer.replace": pushSpec("replace"),
  "copy.local": copySpec,
  "backup.restore-local": restoreSpec,
};

/**
 * `resourceLimits.maxOutputBytes` of each resumable action in plugin/manifest.json (a test keeps
 * them equal). Zoer counts all worker stdout, host calls included, against it.
 */
export const OUTPUT_LIMITS = {
  "transfer.pull": 4194304,
  "transfer.local-export": 4194304,
  "transfer.preview": 4194304,
  "transfer.push": 12582912,
  "transfer.replace": 4194304,
  "copy.local": 4194304,
  "backup.restore-local": 4194304,
};

/** Runs one slice (resumable actions) or one action; returns the runner output. */
export async function runTransferAction(request, host, clock) {
  const id = request.action?.id;
  if (id === "transfer.push.control") return pushControl(request.input ?? {}, { host, request });
  const spec = RESUMABLE_ACTIONS[id];
  if (!spec) throw new Error("Unsupported transfer action.");
  return runResumable(request, host, spec, clock, { outputLimit: OUTPUT_LIMITS[id] });
}
