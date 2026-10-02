import { useRef } from "react";
import type { ExportOptions } from "../../lib/api/types/wordpress-transfer";
import { useWordPressPulls, type PullTransferAction } from "../../lib/queries/wordpress-pulls";
import { pullOptionsPayload } from "../../lib/wordpress-transfer/options";
import { WordPressPullJobs } from "./WordPressPullJobs";
import { Btn as Btn } from "@zoer/plugin-ui/controls";

/** Starts a pull (remote) or a local DDEV export with the given 0.4 options and lists its jobs. */
export default function WordPressPull({ siteId, enabled, local = false, action = "pull", options, errors = [], startLabel, notices = [], onReady, readyLabel }: {
  siteId: string; enabled: boolean; local?: boolean; action?: PullTransferAction; options: ExportOptions; errors?: string[]; startLabel?: string; notices?: string[];
  onReady?: (id: string) => void; readyLabel?: string;
}) {
  const pulls = useWordPressPulls(siteId, local);
  const busy = pulls.pending.length > 0;
  const active = pulls.jobs.some(job => job.running || job.pendingAction);
  const startRequest = useRef<{ id: string; options: string } | null>(null);
  async function start() {
    try {
      const serialized = pullOptionsPayload(options);
      if (startRequest.current?.options !== serialized) startRequest.current = { id: crypto.randomUUID().replaceAll("-", ""), options: serialized };
      await pulls.command({ action: "start", options: serialized, requestId: startRequest.current.id, transferAction: action });
      startRequest.current = null;
    } catch { /* The shared mutation displays the error and preserves the request ID. */ }
  }
  const blocked = !enabled || !pulls.serverRunner || busy || active || errors.length > 0;
  return <div className="min-w-0 space-y-3">
    {!enabled && !local && <p className="text-xs text-text-secondary">Requires a plugin release supporting Pull, and Pull permission enabled in WordPress → Tools → Zoer Connect.</p>}
    {notices.map(notice => <p key={notice} className="text-xs text-status-warning">{notice}</p>)}
    {errors.map(error => <p key={error} className="text-xs text-status-error">{error}</p>)}
    {active && <p className="text-xs text-text-secondary">A transfer is already running for this site. Wait for it to finish or pause it below.</p>}
    <Btn variant="primary" disabled={blocked} loading={busy && pulls.pending.some(c => c.action === "start")} onClick={() => void start()}>{startLabel ?? (local ? "Prepare export" : "Start pull")}</Btn>
    <WordPressPullJobs siteId={siteId} local={local} enabled={enabled} onReady={onReady} readyLabel={readyLabel} />
  </div>;
}
