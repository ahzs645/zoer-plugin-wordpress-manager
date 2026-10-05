import { useMemo, useState } from "react";
import { Btn, checkboxClass, controlClass } from "@zoer/plugin-ui/controls";
import { formatTransferBytes } from "../wordpressPullProgress";
import { MAX_SELECTED_PATHS, type PreviewFile, type PreviewState } from "./records";

const STATE_LABELS: Record<PreviewState, string> = {
  new: "New", changed: "Changed", unchanged: "Unchanged",
  blocked: "Cannot compare safely; excluded from a selective push",
  database: "Replace database content — explicit selection required",
};
const VISIBLE = 200;

/** File choice fed from `preview-page` records; new and changed files start selected. */
export default function PreviewSelection({ files, selected, onChange, disabled }: { files: PreviewFile[]; selected: Set<string>; onChange: (next: Set<string>) => void; disabled?: boolean }) {
  const [filter, setFilter] = useState("");
  const [state, setState] = useState<"" | PreviewState>("");
  const needle = filter.trim().toLowerCase();
  const filtered = useMemo(() => files.filter(file => (!state || file.state === state) && (!needle || file.path.toLowerCase().includes(needle))), [files, needle, state]);
  const counts = useMemo(() => files.reduce((sum, file) => ({ ...sum, [file.state]: (sum[file.state] ?? 0) + 1 }), {} as Partial<Record<PreviewState, number>>), [files]);
  const selectable = (file: PreviewFile) => file.state !== "blocked";
  const toggle = (path: string, on: boolean) => { const next = new Set(selected); if (on) next.add(path); else next.delete(path); onChange(next); };
  return <div className="min-w-0 space-y-3">
    <p className="text-xs text-text-secondary" role="status">
      {(["new", "changed", "unchanged", "blocked", "database"] as PreviewState[]).filter(key => counts[key]).map(key => `${(counts[key] ?? 0).toLocaleString()} ${key}`).join(" · ") || "No files compared."} · <strong>{selected.size.toLocaleString()}</strong> selected
    </p>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
      <input aria-label="Filter compared files by path" className={controlClass("default", "text-base sm:text-[14px]")} placeholder="Filter by theme, plugin or file path" value={filter} onChange={event => setFilter(event.target.value)} />
      <select aria-label="Filter compared files by state" className={controlClass("default", "text-base sm:text-[14px]")} value={state} onChange={event => setState(event.target.value as "" | PreviewState)}>
        <option value="">All states</option>
        {(["new", "changed", "unchanged", "blocked", "database"] as PreviewState[]).map(key => <option key={key} value={key}>{key[0].toUpperCase() + key.slice(1)}</option>)}
      </select>
    </div>
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Btn size="sm" className="w-full sm:w-auto" disabled={disabled} onClick={() => onChange(new Set([...selected, ...filtered.filter(f => f.state === "new" || f.state === "changed").map(f => f.path)]))}>Select new and changed matches</Btn>
      <Btn size="sm" className="w-full sm:w-auto" disabled={disabled} onClick={() => { const drop = new Set(filtered.map(f => f.path)); onChange(new Set([...selected].filter(path => !drop.has(path)))); }}>Clear matches</Btn>
    </div>
    <ul className="max-h-72 min-w-0 overflow-y-auto rounded-md border border-border-muted" aria-label="Compared files">
      {filtered.slice(0, VISIBLE).map(file => <li key={file.path} className="border-b border-border-muted last:border-b-0">
        <label className={`flex min-h-11 min-w-0 items-start gap-2 px-3 py-2 text-xs ${selectable(file) ? "cursor-pointer" : "opacity-60"}`}>
          <input type="checkbox" className={`${checkboxClass} mt-0.5`} disabled={disabled || !selectable(file)} checked={selected.has(file.path)} onChange={event => toggle(file.path, event.target.checked)} />
          <span className="min-w-0 flex-1"><span className="block break-all text-text-primary">{file.path}</span><span className="block text-text-secondary">{STATE_LABELS[file.state]} · {formatTransferBytes(file.bytes)}</span></span>
        </label>
      </li>)}
      {!filtered.length && <li className="p-3 text-xs text-text-secondary">No files match.</li>}
    </ul>
    {filtered.length > VISIBLE && <p className="text-xs text-text-secondary">Showing {VISIBLE} of {filtered.length.toLocaleString()} matches. Narrow the filter to review other files.</p>}
    {selected.size > MAX_SELECTED_PATHS && <p role="alert" className="text-xs text-status-error">Select at most {MAX_SELECTED_PATHS.toLocaleString()} items, or push everything instead.</p>}
  </div>;
}
