import type { ReactNode } from "react";
import { CheckboxField as CheckboxField } from "@zoer/plugin-ui/controls";
import { checkboxClass, controlClass } from "@zoer/plugin-ui/controls";

/** Collapsible settings panel with a one-line summary, like WP Migrate's "Database: all tables, no revisions…". */
export function TransferPanel({ title, summary, children, defaultOpen = false }: { title: string; summary: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details data-zoer-disclosure open={defaultOpen || undefined} className="min-w-0 rounded-lg border border-border-default">
    <summary className="flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2">
      <span className="text-sm font-medium text-text-primary">{title}</span>
      <span className="block break-words text-xs text-text-secondary">{summary}</span>
    </summary>
    <div className="min-w-0 space-y-3 border-t border-border-muted p-3">{children}</div>
  </details>;
}

/** A labelled toggle that explains why it is unavailable. */
export function OptionToggle({ label, description, checked, onChange, disabled, unavailable }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; unavailable?: string | null }) {
  return <CheckboxField label={label} description={unavailable ? `${unavailable}.${description ? ` ${description}` : ""}` : description} checked={checked} onChange={onChange} disabled={disabled || !!unavailable} />;
}

export function Unavailable({ reason }: { reason: string | null | undefined }) {
  return reason ? <p className="text-xs text-status-warning">{reason}.</p> : null;
}

export type PickerItem = { value: string; label: string; detail?: string; disabled?: boolean };

/** Searchable checkbox list for tables, post types, themes and plugins. */
export function ItemPicker({ label, items, selected, onChange, disabled, emptyText, query, onQuery }: {
  label: string; items: PickerItem[]; selected: string[]; onChange: (values: string[]) => void; disabled?: boolean; emptyText: string;
  query: string; onQuery: (value: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter(item => `${item.label} ${item.value}`.toLowerCase().includes(needle)) : items;
  const chosen = new Set(selected);
  return <fieldset disabled={disabled} className="min-w-0 space-y-2">
    <legend className="sr-only">{label}</legend>
    {items.length > 8 && <input aria-label={`Filter ${label.toLowerCase()}`} className={controlClass("default", "text-base sm:text-[14px]")} placeholder="Filter" value={query} onChange={event => onQuery(event.target.value)} />}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
      <span>{selected.length.toLocaleString()} of {items.length.toLocaleString()} selected</span>
      <button type="button" className="min-h-11 underline sm:min-h-0" onClick={() => onChange([...new Set([...selected, ...visible.filter(i => !i.disabled).map(i => i.value)])])}>Select {needle ? "matches" : "all"}</button>
      <button type="button" className="min-h-11 underline sm:min-h-0" onClick={() => onChange(needle ? selected.filter(v => !visible.some(i => i.value === v)) : [])}>Clear {needle ? "matches" : "all"}</button>
    </div>
    <div className="max-h-64 min-w-0 overflow-y-auto rounded-md border border-border-muted">
      {visible.map(item => <label key={item.value} className="flex min-h-11 min-w-0 items-center gap-2 border-b border-border-muted px-3 py-1.5 text-sm last:border-b-0">
        <input type="checkbox" className={checkboxClass} checked={chosen.has(item.value)} disabled={item.disabled} onChange={event => onChange(event.target.checked ? [...selected, item.value] : selected.filter(v => v !== item.value))} />
        <span className="min-w-0 flex-1 break-all">{item.label}</span>
        {item.detail && <span className="shrink-0 text-xs tabular-nums text-text-secondary">{item.detail}</span>}
      </label>)}
      {!visible.length && <p className="p-3 text-xs text-text-secondary">{items.length ? "No matches." : emptyText}</p>}
    </div>
  </fieldset>;
}
