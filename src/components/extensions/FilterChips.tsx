/** Zoer's FilterChips look (components/ui/FilterChips.tsx), which the host does not export to native workspaces: a short single-choice filter of toggle chips. */
export default function FilterChips<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label} className="flex min-w-0 shrink-0 gap-2">
    {options.map(option => { const pressed = option.value === value; return <button key={option.value} type="button" aria-pressed={pressed} onClick={() => { if (!pressed) onChange(option.value); }}
      className={`inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-focus sm:h-8 sm:px-3 sm:text-[12px] ${pressed ? "border-accent/50 bg-accent/15 text-accent" : "border-border-default text-text-secondary hover:bg-surface-hover hover:text-text-heading"}`}>
      {option.label}{option.count !== undefined && <span className={pressed ? "text-accent/80" : "text-text-muted"}>{option.count}</span>}
    </button>; })}
  </div>;
}
