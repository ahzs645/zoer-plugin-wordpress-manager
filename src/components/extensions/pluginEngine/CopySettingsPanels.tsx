import { useState } from "react";
import { radioClass, Select, fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import type { WordPressDiagnostics } from "../../../lib/api/types/wordpress-transfer";
import { tableItems } from "../wordpressTransfer/DatabasePanel";
import { ModePicker } from "../wordpressTransfer/FilesPanel";
import { CustomReplacementRows } from "../wordpressTransfer/ReplacePanel";
import { ItemPicker, OptionToggle, TransferPanel, type PickerItem } from "../wordpressTransfer/TransferPanel";
import { localUrlRules, usersSummary, UserAccounts, type LocalUserMode } from "./LocalImportPanels";
import { copyScope, type CopySettings } from "./refreshOptions";

function Radio<T extends string>({ name, value, current, onChange, disabled, title, description }: { name: string; value: T; current: T; onChange: (value: T) => void; disabled?: boolean; title: string; description: string }) {
  return <label className={`flex min-h-11 items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] ${current === value ? "border-accent bg-surface-hover" : "border-border-default"} ${disabled ? "opacity-60" : ""}`}>
    <input type="radio" name={name} value={value} className={`${radioClass} mt-0.5`} checked={current === value} disabled={disabled} onChange={() => onChange(value)} />
    <span className="min-w-0"><span className="block text-text-primary">{title}</span><span className="block text-[12px] text-text-muted">{description}</span></span>
  </label>;
}

/** Selected-or-all list control: "All …" or a picker of the inventory. */
function AllOrSome({ label, noun, value, onChange, items, disabled, loading }: { label: string; noun: string; value: "all" | string[]; onChange: (value: "all" | string[]) => void; items: PickerItem[]; disabled?: boolean; loading?: boolean }) {
  const [query, setQuery] = useState("");
  return <div className="min-w-0 space-y-2">
    <label className="block text-sm"><span className={fieldLabelClass}>{label}</span>
      <Select aria-label={label} disabled={disabled} className={selectClass("default", "w-full")} value={value === "all" ? "all" : "selected"} onChange={event => onChange(event.target.value === "all" ? "all" : items.filter(item => !item.disabled).map(item => item.value))}>
        <option value="all">All {noun}</option>
        <option value="selected">Only selected {noun}</option>
      </Select>
    </label>
    {value !== "all" && <ItemPicker label={label} items={items} selected={value} onChange={onChange} disabled={disabled} emptyText={loading ? `Loading ${noun}…` : `The live site did not report its ${noun}.`} query={query} onQuery={setQuery} />}
  </div>;
}

/**
 * The editable settings of a local copy or refresh, as WP Migrate-style panels: what to copy, the
 * database (accounts and filters), find & replace, files and what happens after the import. Each
 * panel's summary line says what it will do. The worker re-checks every choice (copy.js `copyOptions`).
 */
export default function CopySettingsPanels({ id, refresh, settings, onSettings, users, onUsers, sourceUrl, diagnostics, diagnosticsLoading = false, disabled = false }: {
  id: string; refresh: boolean; settings: CopySettings; onSettings: (settings: CopySettings) => void;
  users: LocalUserMode; onUsers: (value: LocalUserMode) => void; sourceUrl?: string | null;
  diagnostics?: WordPressDiagnostics | null; diagnosticsLoading?: boolean; disabled?: boolean;
}) {
  const set = (patch: Partial<CopySettings>) => onSettings({ ...settings, ...patch });
  const scope = copyScope(settings);
  const databaseOnly = scope === "database";
  const rules = localUrlRules(sourceUrl);
  const postTypes: PickerItem[] = (diagnostics?.postTypes ?? []).map(type => ({ value: type.name, label: type.label ? `${type.label} (${type.name})` : type.name, detail: typeof type.count === "number" ? `${type.count.toLocaleString()} items` : undefined }));
  const tables = tableItems(diagnostics).map(item => item.value === "users" || item.value === "usermeta" ? { ...item, detail: "Follows the account choice" } : item);
  const themes: PickerItem[] = (diagnostics?.themes ?? []).map(t => ({ value: t.slug, label: t.name ? `${t.name} (${t.slug})` : t.slug, detail: [t.active ? "active" : "", t.version ?? ""].filter(Boolean).join(" · ") || undefined }));
  const plugins: PickerItem[] = (diagnostics?.plugins ?? []).map(p => ({ value: p.slug, label: p.name ? `${p.name} (${p.slug})` : p.slug, detail: [p.active ? "active" : "", p.version ?? ""].filter(Boolean).join(" · ") || undefined }));
  const customCount = settings.custom.filter(row => row.find).length;
  const filesSummary = !settings.files ? "Local files kept — no files copied"
    : [settings.media === "none" ? "Themes and plugins · existing media kept" : settings.media === "since-last" && refresh ? "Themes, plugins and new media" : "Themes, plugins and media",
      settings.themes.mode !== "all" ? `${settings.themes.mode} themes` : "", settings.plugins.mode !== "all" ? `${settings.plugins.mode} plugins` : "", settings.languages ? "translations" : "", refresh && settings.removeStale ? "deleted files removed" : ""].filter(Boolean).join(" · ");
  const databaseSummary = !settings.database ? "Local database kept"
    : [databaseOnly ? `${usersSummary(users).replace("All tables", "Other tables")} · local settings kept` : usersSummary(users),
      settings.excludeRevisions ? "no revisions" : "", settings.excludeSpam ? "no spam" : "", Array.isArray(settings.postTypes) ? `${settings.postTypes.length} post types` : "", refresh && Array.isArray(settings.tables) ? `${settings.tables.length} tables` : ""].filter(Boolean).join(" · ");
  return <div className="min-w-0 space-y-2">
    {refresh && <TransferPanel title="What to refresh" summary={scope === "complete" ? "Database and files" : scope === "database" ? "Database only — code and settings kept" : scope === "files" ? "Files only — database kept" : "Nothing selected"} defaultOpen>
      <OptionToggle label="Database" description="Content, accounts and (unless database only) settings, imported into staged tables and swapped in at once." checked={settings.database} onChange={value => set({ database: value })} disabled={disabled} />
      <OptionToggle label="Themes, plugins and media" description="Files from the live site, checked against their SHA-256 digests and placed over the local ones." checked={settings.files} onChange={value => set({ files: value })} disabled={disabled} />
      {databaseOnly && <OptionToggle label="Keep local pages and block content" description="Retains matching local pages, templates, navigation and styles. New or conflicting local page identities stop the refresh for review." checked={settings.keepLocalDesign} onChange={value => set({ keepLocalDesign: value })} disabled={disabled} />}
    </TransferPanel>}
    {settings.database && <TransferPanel title="Database" summary={databaseSummary}>
      <fieldset className="min-w-0 space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-medium text-text-secondary">User accounts</legend>
        <UserAccounts id={id} from="source site" users={users} onUsers={onUsers} disabled={disabled} databaseOnly={databaseOnly} />
      </fieldset>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <OptionToggle label="Leave out post revisions" description="Smaller and faster; the copy has no revision history." checked={settings.excludeRevisions} onChange={value => set({ excludeRevisions: value })} disabled={disabled} />
        <OptionToggle label="Leave out spam comments" checked={settings.excludeSpam} onChange={value => set({ excludeSpam: value })} disabled={disabled} />
      </div>
      <AllOrSome label="Post types" noun="post types" value={settings.postTypes} onChange={value => set({ postTypes: value })} items={postTypes} disabled={disabled} loading={diagnosticsLoading} />
      {Array.isArray(settings.postTypes) && <p className="text-xs text-status-warning">Post types you leave out are removed from the copy, as in WP Migrate.</p>}
      {refresh && <AllOrSome label="Tables" noun="tables" value={settings.tables} onChange={value => set({ tables: value })} items={tables} disabled={disabled} loading={diagnosticsLoading} />}
      {refresh && Array.isArray(settings.tables) && <p className="text-xs text-text-secondary">Only the chosen tables are replaced; the others stay as they are locally. {databaseOnly ? "Include posts." : "Include posts and options."}</p>}
      <p className="text-xs text-text-secondary">{databaseOnly ? "The options table stays local. Other selected tables are staged and swapped in at once; the account choice above controls user tables." : "Every chosen table is imported into staged tables and swapped in at once. Transients are dropped; this site's address, admin e-mail and scheduled tasks are kept."}</p>
    </TransferPanel>}
    {settings.database && <TransferPanel title="Find & Replace" summary={`${rules.length} automatic URL rules${settings.replacePaths ? " · file path" : ""}${customCount ? ` · ${customCount} custom ${customCount === 1 ? "rule" : "rules"}` : ""}`}>
      <div className="min-w-0 rounded-md border border-border-muted text-xs" role="table" aria-label="Automatic URL rules">
        <div role="row" className="hidden bg-surface-primary/50 text-text-secondary sm:grid sm:grid-cols-[1fr_1fr_8rem]"><span role="columnheader" className="px-3 py-2 font-medium">Find</span><span role="columnheader" className="px-3 py-2 font-medium">Replace</span><span role="columnheader" className="px-3 py-2 font-medium">Form</span></div>
        {rules.map((rule, index) => <div role="row" key={rule.note} className={`grid min-w-0 grid-cols-1 border-border-muted px-3 py-2 sm:grid-cols-[1fr_1fr_8rem] sm:border-t sm:px-0 sm:py-0 ${index ? "border-t" : ""}`}>
          <span role="cell" className="min-w-0 break-all font-mono sm:px-3 sm:py-1.5">{rule.find}</span>
          <span role="cell" className="min-w-0 break-all font-mono sm:px-3 sm:py-1.5"><span className="text-text-secondary sm:hidden" aria-hidden="true">→ </span>{rule.replace}</span>
          <span role="cell" className="text-text-secondary sm:px-3 sm:py-1.5">{rule.note}</span>
        </div>)}
      </div>
      <OptionToggle label="Replace the live site's file path" description={`${diagnostics?.wordpress?.abspath ? `${diagnostics.wordpress.abspath.replace(/\/+$/, "")}/ → /var/www/html/` : "The live site's ABSPATH → this site's"}, for plugins that store absolute paths (caches, logs, page builders).`} checked={settings.replacePaths} onChange={value => set({ replacePaths: value })} disabled={disabled} />
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium text-text-secondary">Custom rules (applied in order, after the automatic rules)</p>
        <CustomReplacementRows rows={settings.custom} onChange={custom => set({ custom })} disabled={disabled} max={40} />
      </div>
      <p className="text-xs text-text-secondary">Applied in one pass, longest match first, including inside serialized and JSON data. Post GUIDs are left unchanged.</p>
    </TransferPanel>}
    {settings.files && <TransferPanel title="Files" summary={filesSummary}>
      <label className="block text-sm"><span className={fieldLabelClass}>Media</span>
        <Select aria-label="Media" disabled={disabled} className={selectClass("default", "w-full")} value={settings.media} onChange={event => set({ media: event.target.value as CopySettings["media"] })}>
          <option value="all">All media</option>
          {refresh && <option value="since-last">Only media new since the last download</option>}
          <option value="none">No media — keep the uploads the copy has</option>
        </Select>
      </label>
      {settings.media === "since-last" && refresh && <p className="text-xs text-text-secondary">Downloads uploads changed since the newest download of this site that included media, and places them beside the ones the copy has.</p>}
      <ModePicker kind="themes" mode={settings.themes} onChange={themesMode => set({ themes: themesMode })} items={themes} disabled={disabled} loading={diagnosticsLoading} />
      <ModePicker kind="plugins" mode={settings.plugins} onChange={pluginsMode => set({ plugins: pluginsMode })} items={plugins} disabled={disabled} loading={diagnosticsLoading} />
      <OptionToggle label="Translations" description="Also copy wp-content/languages (WordPress, theme and plugin translation files). Needs Zoer Connect 0.8.1 on the live site." checked={settings.languages} onChange={value => set({ languages: value })} disabled={disabled} />
      {refresh && <OptionToggle label="Remove files deleted on the live site" description="In each theme and plugin folder copied, local files the live site no longer has are deleted, as WP Migrate replaces those folders whole. Hidden files (such as .git), node_modules and logs are kept, and other plugins are untouched. A recovery backup is taken first." checked={settings.removeStale} onChange={value => set({ removeStale: value })} disabled={disabled} />}
      <p className="text-xs text-text-secondary"><span className="font-medium text-text-primary">Left out:</span> WordPress core, wp-config.php, must-use plugins and drop-ins stay the local site's own. Executable files in uploads are refused.</p>
    </TransferPanel>}
    <TransferPanel title="After the import" summary={scope === "complete" ? (settings.activePlugins === "source" ? "Live site's plugins active" : settings.activePlugins === "local" && refresh ? "Local plugin activation kept" : "Plugins inactive") + " · mail and outgoing HTTP blocked" : "Active plugins and settings kept · local outbound guard retained"}>
      {scope === "complete" && <fieldset className="min-w-0 space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-medium text-text-secondary">Active plugins</legend>
        <Radio name={`active-${id}`} value="none" current={settings.activePlugins === "local" && !refresh ? "none" : settings.activePlugins} onChange={value => set({ activePlugins: value })} title="All inactive" description="Payment, mail and integration jobs cannot run on their own. Activate what you need." />
        {refresh && <Radio name={`active-${id}`} value="local" current={settings.activePlugins} onChange={value => set({ activePlugins: value })} title="Keep the copy's active plugins" description="Plugins active on the local copy now stay active after the refresh." />}
        <Radio name={`active-${id}`} value="source" current={settings.activePlugins === "local" && !refresh ? "none" : settings.activePlugins} onChange={value => set({ activePlugins: value })} title="Activate the live site's plugins" description="Same plugins active as on live. Outgoing mail and HTTP stay blocked and cron stays off, so their jobs still cannot reach the outside." />
      </fieldset>}
      <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
        {scope !== "complete" && <li>Current plugin activation and theme selection are retained.</li>}
        <li>Outgoing e-mail and HTTP requests stay blocked and WordPress cron is disabled on the local site.</li>
        <li>{scope === "complete" ? "“Discourage search engines” is turned on, because the local site has its own reachable address." : "The local search-engine setting and permalink rules are retained."}</li>
        <li>{scope === "complete" ? "Permalinks are rebuilt with the copied theme loaded, then the site must answer over HTTPS before the copy is marked ready." : "The site must answer over HTTPS before the refresh is marked ready."}</li>
      </ul>
      <OptionToggle label="Gentle pace" description="Downloads in smaller requests with pauses, for shared hosts that throttle or time out busy sites. Slower." checked={settings.pace === "gentle"} onChange={value => set({ pace: value ? "gentle" : "normal" })} disabled={disabled} />
    </TransferPanel>
  </div>;
}
