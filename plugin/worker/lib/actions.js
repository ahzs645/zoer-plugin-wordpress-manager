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

/** Runs one slice (resumable actions) or one action; returns the runner output. */
export async function runTransferAction(request, host, clock) {
  const id = request.action?.id;
  if (id === "transfer.push.control") return pushControl(request.input ?? {}, { host, request });
  const spec = RESUMABLE_ACTIONS[id];
  if (!spec) throw new Error("Unsupported transfer action.");
  return runResumable(request, host, spec, clock);
}
