import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ImportOptions, ReplacementRow, ZoerConnectCapabilities } from "../../../lib/api/types/wordpress-transfer";
import { hasCapability, MAX_CUSTOM_REPLACEMENTS, REQUIRES_040 } from "../../../lib/wordpress-transfer/options";
import { validateReplacementRow } from "../../../lib/wordpress-transfer/replacementRegex";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Tooltip as Tooltip } from "@zoer/plugin-ui/controls";
import { checkboxClass, controlClass } from "@zoer/plugin-ui/controls";
import { replaceSummary } from "./transferLabels";
import { OptionToggle, TransferPanel, Unavailable } from "./TransferPanel";

const emptyRow = (): ReplacementRow => ({ find: "", replace: "", regex: false, caseSensitive: true });

export default function ReplacePanel({ options, onChange, caps, sourceUrl, destinationUrl, sourcePath, destinationPath, replaceOnly = false, defaultOpen = false }: {
  options: ImportOptions; onChange: (options: ImportOptions) => void; caps?: ZoerConnectCapabilities;
  sourceUrl?: string | null; destinationUrl: string; sourcePath?: string | null; destinationPath?: string | null;
  /** Find & Replace action on the site's own database: no automatic rows, review is mandatory. */
  replaceOnly?: boolean; defaultOpen?: boolean;
}) {
  const rules = hasCapability(caps, "replacementRules") ? null : REQUIRES_040;
  const variants = hasCapability(caps, "replacementVariants") ? null : REQUIRES_040;
  const review = hasCapability(caps, "reviewPause") && hasCapability(caps, "lateFence") ? null : REQUIRES_040;
  const rep = options.replacements;
  const setRep = (patch: Partial<ImportOptions["replacements"]>) => onChange({ ...options, replacements: { ...rep, ...patch } });
  const setRows = (custom: ReplacementRow[]) => setRep({ custom });
  const updateRow = (index: number, patch: Partial<ReplacementRow>) => setRows(rep.custom.map((row, i) => i === index ? { ...row, ...patch } : row));
  const move = (index: number, delta: number) => { const next = [...rep.custom]; const [row] = next.splice(index, 1); next.splice(index + delta, 0, row); setRows(next); };
  return <TransferPanel title="Find & Replace" summary={replaceSummary(options, { replaceOnly })} defaultOpen={defaultOpen}>
    {!replaceOnly && <div className="min-w-0 space-y-2">
      <OptionToggle label="Automatic replacements" description="Recommended. Turn off only if you replace URLs yourself below." checked={rep.automatic} onChange={value => setRep({ automatic: value })} unavailable={rep.automatic ? null : rules} />
      {rep.automatic && <div className="min-w-0 space-y-1 rounded-md border border-border-muted bg-surface-primary/40 p-3 text-xs">
        <p className="font-medium text-text-secondary">Applied automatically (read-only)</p>
        <p className="break-all"><span className="text-text-secondary">URL:</span> {sourceUrl || "source site URL"} → {destinationUrl}</p>
        {rep.variants && <p className="text-text-secondary">+ http/https twins, JSON-escaped, URL-encoded and protocol-relative forms</p>}
        {rep.paths && <p className="break-all"><span className="text-text-secondary">Path:</span> {sourcePath || "source ABSPATH"} → {destinationPath || "destination ABSPATH"}</p>}
      </div>}
      {rep.automatic && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <OptionToggle label="Include URL variants" checked={rep.variants} onChange={value => setRep({ variants: value })} unavailable={variants} />
        <OptionToggle label="Replace filesystem path" checked={rep.paths} onChange={value => setRep({ paths: value })} unavailable={rules} />
      </div>}
    </div>}
    <div className="min-w-0 space-y-2">
      <p className="text-xs font-medium text-text-secondary">{replaceOnly ? "Replacement rules" : "Custom rules"} (applied in order{replaceOnly ? "" : ", after automatic rules"})</p>
      <Unavailable reason={rules} />
      {rep.custom.map((row, index) => {
        const check = validateReplacementRow(row);
        const id = `replace-row-${index}`;
        return <div key={index} className="min-w-0 space-y-2 rounded-md border border-border-muted p-2">
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <input aria-label={`Find, row ${index + 1}`} aria-invalid={!check.ok} aria-describedby={`${id}-help`} className={controlClass("default", "font-mono text-base sm:text-[13px]")} placeholder={row.regex ? "/old-(\\d+)/i" : "Find"} value={row.find} disabled={!!rules} onChange={e => updateRow(index, { find: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <input aria-label={`Replace, row ${index + 1}`} className={controlClass("default", "font-mono text-base sm:text-[13px]")} placeholder={row.regex ? "new-$1" : "Replace"} value={row.replace} disabled={!!rules} onChange={e => updateRow(index, { replace: e.target.value })} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <label className="flex min-h-11 items-center gap-2 sm:min-h-8"><input type="checkbox" className={checkboxClass} checked={row.regex} disabled={!!rules} onChange={e => updateRow(index, { regex: e.target.checked })} />Regex</label>
            <label className="flex min-h-11 items-center gap-2 sm:min-h-8"><input type="checkbox" className={checkboxClass} checked={row.caseSensitive} disabled={!!rules || row.regex} onChange={e => updateRow(index, { caseSensitive: e.target.checked })} />Case-sensitive</label>
            <span className="ml-auto flex gap-1">
              <Tooltip content="Move up"><button type="button" aria-label={`Move row ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)} className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover disabled:opacity-40 sm:h-8 sm:w-8"><ArrowUp className="h-4 w-4" /></button></Tooltip>
              <Tooltip content="Move down"><button type="button" aria-label={`Move row ${index + 1} down`} disabled={index === rep.custom.length - 1} onClick={() => move(index, 1)} className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover disabled:opacity-40 sm:h-8 sm:w-8"><ArrowDown className="h-4 w-4" /></button></Tooltip>
              <Tooltip content="Remove row"><button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => setRows(rep.custom.filter((_, i) => i !== index))} className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-status-error sm:h-8 sm:w-8"><Trash2 className="h-4 w-4" /></button></Tooltip>
            </span>
          </div>
          <p id={`${id}-help`} className={`text-xs ${!check.ok ? "text-status-error" : check.warning ? "text-status-warning" : "text-text-secondary"}`} role={!check.ok && row.find ? "alert" : undefined}>
            {!check.ok ? (row.find ? check.error : row.regex ? "Write the pattern with delimiters, e.g. /old-(\\d+)/i. Flags: i, m, s, x, u." : "Enter text to find.") : check.warning ?? (row.regex ? "Regex flags control case; $1 in Replace inserts a group." : "Literal text, including inside serialized data.")}
          </p>
        </div>;
      })}
      <Btn size="sm" icon={<Plus className="h-4 w-4" />} disabled={!!rules || rep.custom.length >= MAX_CUSTOM_REPLACEMENTS} onClick={() => setRows([...rep.custom, emptyRow()])}>Add rule</Btn>
    </div>
    {!replaceOnly ? <OptionToggle label="Review changes before applying" description="Stages everything with the site online, then waits for you to check replacement counts and samples before anything goes live. Requires “Keep site online while staging”." checked={options.review} onChange={value => onChange({ ...options, review: value, ...(value ? { fence: "activation" as const } : {}) })} unavailable={review} />
      : <p className="text-xs text-text-secondary">Find & Replace always stops for review: you see per-table counts and before/after samples, then apply or cancel.</p>}
  </TransferPanel>;
}
