import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn, Modal, Select } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../lib/api";
import { commitCatalog, engineKeys } from "../../lib/queries/plugin-engine";

/** Groups `local` under `source` (sidebar card, Local and live, Push and Pull): its `site-link:` record. */
export async function linkLocalSite(local: WordPressManagedSite, source: WordPressManagedSite) {
  await commitCatalog({ records: [{ id: `site-link:${local.id}`, kind: "site-link", title: local.name, data: { v: 1, targetSiteId: local.id, sourceSiteId: source.id, linkedAt: new Date().toISOString() } }] }, "site-link");
}
export async function unlinkLocalSite(local: WordPressManagedSite) {
  await commitCatalog({ deletes: [`site-link:${local.id}`] }, "site-link");
}

const LOCAL = ["ddev", "kubernetes", "playground"];
const where = (site: WordPressManagedSite) => `${LOCAL.includes(site.provider) ? "Local" : "Live"} · ${(site.managedUrl || site.url || site.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

export type LinkRequest =
  /** Which site a local site is a copy of. */
  | { mode: "source"; local: WordPressManagedSite; current: WordPressManagedSite | null }
  /** Add an existing local site to a site's group. */
  | { mode: "copy"; source: WordPressManagedSite; copies: WordPressManagedSite[] }
  /** Move every local copy of a site (for example one that was deleted) to another site. */
  | { mode: "move"; from: WordPressManagedSite; copies: WordPressManagedSite[] };

/**
 * Links local sites to the site they are a copy of. Linking only groups the sites and chooses where Push
 * to live and Pull go; nothing is copied until you push or pull.
 */
export default function LinkSiteDialog({ request, sites, sourceOf, onClose }: { request: LinkRequest; /** Every listed site (one entry per website). */ sites: WordPressManagedSite[]; /** The site a local site is currently linked to. */ sourceOf: (site: WordPressManagedSite) => WordPressManagedSite | null; onClose: () => void }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = request.mode === "copy"
    ? sites.filter(site => LOCAL.includes(site.provider) && site.id !== request.source.id && !request.copies.some(copy => copy.id === site.id))
    : request.mode === "source"
      ? sites.filter(site => site.id !== request.local.id && sourceOf(site)?.id !== request.local.id)
      : sites.filter(site => site.id !== request.from.id && !request.copies.some(copy => copy.id === site.id));
  // Live sites first: they are what a local copy is usually linked to.
  options.sort((a, b) => Number(LOCAL.includes(a.provider)) - Number(LOCAL.includes(b.provider)) || a.name.localeCompare(b.name));
  const [choice, setChoice] = useState(request.mode === "source" ? request.current?.id ?? "" : "");
  const chosen = options.find(site => site.id === choice) ?? null;
  const elsewhere = request.mode === "copy" && chosen ? sourceOf(chosen) : null;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); await client.invalidateQueries({ queryKey: engineKeys.catalog("site-link") }); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Zoer could not save the link."); setBusy(false); }
  };
  const save = () => chosen && run(async () => {
    if (request.mode === "source") await linkLocalSite(request.local, chosen);
    else if (request.mode === "copy") await linkLocalSite(chosen, request.source);
    else for (const copy of request.copies) await linkLocalSite(copy, chosen);
  });
  const title = request.mode === "source" ? `${request.current ? "Change the site" : "Link"} ${request.local.name} ${request.current ? "is a copy of" : "to a live site"}`
    : request.mode === "copy" ? `Add a local site to ${request.source.name}` : `Move the local copies of ${request.from.name}`;
  const intro = request.mode === "source" ? `Push to live and Pull from live on ${request.local.name} will use the site you choose.`
    : request.mode === "copy" ? `The local site joins ${request.source.name}'s card, and Push to live sends its changes to ${request.source.name}.`
    : `${request.copies.map(copy => copy.name).join(", ")} will push to and pull from the site you choose instead of ${request.from.name}.`;
  return <Modal mobileSheet title={title} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4 text-sm">
      <p className="text-text-secondary">{intro} Nothing is copied until you push or pull.</p>
      {options.length ? <label className="block space-y-1.5"><span className="font-medium">{request.mode === "copy" ? "Local site" : "Copy of"}</span>
        <Select searchable aria-label={request.mode === "copy" ? "Local site" : "Copy of"} value={choice} onChange={event => setChoice(event.target.value)}
          optionDetails={Object.fromEntries(options.map(site => [site.id, { description: where(site) }]))}>
          <option value="">{request.mode === "copy" ? "Choose a local site" : "Choose a site"}</option>
          {options.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
        </Select></label>
        : <p className="text-text-secondary">{request.mode === "copy" ? "There is no other local site to add." : "There is no other site to choose."}</p>}
      {elsewhere && <p className="text-status-warning">{chosen!.name} is linked to {elsewhere.name} now; it moves to {request.mode === "copy" ? request.source.name : "this site"}.</p>}
      {error && <p role="alert" className="text-status-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Btn variant="primary" loading={busy} disabled={busy || !chosen || (request.mode === "source" && chosen.id === request.current?.id)} onClick={() => void save()}>{request.mode === "move" ? "Move local copies" : "Save"}</Btn>
        {request.mode === "source" && request.current && <Btn variant="ghost" disabled={busy} onClick={() => void run(() => unlinkLocalSite(request.local))}>Unlink from {request.current.name}</Btn>}
        <Btn variant="ghost" disabled={busy} onClick={onClose}>Cancel</Btn>
      </div>
    </div>
  </Modal>;
}
