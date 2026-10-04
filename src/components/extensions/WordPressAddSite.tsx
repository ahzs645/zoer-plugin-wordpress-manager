import { useState } from "react";
import { hostEndpoints, runAction } from "../../host/actions";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Modal as Modal } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import { parseWordPressConnectionPaste } from "./wordpressConnectionPaste";

type SiteCheck = { ok: boolean; summary: string };

/**
 * Adds an external Zoer Connect site as a Zoer endpoint (S7b, `endpoints.add`): Zoer confirms,
 * probes the status route with the key and stores the key host-side; the site ID is the endpoint
 * ID. The `site.test` action then applies the Zoer Connect checks (address match, version,
 * connection key); a site that fails them is offered for removal again.
 *
 * The manager owns the trigger so it can sit in the toolbar or the phone Tools menu.
 */
export default function WordPressAddSite({ open, onOpenChange, onAdded, existingUrls = [] }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: (id: string) => Promise<void>; existingUrls?: readonly string[] }) {
  const setOpen = onOpenChange;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!busy) { setOpen(false); setKey(""); setUrl(""); setError(""); } };
  function pasteConnection(event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text/plain");
    event.preventDefault();
    const connection = parseWordPressConnectionPaste(text);
    if (!connection) {
      setKey(""); setUrl("");
      setError("Copy both lines from Tools → Zoer Connect. The key alone does not include the website address.");
      return;
    }
    setUrl(connection.url); setKey(connection.key); setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !url || !key) return;
    setBusy(true); setError("");
    try {
      if (existingUrls.some(address => address.replace(/\/+$/, "") === url)) throw new Error("This site is already listed. Select it and use Connect Zoer.");
      const { endpoint } = await hostEndpoints.add({ origin: url, key, ...(name.trim() ? { label: name.trim() } : {}) });
      setKey("");
      const check = await runAction<SiteCheck>("site.test", { endpointId: endpoint.id }).catch((caught): SiteCheck => ({ ok: false, summary: caught instanceof Error ? caught.message : "The site could not be checked." }));
      if (!check.ok) {
        setError(`${check.summary} Zoer saved the connection; remove it, then add the site again after fixing it.`);
        const { removed } = await hostEndpoints.remove(endpoint.id).catch(() => ({ removed: false }));
        if (removed) setError(`${check.summary} The connection was removed.`);
        else await onAdded(endpoint.id);
        return;
      }
      setOpen(false); setName(""); setUrl("");
      await onAdded(endpoint.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to add site."); }
    finally { setKey(""); setUrl(""); setBusy(false); }
  }
  return <>
    {open && <Modal mobileSheet title="Add WordPress site" onClose={close} footer={<><Btn disabled={busy} onClick={close}>Cancel</Btn><Btn form="add-wordpress-site" type="submit" variant="primary" disabled={busy || !url.trim() || !key.trim()} loading={busy}>Test and add site</Btn></>}>
      <form id="add-wordpress-site" onSubmit={submit} className="space-y-4 text-sm">
        <p id="wordpress-add-paste-help" className="text-text-secondary">In WordPress, open <strong>Tools → Zoer Connect</strong> and copy the connection info. Paste both lines together: the website address and key.</p>
        <label className="flex flex-col gap-1"><span>Connection info (website and key)</span><input className={controlClass()} type="password" required maxLength={4096} placeholder="Paste both connection lines" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="wordpress-add-paste-help" value={key} onPaste={pasteConnection} onChange={e => { setKey(e.target.value); setUrl(""); setError(e.target.value ? "Copy and paste the full connection info so Zoer can detect the website address." : ""); }} disabled={busy} /></label>
        {url && <p role="status" className="break-all text-sm text-text-secondary">Website detected: <span className="font-medium text-text-primary">{url}</span></p>}
        <label className="block space-y-1"><span>Site name (optional)</span><input className={controlClass()} maxLength={120} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
        <p className="text-xs text-text-secondary">Zoer asks you to confirm, tests the connection and keeps the key on the server; this page never sees it again. You can import content after connecting, if enabled in WordPress.</p>
        {error && <p role="alert" className="text-status-error">{error}</p>}
      </form>
    </Modal>}
  </>;
}
