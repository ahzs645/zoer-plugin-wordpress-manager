import { useState } from "react";
import type { ExportOptions, ImportOptions, WordPressDiagnostics, ZoerConnectCapabilities } from "../../../lib/api/types/wordpress-transfer";
import { hasCapability, REQUIRES_040, REQUIRES_040_SOURCE } from "../../../lib/wordpress-transfer/options";
import { formatTransferBytes } from "../wordpressPullProgress";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { fieldLabelClass, selectClass } from "@zoer/plugin-ui/controls";
import { databaseSummary } from "./transferLabels";
import { ItemPicker, OptionToggle, TransferPanel, Unavailable, type PickerItem } from "./TransferPanel";

/** Table suffixes the backend and plugin accept in a table list. */
export const SELECTABLE_TABLE = /^[A-Za-z0-9_]{1,64}$/;

export function tableItems(diagnostics: WordPressDiagnostics | null | undefined): PickerItem[] {
  return (diagnostics?.database?.tables ?? []).filter(table => table.prefixed && table.suffix).map(table => {
    const disabled = !SELECTABLE_TABLE.test(table.suffix!);
    return { value: table.suffix!, label: table.name, disabled,
      detail: disabled ? "Can't be selected" : [typeof table.rows === "number" ? `${table.rows.toLocaleString()} rows` : "", typeof table.bytes === "number" ? formatTransferBytes(table.bytes) : ""].filter(Boolean).join(" · ") || undefined };
  });
}

/** Explains disabled table rows; null when every table can be chosen. */
export function unselectableTablesHint(items: PickerItem[]) {
  const count = items.filter(item => item.disabled).length;
  if (!count) return null;
  return count === 1
    ? "1 table can't be selected because its name has characters other than letters, numbers and underscores, which Zoer Connect can't transfer."
    : `${count.toLocaleString()} tables can't be selected because their names have characters other than letters, numbers and underscores, which Zoer Connect can't transfer.`;
}

type TriValue = "auto" | "keep" | "source";
const toTri = (value: boolean | null): TriValue => value === null ? "auto" : value ? "keep" : "source";
const fromTri = (value: string): boolean | null => value === "keep" ? true : value === "source" ? false : null;

