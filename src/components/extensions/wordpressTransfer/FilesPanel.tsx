import { useEffect, useState } from "react";
import type { ExportOptions, ResourceMode, TransferAction, WordPressDiagnostics, ZoerConnectCapabilities } from "../../../lib/api/types/wordpress-transfer";
import { hasCapability, parseExcludes, REQUIRES_040_SOURCE } from "../../../lib/wordpress-transfer/options";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { DateInput } from "@zoer/plugin-ui/controls";
import { fieldLabelClass, selectClass, textareaClass } from "@zoer/plugin-ui/controls";
import { filesSummary } from "./transferLabels";
import { ItemPicker, OptionToggle, TransferPanel, Unavailable, type PickerItem } from "./TransferPanel";

function ModePicker({ kind, mode, onChange, items, disabled, loading }: { kind: "themes" | "plugins"; mode: ResourceMode; onChange: (mode: ResourceMode) => void; items: PickerItem[]; disabled: boolean; loading?: boolean }) {
  const [query, setQuery] = useState("");
  const noun = kind === "themes" ? "theme" : "plugin";
  return <div className="min-w-0 space-y-2">
    <label className="block text-sm"><span className={fieldLabelClass}>{kind === "themes" ? "Themes" : "Plugins"}</span>
      <Select aria-label={`${kind === "themes" ? "Themes" : "Plugins"} to transfer`} disabled={disabled} className={selectClass("default", "w-full")} value={mode.mode} onChange={event => onChange({ mode: event.target.value as ResourceMode["mode"], items: mode.items })}>
        <option value="all">All {kind}</option>
        <option value="active">Active {kind} only</option>
        <option value="selected">Only selected {kind}</option>
        <option value="except">All except selected {kind}</option>
      </Select>
    </label>
    {(mode.mode === "selected" || mode.mode === "except") && <ItemPicker label={kind === "themes" ? "Themes" : "Plugins"} items={items} selected={mode.items} onChange={values => onChange({ ...mode, items: values })} disabled={disabled} emptyText={loading ? `Loading ${kind}…` : `No ${noun} inventory reported.`} query={query} onQuery={setQuery} />}
  </div>;
}

export default function FilesPanel({ action, options, onChange, diagnostics, diagnosticsLoading, sourceCaps, localSource = false, defaultOpen = false }: {
  action: TransferAction; options: ExportOptions; onChange: (options: ExportOptions) => void;
  diagnostics?: WordPressDiagnostics | null; diagnosticsLoading?: boolean; sourceCaps?: ZoerConnectCapabilities; localSource?: boolean; defaultOpen?: boolean;
}) {
  const [excludeText, setExcludeText] = useState(options.excludes.join("\n"));
  useEffect(() => { if (parseExcludes(excludeText).join("\n") !== options.excludes.join("\n")) setExcludeText(options.excludes.join("\n")); }, [options.excludes]);
  const modes = localSource || hasCapability(sourceCaps, "resourceModes") ? null : REQUIRES_040_SOURCE;
  const since = localSource || hasCapability(sourceCaps, "mediaSince") ? null : REQUIRES_040_SOURCE;
  const r = options.resources;
  const setResource = (key: keyof ExportOptions["resources"], value: boolean) => onChange({ ...options, resources: { ...r, [key]: value } });
  const pullOnly = action !== "push";
  const themes: PickerItem[] = (diagnostics?.themes ?? []).map(t => ({ value: t.slug, label: t.name ? `${t.name} (${t.slug})` : t.slug, detail: [t.active ? "active" : "", t.version ?? ""].filter(Boolean).join(" · ") || undefined }));
  const plugins: PickerItem[] = (diagnostics?.plugins ?? []).map(p => ({ value: p.slug, label: p.name ? `${p.name} (${p.slug})` : p.slug, detail: [p.active ? "active" : "", p.version ?? ""].filter(Boolean).join(" · ") || undefined }));
  return <TransferPanel title="Files" summary={filesSummary(options)} defaultOpen={defaultOpen}>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <OptionToggle label="Themes" checked={r.themes} onChange={value => setResource("themes", value)} />
      <OptionToggle label="Plugins" checked={r.plugins} onChange={value => setResource("plugins", value)} />
      <OptionToggle label="Media uploads" checked={r.media} onChange={value => setResource("media", value)} />
    </div>
    <Unavailable reason={(r.themes || r.plugins) ? modes : null} />
    {r.themes && <ModePicker kind="themes" mode={options.themes} onChange={mode => onChange({ ...options, themes: mode })} items={themes} disabled={!!modes} loading={diagnosticsLoading} />}
    {r.plugins && <ModePicker kind="plugins" mode={options.plugins} onChange={mode => onChange({ ...options, plugins: mode })} items={plugins} disabled={!!modes} loading={diagnosticsLoading} />}
    {r.media && <div className="min-w-0 space-y-2">
      <label className="block text-sm"><span className={fieldLabelClass}>Media</span>
        <Select aria-label="Media to transfer" disabled={!!since} className={selectClass("default", "w-full")} value={options.media.mode} onChange={event => onChange({ ...options, media: event.target.value === "since" ? { mode: "since", since: options.media.since ?? "" } : { mode: event.target.value as "all" | "since-last" } })}>
          <option value="all">All uploads</option>
          <option value="since">Uploads modified since a date</option>
          <option value="since-last">Uploads since the last migration</option>
        </Select>
      </label>
      {options.media.mode === "since" && <DateInput label="Copy uploads modified on or after" value={options.media.since ?? ""} onChange={value => onChange({ ...options, media: { mode: "since", since: value } })} disabled={!!since} />}
      <Unavailable reason={since} />
    </div>}
    {pullOnly && <div className="min-w-0 space-y-2 rounded-md border border-border-muted p-2">
      <p className="text-xs text-text-secondary">Download only — cannot be pushed to another site.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <OptionToggle label="Must-use plugins" description="Download only — cannot be pushed." checked={r.muplugins} onChange={value => setResource("muplugins", value)} />
        <OptionToggle label="WordPress core" description="Download only — cannot be pushed." checked={r.core} onChange={value => setResource("core", value)} />
      </div>
    </div>}
    <label className="block text-sm"><span className={fieldLabelClass}>Exclude files (one glob per line, e.g. <code>*.log</code> or <code>uploads/cache/*</code>)</span>
      <textarea className={textareaClass("default", "w-full font-mono text-base sm:text-[13px]")} rows={3} value={excludeText} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onChange={event => { setExcludeText(event.target.value); onChange({ ...options, excludes: parseExcludes(event.target.value) }); }} />
    </label>
  </TransferPanel>;
}
