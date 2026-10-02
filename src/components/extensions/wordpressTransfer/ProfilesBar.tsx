import { useState } from "react";
import { History, Pencil, Save, Trash2, Upload } from "lucide-react";
import type { TransferProfile, TransferRecentRun } from "../../../lib/api/types/wordpress-transfer";
import { useTransferProfiles } from "../../../lib/queries/wordpress-transfer";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { ActionMenu as ActionMenu } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { useDialogs } from "@zoer/plugin-ui/controls";
import { selectClass } from "@zoer/plugin-ui/controls";
import { ACTION_LABELS } from "./transferLabels";
import type { DraftUpdate, TransferDraft } from "./draft";

/** Saved profiles (save, load, rename, overwrite, delete) and the last 10 runs. */
export default function ProfilesBar({ siteId, draft, update }: { siteId: string; draft: TransferDraft; update: DraftUpdate }) {
  const dialogs = useDialogs();
  const store = useTransferProfiles();
  const [notice, setNotice] = useState("");
  const current = store.profiles.find(profile => profile.id === draft.profileId) ?? null;
  const input = (name: string) => ({ name, action: draft.action, siteId, ...(draft.action === "push" && draft.sourceSiteId ? { sourceSiteId: draft.sourceSiteId } : {}), exportOptions: draft.exportOptions, importOptions: draft.importOptions });
  function load(settings: TransferProfile | TransferRecentRun, profileId: string | null, label: string) {
    update(d => ({ ...d, action: settings.action, exportOptions: settings.exportOptions, importOptions: settings.importOptions,
      ...(settings.sourceSiteId ? { sourceSiteId: settings.sourceSiteId } : {}), profileId }));
    setNotice(settings.siteId && settings.siteId !== siteId ? `Loaded ${label}. It was saved for another site; check the settings before running.` : `Loaded ${label}.`);
  }
  async function saveAs() {
    const name = await dialogs.prompt({ title: "Save settings as a profile", label: "Profile name", defaultValue: current ? `${current.name} copy` : `${ACTION_LABELS[draft.action].title} settings`, submitLabel: "Save profile" });
    if (!name?.trim()) return;
    try {
      const created = await store.create(input(name.trim())) as { profile?: { id?: string }; id?: string } | null;
      const id = created?.profile?.id ?? created?.id ?? null;
      if (id) update(d => ({ ...d, profileId: id }));
      setNotice(`Saved “${name.trim()}”.`);
    } catch { /* store.error */ }
  }
  async function overwrite() {
    if (!current || !await dialogs.confirm({ title: `Overwrite “${current.name}”?`, description: "Replaces the saved settings with the current ones.", confirmLabel: "Overwrite", cancelLabel: "Keep saved settings" })) return;
    try { await store.update({ id: current.id, ...input(current.name) }); setNotice(`Updated “${current.name}”.`); } catch { /* store.error */ }
  }
  async function rename() {
    if (!current) return;
    const name = await dialogs.prompt({ title: "Rename profile", label: "Profile name", defaultValue: current.name, submitLabel: "Rename" });
    if (!name?.trim() || name.trim() === current.name) return;
    try { await store.update({ id: current.id, name: name.trim() }); setNotice(`Renamed to “${name.trim()}”.`); } catch { /* store.error */ }
  }
  async function remove() {
    if (!current || !await dialogs.confirm({ title: `Delete “${current.name}”?`, description: "The saved settings are removed. Past transfers are unaffected.", confirmLabel: "Delete profile", cancelLabel: "Keep profile", tone: "danger" })) return;
    try { await store.remove(current.id); update(d => ({ ...d, profileId: null })); setNotice("Profile deleted."); } catch { /* store.error */ }
  }
  return <section className="min-w-0 space-y-2" aria-label="Saved profiles">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-48">
        <Select searchable aria-label="Load a saved profile" className={selectClass("default", "w-full")} value={draft.profileId ?? ""} disabled={store.profilesQuery.isLoading}
          optionDetails={Object.fromEntries(store.profiles.map(p => [p.id, { description: `${ACTION_LABELS[p.action].title}${p.updatedAt ? ` · saved ${new Date(p.updatedAt).toLocaleDateString()}` : ""}` }]))}
          onChange={event => { const profile = store.profiles.find(p => p.id === event.target.value); if (profile) load(profile, profile.id, `“${profile.name}”`); else update(d => ({ ...d, profileId: null })); }}>
          <option value="">{store.profiles.length ? "Saved profiles…" : "No saved profiles"}</option>
          {store.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </Select>
      </div>
      <Btn size="sm" icon={<Save className="h-4 w-4" />} disabled={store.busy} onClick={() => void saveAs()}>Save as…</Btn>
      <ActionMenu size="sm" label="Profile actions" items={current ? [
        { label: `Overwrite “${current.name}”`, icon: <Upload className="h-4 w-4" />, disabled: store.busy, onClick: () => void overwrite() },
        { label: "Rename…", icon: <Pencil className="h-4 w-4" />, disabled: store.busy, onClick: () => void rename() },
        { label: "Delete…", icon: <Trash2 className="h-4 w-4" />, tone: "danger", disabled: store.busy, onClick: () => void remove() },
      ] : []} />
    </div>
    {store.recent.length > 0 && <details data-zoer-disclosure>
      <summary className="text-xs text-text-secondary"><History className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Recent runs ({store.recent.length})</summary>
      <ul className="mt-2 space-y-1">
        {store.recent.map(run => <li key={run.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border-muted px-3 py-1.5 text-xs">
          <span className="min-w-0 break-words">{run.name || ACTION_LABELS[run.action].title}{run.startedAt ? ` · ${new Date(run.startedAt).toLocaleString()}` : ""}{run.siteId && run.siteId !== siteId ? " · other site" : ""}</span>
          <Btn size="sm" variant="ghost" onClick={() => load(run, null, "the settings from that run")}>Use settings</Btn>
        </li>)}
      </ul>
    </details>}
    {notice && <p role="status" className="text-xs text-text-secondary">{notice}</p>}
    {store.error && <p role="alert" className="text-xs text-status-error">{store.error.message}</p>}
    {store.profilesQuery.error && <p className="text-xs text-text-secondary">Profiles unavailable: {store.profilesQuery.error.message}</p>}
  </section>;
}
