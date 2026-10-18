import { Loader2 } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import { progressView } from "./runState";
import type { ActiveSiteRun } from "./siteActivity";

/**
 * Above a site's sections while a transfer runs on it: what is running, how far it got, and
 * whether the site's own changes wait for it. Controls (pause, cancel, review) are in Activity.
 */
export default function ActiveTransferBanner({ active, onOpen }: { active: ActiveSiteRun[]; onOpen?: () => void }) {
  const first = active[0];
  if (!first) return null;
  const progress = progressView(first.run.resumable?.progress);
  const started = new Date(first.run.createdAt);
  const startedText = Number.isFinite(started.getTime()) ? started.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const paused = active.some(item => item.writes);
  const waiting = active.find(item => item.needsUser);
  const facts = [startedText && `started ${startedText}`, progress && [progress.label, progress.percent !== null ? `${progress.percent}%` : progress.detail].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
  return <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[13px] text-status-warning">
    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
    <p className="min-w-0 flex-1 break-words">
      {waiting ? <strong className="font-semibold">{waiting.title} is waiting for you</strong> : <strong className="font-semibold">{first.title}</strong>}{!waiting && facts && <span> · {facts}</span>}
      {active.length > 1 && <span> · {active.length - 1} more running</span>}
      <span className="block text-[12px] opacity-90">{paused ? "Plugin, theme, backup and lifecycle changes on this site wait until it finishes." : "This site is being read; you can keep working."}</span>
    </p>
    {onOpen && <Btn size="sm" variant={waiting ? "primary" : "secondary"} onClick={onOpen}>{waiting ? "Review" : "View progress"}</Btn>}
  </div>;
}
