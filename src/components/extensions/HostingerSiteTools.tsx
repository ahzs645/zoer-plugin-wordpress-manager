import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type WordPressManagedSite } from "../../lib/api";
import { wordpressKeys } from "../../lib/queries/wordpress";
import { useOperationSession } from "@zoer/plugin-ui/workspace";
import { isDemoMode } from "@zoer/plugin-ui/workspace";
import { useDialogs } from "@zoer/plugin-ui/controls";
import { Btn as Btn } from "@zoer/plugin-ui/controls";

type Action = "clear-cache" | "enable-cacheless" | "disable-cacheless" | "detect-installations";
const labels: Record<Action, string> = {
  "clear-cache": "Clear cache",
  "enable-cacheless": "Turn on",
  "disable-cacheless": "Restore caching",
  "detect-installations": "Rescan",
};

/** What each request is called in its receipt line. */
const requestNames: Record<Action, string> = { "clear-cache": "Clear cache", "enable-cacheless": "Development mode on", "disable-cacheless": "Restore caching", "detect-installations": "Rescan WordPress installations" };

export default function HostingerSiteTools({ site }: { site: WordPressManagedSite }) {
  const client = useQueryClient();
  const session = useOperationSession();
  const dialogs = useDialogs();
  const locked = useRef(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(action: Action) {
    if (locked.current || isDemoMode()) return;
    locked.current = true; setBusy(action); setError(""); setNotice("");
    try {
      session.assertCurrent();
      if (action !== "clear-cache") {
        const description = action === "detect-installations"
          ? "Rescans WordPress installations across this connected hosting account. Refresh the site list after Hostinger finishes processing."
          : action === "enable-cacheless"
            ? `Bypasses Hostinger caching for ${site.domain} while you review changes. Restore caching when finished to recover normal performance.`
            : `Restores Hostinger caching for ${site.domain} after development.`;
        const title = action === "enable-cacheless" ? "Turn on development mode?" : action === "detect-installations" ? "Rescan WordPress installations?" : `${labels[action]}?`;
        if (!await dialogs.confirm({ title, description, confirmLabel: action === "enable-cacheless" ? "Turn on development mode" : labels[action] })) return;
      }
      session.assertCurrent();
      const result = await api.runHostingerSiteTool(site.id, action);
      if (!session.isCurrent()) return;
      setNotice(`Hostinger accepted “${requestNames[action]}” at ${new Date(result.requestedAt).toLocaleTimeString()}. Processing can take a moment. ${action === "detect-installations" ? "Refresh the site list afterward." : "Reload the website to check the result."}`);
      void client.invalidateQueries({ queryKey: wordpressKeys.all() });
    } catch (e) { if (session.isCurrent()) setError(e instanceof Error ? e.message : "Hostinger could not accept this request."); }
    finally { locked.current = false; if (session.isCurrent()) setBusy(null); }
  }
  const button = (action: Action, variant?: "primary") => <Btn size="sm" variant={variant} disabled={busy !== null || isDemoMode()} loading={busy === action} onClick={() => void run(action)}>{labels[action]}</Btn>;
  const row = (title: string, detail: string, actions: React.ReactNode) => <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><p className="text-sm font-medium text-text-primary">{title}</p><p className="text-xs text-text-secondary">{detail}</p></div>
    <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
  </li>;
  return <section aria-label="Hostinger maintenance tools" className="min-w-0 space-y-3 rounded-lg border border-border-default p-4">
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
      <h4 className="text-sm font-semibold text-text-heading">Hosting cache</h4>
      {site.domain && <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]"><a className="text-accent underline" href={`https://hpanel.hostinger.com/websites/${encodeURIComponent(site.domain)}`} target="_blank" rel="noreferrer">Hostinger dashboard</a><a className="text-accent underline" href={`https://${site.domain}/wp-admin/`} target="_blank" rel="noreferrer">WordPress dashboard</a></div>}
    </div>
    <ul className="divide-y divide-border-muted">
      {row("Clear cache", "Empties Hostinger's website cache, and its CDN when that is on.", button("clear-cache"))}
      {row("Development mode", "Turns Hostinger caching off while you review changes. Hostinger does not report which mode is on, so restore caching when you're done.", <>{button("enable-cacheless")}{button("disable-cacheless")}</>)}
      {row("WordPress detection", "Rescans the WordPress installations of the whole hosting account, for example after one was added in hPanel.", button("detect-installations"))}
    </ul>
    {error && <p role="alert" className="break-words text-sm text-status-warning">{error}</p>}
    {notice && <p role="status" className="break-words text-sm text-text-secondary">{notice}</p>}
  </section>;
}
