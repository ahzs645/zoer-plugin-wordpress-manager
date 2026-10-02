import { useState } from "react";
import type { ImportSample, ImportStats } from "../../../lib/api/types/wordpress-transfer";
import { diffSegments, type DiffSegment } from "./transferLabels";

function Segments({ segments, tone }: { segments: DiffSegment[]; tone: "before" | "after" }) {
  return <>{segments.map((segment, index) => segment.changed
    ? <mark key={index} className={`rounded-sm px-0.5 text-text-primary ${tone === "before" ? "bg-status-error/25 line-through decoration-status-error/60" : "bg-status-success/25"}`}>{segment.text}</mark>
    : <span key={index}>{segment.text}</span>)}</>;
}

export function SampleDiff({ sample }: { sample: ImportSample }) {
  const diff = diffSegments(sample.before, sample.after);
  return <div className="min-w-0 space-y-1 rounded-md border border-border-muted p-2 text-xs">
    <p className="break-all font-medium text-text-secondary">{sample.table} · {sample.column}</p>
    <p className="whitespace-pre-wrap break-all font-mono"><span className="mr-1 select-none text-status-error" aria-label="Before">−</span><Segments segments={diff.before} tone="before" /></p>
    <p className="whitespace-pre-wrap break-all font-mono"><span className="mr-1 select-none text-status-success" aria-label="After">+</span><Segments segments={diff.after} tone="after" /></p>
  </div>;
}

/** Per-table replacement counts and before/after samples; rendered as text only. */
export default function ImportReview({ stats }: { stats: ImportStats | null | undefined }) {
  const [showAll, setShowAll] = useState(false);
  const tables = [...(stats?.tables ?? [])].sort((a, b) => (b.replacements ?? 0) - (a.replacements ?? 0));
  const changed = tables.filter(table => (table.replacements ?? 0) > 0 || table.created || table.schemaReplaced);
  const visible = showAll ? tables : changed;
  const samples = stats?.samples ?? [];
  return <div className="min-w-0 space-y-3">
    <p className="text-sm"><strong>{(stats?.replacements ?? 0).toLocaleString()}</strong> replacement{stats?.replacements === 1 ? "" : "s"} across <strong>{changed.length.toLocaleString()}</strong> of {tables.length.toLocaleString()} table{tables.length === 1 ? "" : "s"}.</p>
    {tables.length > 0 && <div className="min-w-0">
      <ul className="max-h-60 min-w-0 divide-y divide-border-muted overflow-y-auto rounded-md border border-border-muted text-xs" aria-label="Replacements per table">
        {visible.map(table => <li key={table.name} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
          <span className="min-w-0 break-all font-mono">{table.name}</span>
          <span className="shrink-0 tabular-nums text-text-secondary">
            {(table.replacements ?? 0).toLocaleString()} changed{typeof table.rows === "number" ? ` · ${table.rows.toLocaleString()} rows` : ""}
            {table.created ? " · created" : ""}{table.schemaReplaced ? " · schema replaced" : ""}
          </span>
        </li>)}
        {!visible.length && <li className="px-3 py-2 text-text-secondary">No table changed.</li>}
      </ul>
      {changed.length !== tables.length && <button type="button" className="mt-1 min-h-11 text-xs underline sm:min-h-0" onClick={() => setShowAll(value => !value)}>{showAll ? "Show changed tables only" : `Show all ${tables.length} tables`}</button>}
    </div>}
    {samples.length > 0 && <div className="min-w-0 space-y-2">
      <p className="text-xs font-medium text-text-secondary">Sample changes ({samples.length})</p>
      <div className="max-h-80 min-w-0 space-y-2 overflow-y-auto">{samples.map((sample, index) => <SampleDiff key={index} sample={sample} />)}</div>
    </div>}
  </div>;
}
