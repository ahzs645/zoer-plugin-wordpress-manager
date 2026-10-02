import { useState } from "react";
import { ArrowLeftRight, Eye, EyeOff } from "lucide-react";
import { useWordPressDiagnostics, useZoerConnection } from "../../lib/queries/wordpress-transfer";
import { hasCapability } from "../../lib/wordpress-transfer/options";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import WordPressLocalCopy from "./WordPressLocalCopy";
import { Modal as Modal } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import ConnectionCard from "./wordpressTransfer/ConnectionCard";
import TransferWorkspace from "./wordpressTransfer/TransferWorkspace";

export default function WordPressConnect({ siteId, siteName, label = "Connect Zoer", primary = false }: { siteId: string; siteName: string; /** Already-connected sites read "Transfers": the dialog is where pulls, pushes and backups run. */ label?: string; /** The site's main action (an external site has no WordPress admin button). */ primary?: boolean }) {
  const [copyPull, setCopyPull] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState("");
  const [show, setShow] = useState(false);
  const [replacing, setReplacing] = useState(false);
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
  const close = () => { if (!busy) { setOpen(false); setInfo(""); setShow(false); setReplacing(false); } };
  return <>
    <Btn size={primary ? undefined : "sm"} variant={primary ? "primary" : undefined} icon={primary ? <ArrowLeftRight className="h-4 w-4" /> : undefined} onClick={() => { setOpen(true); void conn.refetch(); }}>{label}</Btn>
    {open && <Modal mobileSheet size="wide" title={`Zoer Connect · ${siteName}`} onClose={close}>
      <div className="min-w-0 space-y-4 text-sm">
        {conn.isLoading && <p className="text-text-secondary">Loading connection…</p>}
        {!conn.isLoading && (!connection || replacing) && <p className="text-text-secondary">In this site's WordPress admin, open <strong>Tools → Zoer Connect</strong>, generate a key and copy its connection info. Requires version 0.2 or later; 0.4.0 enables every option below.</p>}
        {connection && <ConnectionCard connection={connection} diagnostics={diagnostics.data} diagnosticsError={diagnostics.error instanceof Error ? diagnostics.error.message : null} busy={busy}
          onTest={() => void run("test")} onReplace={() => setReplacing(true)} onDisconnect={() => void run("disconnect")} />}
        {!conn.isLoading && (!connection || replacing) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run("save"); }}>
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
        {connection && !replacing && <TransferWorkspace siteId={siteId} connection={connection} diagnostics={diagnostics.data} diagnosticsLoading={diagnostics.isLoading} busy={busy} onLocalCopy={id => { setCopyPull(id); setCopyOpen(true); }} />}
        {connection && !replacing && <Btn onClick={() => { setCopyPull(null); setCopyOpen(true); }}>View local copies</Btn>}
        {error && <p role="alert" className="text-status-error">{error}</p>}
        <p className="text-xs text-text-secondary">The key is stored encrypted on the Zoer server and is not returned to this form. Transfers run on the Zoer server, so you can close this dialog while they continue.</p>
      </div>
    </Modal>}
    {open && copyOpen && <Modal title={copyPull ? "Make a local copy" : "Local copies"} onClose={() => setCopyOpen(false)}><WordPressLocalCopy siteId={siteId} pullId={copyPull} /></Modal>}
  </>;
}
