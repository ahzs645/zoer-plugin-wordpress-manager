import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip as Tooltip } from "@zoer/plugin-ui/controls";
import { checkboxClass, controlClass, fieldLabelClass } from "@zoer/plugin-ui/controls";

/** Typed destination confirmation with a copy helper, plus the concurrent-writer acknowledgement. */
export default function ConfirmDestination({ target, value, onChange, shared, writers, onWriters, disabled }: {
  target: string; value: string; onChange: (value: string) => void; shared: boolean; writers: boolean; onWriters: (value: boolean) => void; disabled?: boolean;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(target); setCopied("copied"); }
    catch { setCopied("failed"); }
    setTimeout(() => setCopied("idle"), 2000);
  }
  const matches = value.trim() === target;
  return <div className="min-w-0 space-y-3">
    <div className="min-w-0">
      <span className={fieldLabelClass}>Type the destination address to confirm</span>
      <div className="mb-2 flex min-w-0 items-center gap-2 rounded-md border border-border-muted bg-surface-primary/40 px-3 py-1">
        <code className="min-w-0 flex-1 break-all text-xs">{target}</code>
        <Tooltip content={copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed — select the text instead" : "Copy address"}>
          <button type="button" aria-label="Copy destination address" onClick={() => void copy()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover sm:h-8 sm:w-8">{copied === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
        </Tooltip>
      </div>
      <input aria-label="Confirm destination address" className={controlClass("default", "text-base sm:text-[14px]")} value={value} onChange={event => onChange(event.target.value)} placeholder={target} disabled={disabled} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" />
      {value && !matches && <p className="mt-1 text-xs text-status-warning">Does not match {target} yet.</p>}
    </div>
    <label className="flex min-h-11 items-start gap-2 text-sm"><input className={`${checkboxClass} mt-1`} type="checkbox" checked={writers} onChange={event => onWriters(event.target.checked)} disabled={disabled} />
      <span>{shared ? "Replace the selected live resources. Concurrent edits are not merged and may be overwritten; avoid editing during migration." : "All destination database writes run through WordPress. No external database writer is active."}</span>
    </label>
  </div>;
}

export function destinationConfirmed(target: string, value: string) { return value.trim() === target; }
