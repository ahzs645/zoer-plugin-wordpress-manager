import { useState } from "react";
import { FlaskConical, Server } from "lucide-react";
import { Btn, Modal, StatusBadge, checkboxClass, controlClass, useDialogs } from "@zoer/plugin-ui/controls";
import { useRecentRuns, useSiteEngine } from "../../../lib/queries/plugin-engine";
import { confirmationHost, ENGINE_LABELS, pluginSwitchConfirmed } from "./engineRecord";
import { engineErrorMessage, isTerminalStatus, runsOfSite, SITE_RUN_ACTIONS } from "./runState";


/** Shown wherever a site's transfers are reached; renders nothing for legacy sites. */
export function SiteEngineBadge({ siteId, className = "" }: { siteId: string | null | undefined; className?: string }) {
  const { engine } = useSiteEngine(siteId);
  if (engine !== "plugin") return null;
  return <StatusBadge tone="warning" icon={<FlaskConical aria-hidden="true" />} className={className}>Plugin engine (test)</StatusBadge>;
}

/**
 * Per-site "Transfer engine" setting. Legacy is the default (no record). Switching to the plugin
 * engine needs the explicit non-production acknowledgement and the typed host name (the same
 * strictness as Remove from Zoer's typed phrase); switching back needs a simple confirmation.
 */
export default function SiteEngineControl({ siteId, siteName, origin, production = false, disabled = false, compact = false }: {
  siteId: string; siteName: string; origin: string | null | undefined; /** Zoer lists this site as production: the dialog says so. */ production?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const dialogs = useDialogs();
  const site = useSiteEngine(siteId);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const host = confirmationHost(origin);
  const plugin = site.engine === "plugin";
  // Import controls (approve, finish, roll back) refuse legacy sites, so keep the engine while work is open.
  const runs = useRecentRuns(SITE_RUN_ACTIONS, { enabled: plugin });
  const openRuns = runsOfSite(runs.data ?? [], siteId).filter(run => !isTerminalStatus(run.status)).length;
  const ready = pluginSwitchConfirmed({ host, typed, acknowledged });

  const close = () => { if (saving) return; setOpen(false); setTyped(""); setAcknowledged(false); setError(""); };
  async function usePlugin() {
    if (!ready) return;
    setSaving(true); setError("");
    try { await site.setEngine({ engine: "plugin", testTargetConfirmed: true, label: siteName, origin: origin ?? null }); setOpen(false); setTyped(""); setAcknowledged(false); }
    catch (caught) { setError(engineErrorMessage(caught, "The engine could not be changed.")); }
    finally { setSaving(false); }
  }
  async function useLegacy() {
    const confirmed = await dialogs.confirm({ title: "Switch back to the legacy engine?", description: `New transfers for ${siteName} will run on the Zoer host again. Rolling back or cleaning up a finished plugin-engine push needs the plugin engine, so do that first. Plugin-engine downloads stay on the Zoer server.`, confirmLabel: "Use legacy engine", cancelLabel: "Keep plugin engine" });
    if (!confirmed) return;
    setSaving(true); setError("");
    try { await site.setEngine({ engine: "legacy", label: siteName, origin: origin ?? null }); }
    catch (caught) { setError(engineErrorMessage(caught, "The engine could not be changed.")); }
    finally { setSaving(false); }
  }

  const unavailable = site.error ? "Transfer engine settings are unavailable on this Zoer server." : !host ? "This site has no address to confirm." : null;
  return <section aria-label="Transfer engine" className={`min-w-0 rounded-lg border p-3 ${plugin ? "border-status-warning/40 bg-status-warning/5" : "border-border-default"}`}>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          <span>Transfer engine</span>
          <StatusBadge tone={plugin ? "warning" : "neutral"} icon={plugin ? <FlaskConical aria-hidden="true" /> : <Server aria-hidden="true" />}>{site.isLoading ? "Checking…" : ENGINE_LABELS[site.engine]}</StatusBadge>
        </p>
        {!compact && <p className="mt-1 text-xs text-text-secondary">{plugin
          ? `Transfers for this site run as WordPress Manager actions. Confirmed as a non-production test site${site.data?.confirmedAt ? ` on ${new Date(site.data.confirmedAt).toLocaleString()}` : ""}.`
          : "Transfers run on the Zoer host, as before. The plugin engine is a test feature for non-production sites only."}</p>}
      </div>
      <Btn size="sm" className="w-full shrink-0 sm:w-auto" variant={plugin ? "secondary" : "ghost"} disabled={disabled || saving || site.isLoading || (!plugin && !!unavailable) || (plugin && openRuns > 0)} loading={saving && !open}
        onClick={() => plugin ? void useLegacy() : setOpen(true)}>{plugin ? "Switch to legacy…" : "Use plugin engine (test)…"}</Btn>
    </div>
    {!plugin && unavailable && !site.isLoading && <p className="mt-2 text-xs text-text-secondary">{unavailable}</p>}
    {plugin && openRuns > 0 && <p className="mt-2 text-xs text-text-secondary">Finish, roll back or cancel this site's {openRuns === 1 ? "open transfer" : `${openRuns} open transfers`} before switching back to the legacy engine.</p>}
    {error && !open && <p role="alert" className="mt-2 break-words text-sm text-status-error">{error}</p>}

    {open && <Modal mobileSheet title={`Plugin transfer engine · ${siteName}`} onClose={close} aria-describedby="zoer-engine-switch-help"
      footer={<div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
        <Btn className="w-full sm:w-auto" variant="ghost" disabled={saving} onClick={close}>Cancel</Btn>
        <Btn className="w-full sm:w-auto" variant="danger" disabled={!ready || saving} loading={saving} onClick={() => void usePlugin()}>Switch this site to the plugin engine</Btn>
      </div>}>
      <div className="min-w-0 space-y-4 text-sm">
        <div id="zoer-engine-switch-help" className="space-y-2">
          <p>The plugin engine moves pulls, pushes, Find &amp; Replace, local copies and restores for <strong className="break-words">{siteName}</strong> into WordPress Manager's own resumable actions. It is new and is meant <strong>only for non-production test sites</strong>.</p>
          <ul className="list-disc space-y-1 pl-5 text-text-secondary">
            <li>Pushes and Find &amp; Replace still ask for Zoer's approval each time, and stop for review before anything is activated.</li>
            <li>Dry runs are on by default for pushes; they never activate anything on the site.</li>
            <li>Only this site changes engine. Every other site stays on the legacy engine.</li>
            <li>You can switch back to the legacy engine at any time.</li>
          </ul>
        </div>
        {production && <p role="note" className="rounded-md border border-status-error/40 bg-status-error/10 p-2 text-status-error">Zoer lists this site as a production website. Do not switch a live production site.</p>}
        <label className="flex min-h-11 items-start gap-2">
          <input type="checkbox" className={`${checkboxClass} mt-1`} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={saving} />
          <span>This is a non-production test site. Losing or overwriting its content is acceptable.</span>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block">Type <strong className="break-all font-mono">{host}</strong> to confirm</span>
          <input className={controlClass("default", "text-base sm:text-[14px]")} value={typed} onChange={event => setTyped(event.target.value)} placeholder={host} disabled={saving} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" aria-label="Type the site's host name to confirm" />
        </label>
        {typed && typed.trim().toLowerCase() !== host && <p className="text-xs text-status-warning">Does not match {host} yet.</p>}
        {error && <p role="alert" className="break-words text-status-error">{error}</p>}
      </div>
    </Modal>}
  </section>;
}