export default function DatabasePanel({ exportOptions, onExport, importOptions, onImport, diagnostics, diagnosticsLoading, sourceCaps, destinationCaps, localSource = false, lockDatabase = false, defaultOpen = false }: {
  exportOptions?: ExportOptions; onExport?: (options: ExportOptions) => void;
  importOptions?: ImportOptions; onImport?: (options: ImportOptions) => void;
  diagnostics?: WordPressDiagnostics | null; diagnosticsLoading?: boolean;
  sourceCaps?: ZoerConnectCapabilities; destinationCaps?: ZoerConnectCapabilities;
  localSource?: boolean; lockDatabase?: boolean; defaultOpen?: boolean;
}) {
  const [tableQuery, setTableQuery] = useState("");
  const [typeQuery, setTypeQuery] = useState("");
  const filtersUnavailable = localSource ? null : hasCapability(sourceCaps, "databaseFilters") ? null : REQUIRES_040_SOURCE;
  const gate = (capability: Parameters<typeof hasCapability>[1]) => hasCapability(destinationCaps, capability) ? null : REQUIRES_040;
  const db = exportOptions?.database;
  const setDb = (patch: Partial<ExportOptions["database"]>) => exportOptions && onExport?.({ ...exportOptions, database: { ...exportOptions.database, ...patch } });
  const tables = tableItems(diagnostics);
  const postTypes: PickerItem[] = (diagnostics?.postTypes ?? []).map(type => ({ value: type.name, label: type.label ? `${type.label} (${type.name})` : type.name, detail: typeof type.count === "number" ? type.count.toLocaleString() : undefined }));
  const included = exportOptions ? exportOptions.resources.database : true;
  return <TransferPanel title="Database" summary={databaseSummary(exportOptions ?? null, importOptions ?? null)} defaultOpen={defaultOpen}>
    {exportOptions && db && <>
      {!lockDatabase && <OptionToggle label="Include the database" checked={exportOptions.resources.database} onChange={value => onExport?.({ ...exportOptions, resources: { ...exportOptions.resources, database: value } })} />}
      {included && <>
        <Unavailable reason={filtersUnavailable} />
        <fieldset disabled={!!filtersUnavailable} className="min-w-0 space-y-3">
          <legend className="sr-only">Database filters</legend>
          <label className="block text-sm"><span className={fieldLabelClass}>Tables</span>
            <Select aria-label="Tables to transfer" className={selectClass("default", "w-full")} value={db.tables === "all" ? "all" : "selected"} onChange={event => setDb({ tables: event.target.value === "all" ? "all" : tables.filter(t => !t.disabled).map(t => t.value) })}>
              <option value="all">All tables with this site's prefix</option>
              <option value="selected" disabled={!tables.length}>Only selected tables</option>
            </Select>
          </label>
          {db.tables !== "all" && <ItemPicker label="Tables" items={tables} selected={db.tables} onChange={values => setDb({ tables: values })} emptyText={diagnosticsLoading ? "Loading tables…" : "No table inventory reported."} query={tableQuery} onQuery={setTableQuery} />}
          {unselectableTablesHint(tables) && <p className="text-xs text-status-warning">{unselectableTablesHint(tables)}{db.tables === "all" ? " A pull of all tables stops at such a table; choose Only selected tables to leave it out." : ""}</p>}
          <label className="block text-sm"><span className={fieldLabelClass}>Post types</span>
            <Select aria-label="Post types to transfer" className={selectClass("default", "w-full")} value={db.postTypes === "all" ? "all" : "selected"} onChange={event => setDb({ postTypes: event.target.value === "all" ? "all" : postTypes.map(t => t.value).filter(v => v !== "revision") })}>
              <option value="all">All post types</option>
              <option value="selected" disabled={!postTypes.length}>Only selected post types</option>
            </Select>
          </label>
          {db.postTypes !== "all" && <ItemPicker label="Post types" items={postTypes} selected={db.postTypes} onChange={values => setDb({ postTypes: values })} emptyText={diagnosticsLoading ? "Loading post types…" : "No post types reported."} query={typeQuery} onQuery={setTypeQuery} />}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <OptionToggle label="Exclude revisions" checked={db.excludeRevisions} onChange={value => setDb({ excludeRevisions: value })} />
            <OptionToggle label="Exclude spam comments" checked={db.excludeSpam} onChange={value => setDb({ excludeSpam: value })} />
            <OptionToggle label="Exclude transients" description="Cached data WordPress rebuilds." checked={db.excludeTransients} onChange={value => setDb({ excludeTransients: value })} />
          </div>
        </fieldset>
      </>}
    </>}
    {importOptions && onImport && <div className="min-w-0 space-y-3">
      {exportOptions && <p className="text-xs font-medium text-text-secondary">On the destination</p>}
      <OptionToggle label="Replace GUIDs" description="Rewrite post GUIDs to the destination URL. Turn off to keep feed readers from seeing posts as new." checked={importOptions.replaceGuids} onChange={value => onImport({ ...importOptions, replaceGuids: value })} unavailable={gate("replacementRules")} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Active plugins</span>
          <Select aria-label="Active plugins after Push" disabled={!!gate("keepActivePlugins")} className={selectClass("default", "w-full")} value={toTri(importOptions.keepActivePlugins)} onChange={event => onImport({ ...importOptions, keepActivePlugins: fromTri(event.target.value) })}
            optionDetails={{ auto: { description: "Keep the destination's list unless plugins are pushed" }, keep: { description: "Never change which plugins are active" }, source: { description: "Activate exactly what the source had active" } }}>
            <option value="auto">Automatic</option><option value="keep">Keep destination's</option><option value="source">Take source's</option>
          </Select>
        </label>
        <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Active theme</span>
          <Select aria-label="Active theme after Push" disabled={!!gate("keepActivePlugins")} className={selectClass("default", "w-full")} value={toTri(importOptions.keepActiveTheme)} onChange={event => onImport({ ...importOptions, keepActiveTheme: fromTri(event.target.value) })}
            optionDetails={{ auto: { description: "Keep the destination's theme unless themes are pushed" }, keep: { description: "Never switch the active theme" }, source: { description: "Use the source's active theme" } }}>
            <option value="auto">Automatic</option><option value="keep">Keep destination's</option><option value="source">Take source's</option>
          </Select>
        </label>
      </div>
      <Unavailable reason={gate("keepActivePlugins")} />
      <label className="block min-w-0 text-sm"><span className={fieldLabelClass}>Post and comment authors</span>
        <Select aria-label="Author mapping" disabled={!!gate("authorMapping")} className={selectClass("default", "w-full")} value={importOptions.authorMapping} onChange={event => onImport({ ...importOptions, authorMapping: event.target.value as ImportOptions["authorMapping"] })}
          optionDetails={{ match: { description: "Match destination users by login, then email. Unmatched posts go to the administrator." }, administrator: { description: "Every post belongs to the connection's administrator" } }}>
          <option value="match">Match users by login or email</option><option value="administrator">Assign to the connection administrator</option>
        </Select>
      </label>
      <Unavailable reason={gate("authorMapping")} />
      <OptionToggle label="Create missing tables" description="Tables that exist only on the source are created from its validated schema. Mismatched schemas are replaced and the old table is kept as a backup." checked={importOptions.createTables} onChange={value => onImport({ ...importOptions, createTables: value })} unavailable={gate("createTables")} />
    </div>}
  </TransferPanel>;
}
