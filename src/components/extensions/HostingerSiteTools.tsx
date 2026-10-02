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
  "enable-cacheless": "Enable development mode",
  "disable-cacheless": "Restore caching",
  "detect-installations": "Refresh WordPress detection",
};

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
        if (!await dialogs.confirm({ title: `${labels[action]}?`, description, confirmLabel: labels[action] })) return;
      }
      session.assertCurrent();
      const result = await api.runHostingerSiteTool(site.id, action);
      if (!session.isCurrent()) return;
      setNotice(`Hostinger accepted “${labels[action]}” at ${new Date(result.requestedAt).toLocaleTimeString()}. Processing can take a moment. ${action === "detect-installations" ? "Refresh the site list afterward." : "Reload the website to check the result."}`);
      void client.invalidateQueries({ queryKey: wordpressKeys.all() });
    } catch (e) { if (session.isCurrent()) setError(e instanceof Error ? e.message : "Hostinger could not accept this request."); }
    finally { locked.current = false; if (session.isCurrent()) setBusy(null); }
  }
  return <section aria-label="Hostinger maintenance tools" className="space-y-3 rounded-md border border-border-default p-3">
    <h4 className="text-sm font-semibold text-text-heading">Cache & troubleshooting</h4>
    <p className="text-sm text-text-secondary">Clear Hostinger website cache, including CDN cache when enabled. Development mode bypasses caching until you restore it. Hostinger does not report the current mode here.</p>
    <div className="flex flex-wrap gap-2">{(Object.keys(labels) as Action[]).map(action => <Btn key={action} disabled={busy !== null || isDemoMode()} loading={busy === action} onClick={() => void run(action)}>{labels[action]}</Btn>)}</div>
    <p className="text-xs text-text-secondary">WordPress detection refresh applies to the hosting account. For backups, file access, and recovery, open the Hostinger dashboard.</p>
    {site.domain && <div className="flex flex-wrap gap-4 text-sm"><a className="text-accent underline" href={`https://hpanel.hostinger.com/websites/${encodeURIComponent(site.domain)}`} target="_blank" rel="noreferrer">Open Hostinger dashboard</a><a className="text-accent underline" href={`https://${site.domain}/wp-admin/`} target="_blank" rel="noreferrer">Open WordPress dashboard</a></div>}
    {error && <p role="alert" className="break-words text-sm text-status-warning">{error}</p>}
    {notice && <p role="status" className="break-words text-sm text-text-secondary">{notice}</p>}
  </section>;
}
