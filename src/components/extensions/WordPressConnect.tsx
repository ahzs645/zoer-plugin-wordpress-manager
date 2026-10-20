import { useState } from "react";
import { ArrowLeftRight, Eye, EyeOff } from "lucide-react";
import { useWordPressDiagnostics, useZoerConnection } from "../../lib/queries/wordpress-transfer";
import { hasCapability } from "../../lib/wordpress-transfer/options";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Modal as Modal } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import ConnectionCard from "./wordpressTransfer/ConnectionCard";
import HostingerZoerConnect from "./HostingerZoerConnect";
import PluginLocalCopy from "./pluginEngine/PluginLocalCopy";
import PluginSiteRuns from "./pluginEngine/PluginSiteRuns";
import PluginTransferWorkspace from "./pluginEngine/PluginTransferWorkspace";
import { isTransferFence, TRANSFER_FENCE_NOTICE } from "./pluginEngine/runState";
import type { PullRecord } from "./pluginEngine/records";
import type { TransferAction } from "../../lib/api/types/wordpress-transfer";

export default function WordPressConnect({ siteId, siteName, label = "Connect Zoer", primary = false, headerButton = false, localCopy = false, onSetup, onRestore, initialPushSource, initialAction, autoOpen = false, onDismiss, hostinger = false, onConnected }: { siteId: string; siteName: string; /** A Hostinger website: Zoer checks for Zoer Connect and can connect it automatically. */ hostinger?: boolean; /** After Connect automatically saved the site's endpoint. */ onConnected?: () => void; /** Already-connected sites read "Transfers": the dialog is where pulls, pushes and backups run. */ label?: string; /** The site's main action (an external site has no WordPress admin button). */ primary?: boolean; /** A secondary header button beside the main action. */ headerButton?: boolean; localCopy?: boolean; initialPushSource?: string; /** The transfer tool the dialog opens on. */ initialAction?: TransferAction; autoOpen?: boolean; onDismiss?: () => void; onSetup?: () => void; onRestore?: () => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [open, setOpen] = useState(autoOpen);
  const [info, setInfo] = useState("");
  const [show, setShow] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [copyPull, setCopyPull] = useState<PullRecord | null>(null);
  const conn = useZoerConnection(siteId, open);
  const connection = conn.connection;
  const diagnosticsSupported = !!connection && (hasCapability(connection.status.capabilities, "diagnostics") || (connection.status.apiVersion ?? 0) >= 2);
  const diagnostics = useWordPressDiagnostics(siteId, { enabled: open && diagnosticsSupported });
  const busy = conn.commandPending;
  const loadError = conn.error instanceof Error ? conn.error.message : "";
  const error = conn.commandError instanceof Error ? conn.commandError.message : loadError;
  async function run(command: "save" | "test" | "disconnect") {
    try {
      await conn.command(command === "save" ? { action: "save", connectionInfo: info } : { action: command });
      if (command === "save") { setReplacing(false); setShow(false); }
    } catch { /* conn.commandError is shown */ }
    finally { if (command === "save") setInfo(""); }
  }
  const close = () => { if (!busy) { setOpen(false); setInfo(""); setShow(false); setReplacing(false); onDismiss?.(); } };
  return <>
    {!autoOpen && <Btn size={primary || headerButton ? undefined : "sm"} variant={primary ? "primary" : headerButton ? "secondary" : undefined} icon={primary || headerButton ? <ArrowLeftRight className="h-4 w-4" /> : undefined} onClick={() => { setOpen(true); void conn.refetch(); }}>{label}</Btn>}
    {open && <Modal mobileSheet size="wide" title={`${localCopy ? "Make a local copy" : connection ? "Transfers" : "Connect"} · ${siteName}`} onClose={close}>
      <div className="min-w-0 space-y-4 text-sm">
        
        {conn.isLoading && <p className="text-text-secondary">Loading connection…</p>}
        {localCopy && !conn.isLoading && !loadError && (!connection || replacing) && <div className="space-y-3 rounded-lg border border-border-default p-3"><h3 className="font-medium">Source access required</h3><p>This site needs Zoer Connect before it can export its database and files. Hosting account access alone does not provide a complete copy.</p>{hostinger && !replacing && <HostingerZoerConnect siteId={siteId} onConnected={() => { void conn.refetch(); onConnected?.(); }} />}<div className="flex flex-wrap gap-2">{onSetup && <Btn onClick={onSetup}>Open WordPress to set up Zoer Connect</Btn>}{onRestore && <Btn onClick={()=>{close();onRestore();}}>Restore from backup instead</Btn>}</div><p className="text-xs text-text-secondary">{hostinger ? "Or install it yourself with the steps below and paste its connection info, or restore a supported UpdraftPlus or Hostinger backup." : "Use the setup instructions below, or restore a supported UpdraftPlus or Hostinger backup."} A public website address alone cannot provide the database.</p></div>}
        {!conn.isLoading && !loadError && (!connection || replacing) && <ol className="list-decimal space-y-1 pl-5 text-text-secondary"><li><a className="underline" href="https://github.com/ahzs645/zoer-connect/releases/latest" target="_blank" rel="noreferrer">Download Zoer Connect</a> and activate it in WordPress.</li><li>Open <strong>Tools → Zoer Connect</strong> and turn on <strong>Pull</strong> (and <strong>Push</strong> to publish here).</li><li>Copy its connection info and paste it below.</li></ol>}
        {connection && <ConnectionCard connection={connection} diagnostics={diagnostics.data} diagnosticsError={diagnostics.error instanceof Error ? diagnostics.error.message : null} busy={busy}
          onTest={() => void run("test")} onReplace={() => setReplacing(true)} onDisconnect={() => void run("disconnect")} />}
        {!conn.isLoading && !loadError && (!connection || replacing) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run("save"); }}>
          <div><label className="block" htmlFor="zoer-connect-info">{connection ? "Replace connection info" : "Connection info"}</label>
            <div className={`${controlClass()} relative mt-2 w-full !p-0 focus-within:ring-2 focus-within:ring-indigo-500`} style={{ height: 96 }}>
              <textarea id="zoer-connect-info" required maxLength={4096} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} className={`h-full w-full resize-none rounded-md bg-transparent p-3 pr-12 font-mono text-base outline-none sm:text-sm ${show ? "" : "opacity-0"}`} value={info} onChange={event => setInfo(event.target.value)} />
              {(!show || !info) && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 right-12 flex items-center justify-center text-center"><span className={info ? "text-lg tracking-widest" : "text-sm text-text-secondary"}>{info ? "••••" : "Paste the site address and generated key"}</span></div>}
              <button type="button" aria-label={show ? "Hide connection info" : "Show connection info"} aria-pressed={show} onClick={() => setShow(value => !value)} className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-text-secondary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">{show ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}</button>
            </div>
          </div>
          {connection && <p className="text-xs text-text-secondary">This replaces the key for this site. It does not add another connection.</p>}
          <div className="flex flex-wrap gap-2"><Btn type="submit" variant="primary" disabled={busy || !info.trim()} loading={busy}>Test and save connection</Btn>{connection && <Btn type="button" variant="ghost" disabled={busy} onClick={() => { setReplacing(false); setInfo(""); setShow(false); }}>Cancel</Btn>}</div>
        </form>}
        {connection && !connection.status.stagingReady && <p role="alert" className="text-status-warning">{connection.status.storage?.message || "Private storage is unavailable. Open WordPress → Tools → Zoer Connect and configure a writable folder outside the public website before pulling."}</p>}
        {connection && !replacing && localCopy && <>{!(connection.status.pull && connection.status.stagingReady) && <p role="status" className="text-sm text-status-warning">Enable Pull and private storage in WordPress → Tools → Zoer Connect before copying.</p>}<PluginLocalCopy siteId={siteId} siteName={siteName} sourceUrl={connection.url} /><Btn variant="ghost" onClick={()=>setAdvanced(value=>!value)}>{advanced ? "Hide advanced transfers" : "Advanced transfers"}</Btn></>}
        {connection && !replacing && (!localCopy || advanced) && <PluginTransferWorkspace siteId={siteId} siteName={siteName} connection={connection} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} initialPushSource={initialPushSource} initialAction={initialAction} onLocalCopy={pull => { setCopyPull(pull); setCopyOpen(true); }} />}
        {loadError && <div className="space-y-2"><p>{isTransferFence(loadError) ? TRANSFER_FENCE_NOTICE : "Could not check saved source access. Retry when Zoer is reachable; this does not mean the site needs pairing again."}</p><Btn disabled={busy} onClick={()=>void conn.refetch()}>Retry connection check</Btn></div>}
        {/* The site may be fenced by a running push or rollback: its runs still need to be followed and controlled. */}
        {!connection && loadError && <PluginSiteRuns siteId={siteId} />}
        {error && !(loadError && isTransferFence(error)) && <p role="alert" className="text-status-error">{error}</p>}
        <p className="text-xs text-text-secondary">{connection && !replacing ? "Transfers keep running if you close this dialog." : "The key is stored encrypted on the Zoer server."}</p>
      </div>
    </Modal>}
    {/* A local copy from one of the downloads; new copies and refreshes otherwise start from the site page's Pull. */}
    {open && copyOpen && copyPull && <Modal mobileSheet title="Local copy from a download" onClose={() => { setCopyOpen(false); setCopyPull(null); }}>
      <PluginLocalCopy siteId={siteId} siteName={siteName} sourceUrl={copyPull.source?.url ?? connection?.url} pull={copyPull} heading={false} />
    </Modal>}
  </>;
}
